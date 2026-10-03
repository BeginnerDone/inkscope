use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const VERSION: i64 = 6;
pub const METHODS: &str = include_str!("prompts/novel-review.txt");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub source_key: String,
    pub book_url: String,
    pub total_chapters: usize,
    pub downloaded_chapters: usize,
    pub failed_chapters: usize,
    pub checked_at: String,
}
impl Receipt {
    pub fn complete(&self) -> bool {
        self.total_chapters > 0 && self.downloaded_chapters == self.total_chapters && self.failed_chapters == 0
    }
}

pub fn catalog_matches(local: &[(String, String)], remote: &[crate::legado::RemoteChapter]) -> bool {
    !remote.is_empty() && local.len() == remote.len() && local.iter().zip(remote).all(|((title, text), chapter)| {
        title.trim() == chapter.title.trim() && text.chars().count() > 20
    })
}

fn thirds(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    (0..3).map(|i| chars[chars.len()*i/3..chars.len()*(i+1)/3].iter().collect()).collect()
}

fn locate_quote(part: &str, quote: &str) -> Result<(String, usize), String> {
    let requested = quote.trim();
    if requested.is_empty() {
        return Err("核验引用不能为空".into());
    }
    let characters: Vec<char> = part.chars().collect();
    let (position, requested_len) = if let Some(byte_position) = part.find(requested) {
        (part[..byte_position].chars().count(), requested.chars().count())
    } else {
        // Models commonly collapse line breaks and spaces while copying a real
        // passage. Locate that passage without whitespace, then quote the exact
        // original characters from the saved book.
        let needle: String = requested.chars().filter(|ch| !ch.is_whitespace()).collect();
        if needle.is_empty() { return Err("核验引用不能为空".into()); }
        let positions: Vec<usize> = characters.iter().enumerate()
            .filter_map(|(index, ch)| (!ch.is_whitespace()).then_some(index)).collect();
        let compact: String = positions.iter().map(|&index| characters[index]).collect();
        let byte_position = compact.find(&needle).ok_or("核验引用与对应区域原文不一致")?;
        let first = compact[..byte_position].chars().count();
        let last = first + needle.chars().count() - 1;
        (positions[first], positions[last] + 1 - positions[first])
    };
    if (8..=70).contains(&requested_len) {
        return Ok((characters[position..position + requested_len].iter().collect(), position));
    }

    // The model sometimes chooses a short line of dialogue or an entire long
    // sentence. Once its text is found verbatim, derive the bounded citation
    // from the saved source rather than making the model copy it again.
    if characters.len() < 8 {
        return Err("对应区域原文不足8字，无法生成可核验引用".into());
    }
    let (start, end) = if requested_len < 8 {
        let width = characters.len().min(24);
        let center = position + requested_len / 2;
        let start = center.saturating_sub(width / 2).min(characters.len() - width);
        (start, start + width)
    } else {
        (position, position + 70)
    };
    Ok((characters[start..end].iter().collect(), start))
}

fn source_excerpt(part: &str) -> (String, usize) {
    let chars: Vec<char> = part.chars().collect();
    let first = chars.iter().position(|ch| !ch.is_whitespace()).unwrap_or(0);
    let end = (first + 40).min(chars.len());
    (chars[first..end].iter().collect(), first)
}

pub fn prompt(text: &str, index: usize, total: usize) -> String {
    let parts = thirds(text);
    format!(r#"{METHODS}
这是已保存正文的第 {index}/{total} 段。按阅读顺序审读下面全部三个区域，不得用书名、简介或已有知识替代原文。
只判断本段可见信息，全书作用和未来回收暂列推断。正文区域标记仅为审计定位，不是章节。
返回严格 JSON：{{"summary":"因果链：目标→阻碍→主动选择→结果→下一步变化（不超过350字）","events":[{{"fact":"原文发生的事","known":"读者此时知道什么","wanted":"具体期待","changed":"新增信息或局面变化"}}],"threads":[{{"name":"人物/关系/悬念/伏笔名称","state":"设立/发展/兑现/尚未确认","movement":"本段证据与变化，不能把猜测写成兑现"}}],"diagnosis":"最重要的写作机制、证据与限制（不超过250字）","evidence":[{{"quote":"从前段逐字复制连续原文，优先8至70字","finding":"对应事实或判断"}},{{"quote":"从中段逐字复制连续原文，优先8至70字","finding":"对应事实或判断"}},{{"quote":"从后段逐字复制连续原文，优先8至70字","finding":"对应事实或判断"}}],"uncertainties":["尚无法确认的事情"]}}
events与threads各最多6项。引用必须连续、完全一致，不可省略、纠错或添加省略号。原句不足8字时照实引用，应用会从已保存正文补足相邻原文。不得以审读方法替代具体内容。
【前段原文】
{}
【中段原文】
{}
【后段原文】
{}"#, parts[0], parts[1], parts[2])
}

// The receipt proves which text was submitted and checks literal evidence; it does
// not claim to prove the model understood every character.
pub fn validate_note(mut note: Value, text: &str, index: usize, start: usize) -> Result<Value, String> {
    if note["summary"].as_str().unwrap_or("").trim().is_empty() { return Err("缺少本段阅读记录".into()); }
    if note["events"].as_array().is_none_or(|events| events.is_empty()) {
        return Err("缺少按阅读顺序记录的事件与读者变化".into());
    }
    if !note["threads"].is_array() { return Err("缺少人物与线索状态记录".into()); }
    let evidence = note["evidence"].as_array().cloned().unwrap_or_default();
    let parts = thirds(text);
    let mut verified = Vec::new();
    let mut zone_start = start;
    let mut partial = false;
    for (zone, part) in parts.iter().enumerate() {
        let item = evidence.get(zone).cloned().unwrap_or(Value::Null);
        let located = locate_quote(part, item["quote"].as_str().unwrap_or(""));
        let was_verified = item["verified"].as_bool() != Some(false);
        let (quote, position, finding, is_verified) = match located {
            Ok((quote, position)) if was_verified => (quote, position, item["finding"].clone(), true),
            Ok((quote, position)) => (quote, position, json!("原文位置已定位；模型判断仍待复核"), false),
            Err(_) => {
                let (quote, position) = source_excerpt(part);
                (quote, position, json!("本区域原文摘录；模型引文未能核对，相关判断待复核"), false)
            }
        };
        partial |= !is_verified;
        verified.push(json!({"quote":quote,"finding":finding,"characterStart":zone_start + position+1,"verified":is_verified}));
        zone_start += part.chars().count();
    }
    note["evidence"] = json!(verified);
    note["verificationStatus"] = json!(if partial { "partial" } else { "verified" });
    if partial {
        let uncertainty = "部分模型引文与原文未能对应；这些区域的模型判断未经引用证实，需要人工复核。";
        let uncertainties = note["uncertainties"].as_array_mut();
        if let Some(uncertainties) = uncertainties {
            if !uncertainties.iter().any(|item| item.as_str() == Some(uncertainty)) { uncertainties.push(json!(uncertainty)); }
        } else { note["uncertainties"] = json!([uncertainty]); }
    }
    note["segment"] = json!(index);
    note["characterStart"] = json!(start+1);
    note["characterEnd"] = json!(start+text.chars().count());
    // Bound individual notes so unusually verbose model output cannot overflow
    // the synthesis context. Retry instead of silently discarding the tail.
    if note.to_string().chars().count() > 7000 { return Err("本段阅读记录过长，请精简后重试".into()); }
    Ok(note)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completeness_requires_every_chapter_and_no_failures() {
        let mut receipt = Receipt { source_key:"s".into(),book_url:"url".into(),total_chapters:100,downloaded_chapters:30,failed_chapters:0,checked_at:"now".into() };
        assert!(!receipt.complete()); receipt.downloaded_chapters=100; assert!(receipt.complete());
        receipt.failed_chapters=1; assert!(!receipt.complete()); receipt.total_chapters=0; assert!(!receipt.complete());
    }
    #[test]
    fn verifies_literal_evidence_in_each_zone_and_counts_unicode() {
        let text="甲乙丙丁戊己庚辛壬癸😀。".repeat(3);
        let note=json!({"summary":"发生变化","events":[{"fact":"变化"}],"threads":[],"evidence":[{"quote":"甲乙丙丁戊己庚辛"},{"quote":"甲乙丙丁戊己庚辛"},{"quote":"甲乙丙丁戊己庚辛"}]});
        let valid=validate_note(note.clone(),&text,2,36).unwrap();
        assert_eq!(valid["characterEnd"],72); assert_eq!(valid["evidence"][1]["characterStart"],49);
        let mut fake=note; fake["evidence"][2]["quote"]=json!("这是不在原文中的句子");
        let partial=validate_note(fake,&text,2,36).unwrap();
        assert_eq!(partial["verificationStatus"], "partial");
        assert_eq!(partial["evidence"][2]["verified"], false);
        assert!(text.contains(partial["evidence"][2]["quote"].as_str().unwrap()));
        assert!(!partial.to_string().contains("这是不在原文中的句子"));
        let cached=validate_note(partial,&text,2,36).unwrap();
        assert_eq!(cached["evidence"][2]["verified"], false);
    }
    #[test]
    fn expands_short_literal_quotes_using_the_saved_source() {
        let text = "开头铺垫甲乙丙丁，人物说好，随后改变了决定。".repeat(3);
        let note = json!({"summary":"发生变化","events":[{"fact":"变化"}],"threads":[],"evidence":[{"quote":"好"},{"quote":"好"},{"quote":"好"}]});
        let valid = validate_note(note, &text, 4, 120).unwrap();
        let parts = thirds(&text);
        for (part, evidence) in parts.iter().zip(valid["evidence"].as_array().unwrap()) {
            let quote = evidence["quote"].as_str().unwrap();
            assert!((8..=70).contains(&quote.chars().count()));
            assert!(part.contains(quote));
            assert!(quote.contains('好'));
        }
        assert_eq!(valid["evidence"][0]["characterStart"], 121);
    }
    #[test]
    fn restores_source_whitespace_without_accepting_invented_quotes() {
        let part = "人物推开门，\n看见失踪的人站在窗边。";
        let (quote, position) = locate_quote(part, "人物推开门，看见失踪的人").unwrap();
        assert_eq!(quote, "人物推开门，\n看见失踪的人");
        assert_eq!(position, 0);
        assert!(locate_quote(part, "人物推开门，看见不存在的人").is_err());
    }
    #[test]
    fn old_download_requires_matching_titles_order_and_bodies() {
        let local=vec![("第一章".into(),"正文".repeat(12))];
        let remote=vec![crate::legado::RemoteChapter {position:0,title:"第一章".into(),chapter_url:"a".into()}];
        assert!(catalog_matches(&local,&remote));
        assert!(!catalog_matches(&[("第二章".into(),"正文".repeat(12))],&remote));
        assert!(!catalog_matches(&[],&remote));
    }
}
