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

pub fn prompt(text: &str, index: usize, total: usize) -> String {
    let parts = thirds(text);
    format!(r#"{METHODS}
这是已保存正文的第 {index}/{total} 段。按阅读顺序审读下面全部三个区域，不得用书名、简介或已有知识替代原文。
只判断本段可见信息，全书作用和未来回收暂列推断。正文区域标记仅为审计定位，不是章节。
返回严格 JSON：{{"summary":"因果链：目标→阻碍→主动选择→结果→下一步变化（不超过350字）","events":[{{"fact":"原文发生的事","known":"读者此时知道什么","wanted":"具体期待","changed":"新增信息或局面变化"}}],"threads":[{{"name":"人物/关系/悬念/伏笔名称","state":"设立/发展/兑现/尚未确认","movement":"本段证据与变化，不能把猜测写成兑现"}}],"diagnosis":"最重要的写作机制、证据与限制（不超过250字）","evidence":[{{"quote":"从前段逐字复制8至70字连续原文","finding":"对应事实或判断"}},{{"quote":"从中段逐字复制8至70字连续原文","finding":"对应事实或判断"}},{{"quote":"从后段逐字复制8至70字连续原文","finding":"对应事实或判断"}}],"uncertainties":["尚无法确认的事情"]}}
events与threads各最多6项。引用必须连续、完全一致，不可省略、纠错或添加省略号。不得以审读方法替代具体内容。
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
    let evidence = note["evidence"].as_array().ok_or("缺少原文核验引用")?;
    if evidence.len() != 3 { return Err("需要前、中、后三处原文引用".into()); }
    let parts = thirds(text);
    let mut verified = Vec::new();
    let mut zone_start = start;
    for (part, item) in parts.iter().zip(evidence) {
        let quote = item["quote"].as_str().unwrap_or("");
        if !(8..=70).contains(&quote.chars().count()) { return Err("核验引用必须为8至70字连续原文".into()); }
        let position = part.find(quote).ok_or("核验引用与对应区域原文不一致")?;
        verified.push(json!({"quote":quote,"finding":item["finding"],"characterStart":zone_start + part[..position].chars().count()+1}));
        zone_start += part.chars().count();
    }
    note["evidence"] = json!(verified);
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
        assert!(validate_note(fake,&text,2,36).is_err());
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
