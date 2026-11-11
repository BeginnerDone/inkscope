use serde_json::Value;

pub const MODULE: &str = "原创灵感与平台选题 v3";
pub const RULES: &str = include_str!("prompts/ideas.txt");
pub const SCHEMA: &str = r#"{
  "ideasVersion": 2,
  "ideas": [{
    "title": "新书名", "platform": "起点或番茄", "genre": "具体题材",
    "audience": "目标读者与阅读需求", "sellingPoint": "一句话可懂的反常卖点",
    "premise": "可直接给读者看的简介",
    "sourceAnchor": "继承的情绪价值及原作转述依据，缺资料时说明",
    "convention": "本题材的一条具体惯例", "ruleBreak": "改变什么规则，由此发生什么新冲突",
    "difference": "与原作最核心的因果差异",
    "differences": [{"axis": "主角目标/核心机制/对抗关系/推进路径", "original": "原作做法或资料不足", "proposal": "新作做法", "consequence": "因此必然不同的剧情"}],
    "opening": [{"chapter": "第一章/第二章/第三章", "event": "事件与主角主动选择", "reward": "本章进展、所得及代价", "hook": "具体章尾追问"}],
    "firstPayoff": "铺垫的欲望、争取方式、见证或事实、实际回报、代价、下一期待",
    "storyEngine": "可持续产生目标、阻力、收益和代价的机制",
    "escalation": [{"stage": "前30章的一个阶段", "conflict": "因上阶段选择升级的冲突", "payoff": "具体兑现及新目标"}],
    "platformFit": "为什么适合该平台的该类读者，标明是策略假设",
    "alternatePlatform": "换到另一平台要怎样实改开篇或推进",
    "risk": "仍需试写验证的具体风险与修正方法",
    "validation": "用简介及前三章验证读者兴趣的具体办法"
  }]
}"#;

pub const PER_PLATFORM: usize = 5;
pub const PLATFORMS: &[&str] = &["起点", "番茄"];

pub fn platforms(platform: Option<&str>) -> Result<Vec<&str>, String> {
    match platform {
        None => Ok(PLATFORMS.to_vec()),
        Some(name) if PLATFORMS.contains(&name) => Ok(vec![name]),
        _ => Err("请选择起点、番茄或全部平台".into()),
    }
}

pub fn prompt(title: &str, summaries: &[Value], existing: &[Value], platforms: &[&str]) -> String {
    prompt_count(title, summaries, existing, platforms, PER_PLATFORM)
}

pub fn prompt_count(title: &str, summaries: &[Value], existing: &[Value], platforms: &[&str], count: usize) -> String {
    let existing: Vec<Value> = existing.iter().map(|idea| serde_json::json!({
        "title":idea["title"],"platform":idea["platform"],"premise":idea["premise"],
        "sellingPoint":idea["sellingPoint"],"ruleBreak":idea["ruleBreak"],"storyEngine":idea["storyEngine"],
        "difference":idea["difference"]
    })).collect();
    format!("{RULES}\n本批数量：平台{}，每个平台必须恰好{count}案，共{}案。只输出本批新方案，不复述已有方案。\n原作资料：{}\n已有方案（用于排除重复，不能换标题复用其核心机制、主角目标和开篇冲突）：{}\n输出结构：\n{SCHEMA}",
        platforms.join("、"), platforms.len()*count,
        serde_json::json!({"title": title, "summaries": summaries}), serde_json::json!(existing))
}

// Validate the model boundary before persisting or rendering. This checks completeness,
// not literary quality; originality and market appeal still require human reading.
pub fn validate(value: &Value) -> Result<(), String> {
    validate_batch(value, PLATFORMS)
}

pub fn validate_batch(value: &Value, platforms: &[&str]) -> Result<(), String> {
    validate_count(value, platforms, PER_PLATFORM)
}

pub fn validate_count(value: &Value, platforms: &[&str], count: usize) -> Result<(), String> {
    let fail = || format!("灵感结果结构不完整，需要{}每个平台各{count}个完整方案。已保存的方案不会被覆盖。", platforms.join("、"));
    let ideas = value["ideas"].as_array().ok_or_else(fail)?;
    if value["ideasVersion"] != 2 || ideas.len() != platforms.len() * count {
        return Err(fail());
    }
    for platform in platforms {
        if ideas.iter().filter(|idea| idea["platform"].as_str() == Some(*platform)).count() != count {
            return Err(fail());
        }
    }
    ensure_distinct(&[], ideas)?;
    for idea in ideas {
        for field in ["title", "genre", "audience", "sellingPoint", "premise", "sourceAnchor",
            "convention", "ruleBreak", "difference", "firstPayoff", "storyEngine",
            "platformFit", "alternatePlatform", "risk", "validation"] {
            if !nonempty(&idea[field]) { return Err(fail()); }
        }
        for (field, fields) in [
            ("differences", &["axis", "original", "proposal", "consequence"][..]),
            ("opening", &["chapter", "event", "reward", "hook"][..]),
            ("escalation", &["stage", "conflict", "payoff"][..]),
        ] {
            let rows = idea[field].as_array().ok_or_else(fail)?;
            if rows.len() < 3 || (field != "differences" && rows.len() != 3)
                || rows.iter().any(|row| fields.iter().any(|key| !nonempty(&row[*key]))) {
                return Err(fail());
            }
        }
        let axes: std::collections::HashSet<_> = idea["differences"].as_array().unwrap().iter()
            .filter_map(|row| row["axis"].as_str())
            .filter(|axis| ["主角目标", "核心机制", "对抗关系", "推进路径"].contains(axis))
            .collect();
        if axes.len() < 3 { return Err(fail()); }
    }
    Ok(())
}

fn identity(value: &Value) -> String {
    value.as_str().unwrap_or("").chars().filter(|c| !c.is_whitespace() && !"《》：:，,。.!！?？".contains(*c)).flat_map(char::to_lowercase).collect()
}

pub fn ensure_distinct(existing: &[Value], additions: &[Value]) -> Result<(), String> {
    let mut titles = std::collections::HashSet::new();
    let mut pitches = std::collections::HashSet::new();
    for idea in existing {
        titles.insert(identity(&idea["title"]));
        let pitch=identity(&idea["sellingPoint"]);
        if !pitch.is_empty() { pitches.insert(pitch); }
    }
    for idea in additions {
        let title=identity(&idea["title"]);
        let pitch=identity(&idea["sellingPoint"]);
        if title.is_empty() || !titles.insert(title) || (!pitch.is_empty() && !pitches.insert(pitch)) {
            return Err("本批灵感与已有方案或同批方案的标题、卖点重复，请重构后重新生成".into());
        }
    }
    Ok(())
}

/// Append atomically after validating the entire new batch. Never replace old ideas
/// or unrelated analysis fields, including reports from older schema versions.
pub fn existing_ideas(report: &Value) -> Result<Vec<Value>, String> {
    match report.get("ideas") {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => Ok(items.clone()),
        Some(value @ Value::Object(_)) => Ok(vec![value.clone()]),
        _ => Err("已有灵感格式无效，未修改原报告".into()),
    }
}

pub fn append(report: &Value, batch: &Value, platforms: &[&str]) -> Result<Value, String> {
    append_count(report, batch, platforms, PER_PLATFORM)
}

pub fn append_count(report: &Value, batch: &Value, platforms: &[&str], count: usize) -> Result<Value, String> {
    validate_count(batch, platforms, count)?;
    let existing = existing_ideas(report)?;
    let additions = batch["ideas"].as_array().ok_or("缺少新方案")?;
    ensure_distinct(&existing, additions)?;
    let mut combined = existing;
    combined.extend(additions.iter().cloned());
    let mut result = report.clone();
    if !result.is_object() { return Err("原报告格式无效，无法追加".into()); }
    result["ideas"] = serde_json::json!(combined);
    result["ideasVersion"] = serde_json::json!(2);
    Ok(result)
}

fn nonempty(value: &Value) -> bool {
    value.as_str().is_some_and(|text| !text.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn complete_result() -> Value {
        let mut result: Value = serde_json::from_str(SCHEMA).unwrap();
        let mut idea = result["ideas"][0].clone();
        idea["differences"] = json!(["主角目标", "核心机制", "对抗关系"].map(|axis|
            json!({"axis": axis, "original": "原作依据", "proposal": "新行动", "consequence": "新的剧情后果"})));
        for field in ["opening", "escalation"] {
            idea[field] = json!(vec![idea[field][0].clone(); 3]);
        }
        result["ideas"] = json!((0..10).map(|i| {
            let mut copy = idea.clone(); copy["platform"] = json!(if i<5 {"起点"} else {"番茄"});
            copy["title"]=json!(format!("方案{i}")); copy["sellingPoint"]=json!(format!("卖点{i}")); copy
        }).collect::<Vec<_>>());
        result
    }

    #[test]
    fn single_proposal_count_is_independent_of_initial_report_count() {
        let mut single=complete_result();
        single["ideas"]=serde_json::json!([single["ideas"][0].clone()]);
        assert!(validate_count(&single,&["起点"],1).is_ok());
        assert!(validate(&single).is_err());
        let report=serde_json::json!({"ideas":[{"title":"已有方案"}],"summary":"保留原报告"});
        let updated=append_count(&report,&single,&["起点"],1).unwrap();
        assert_eq!(updated["ideas"].as_array().unwrap().len(),2);
        assert_eq!(updated["summary"],report["summary"]);
        assert!(validate_count(&single,&["番茄"],1).is_err());
    }

    #[test]
    fn accepts_complete_result_and_rejects_legacy_cards() {
        assert!(validate(&complete_result()).is_ok());
        assert!(validate(&json!({"ideas": [{"title": "只有标题", "premise": "梗概"}]})).is_err());
    }

    #[test]
    fn rejects_bad_model_shapes_before_they_reach_ui() {
        for (field, bad) in [("opening", json!("不是数组")), ("differences", json!([null])),
            ("escalation", json!([])), ("firstPayoff", json!("  "))] {
            let mut result = complete_result(); result["ideas"][0][field] = bad;
            assert!(validate(&result).is_err(), "{field}");
        }
    }

    #[test]
    fn rejects_single_platform_and_repeated_difference_axes() {
        let mut result = complete_result(); result["ideas"][0]["platform"] = json!("番茄");
        assert!(validate(&result).is_err());
        let mut result = complete_result();
        for row in result["ideas"][0]["differences"].as_array_mut().unwrap() {
            row["axis"] = json!("核心机制");
        }
        assert!(validate(&result).is_err());
    }
    #[test]
    fn appends_without_changing_old_ideas_or_report_and_rejects_duplicates() {
        let report = json!({"summary":"原报告", "ideas":[{"title":"旧方案", "premise":"原构思"}], "coverage":{"processedSegments":9}});
        let batch = complete_result();
        let result=append(&report,&batch,PLATFORMS).unwrap();
        assert_eq!(result["ideas"].as_array().unwrap().len(),11);
        assert_eq!(result["ideas"][0],report["ideas"][0]);
        assert_eq!(result["coverage"],report["coverage"]);
        assert_eq!(result["summary"],report["summary"]);
        assert!(append(&result,&batch,PLATFORMS).is_err());
        let mut single=batch.clone();
        single["ideas"]=json!(batch["ideas"].as_array().unwrap()[..5]);
        assert!(validate_batch(&single,&["起点"]).is_ok());
        assert!(validate(&single).is_err());
        single["ideas"][1]["title"]=single["ideas"][0]["title"].clone();
        assert!(validate_batch(&single,&["起点"]).is_err());
        assert!(platforms(Some("未知平台")).is_err());
        let single_legacy = json!({"ideas":{"title":"旧版单个对象","premise":"原构思"}});
        let merged=append(&single_legacy,&batch,PLATFORMS).unwrap();
        assert_eq!(merged["ideas"][0], single_legacy["ideas"]);
        assert!(append(&json!({"ideas":"损坏数据"}),&batch,PLATFORMS).is_err());
    }

}
