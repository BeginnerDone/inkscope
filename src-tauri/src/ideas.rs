use serde_json::Value;

pub const MODULE: &str = "原创灵感与平台选题 v2";
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

pub fn prompt(title: &str, summaries: &[Value]) -> String {
    format!("{RULES}\n原作资料：{}\n输出结构（ideas数组必须有四案，起点、番茄各两案）：\n{SCHEMA}",
        serde_json::json!({"title": title, "summaries": summaries}))
}

// Validate the model boundary before persisting or rendering. This checks completeness,
// not literary quality; originality and market appeal still require human reading.
pub fn validate(value: &Value) -> Result<(), String> {
    let fail = || "灵感结果结构不完整，需要四个完整方案（起点、番茄各两个）。请重试，已完成的拆书模块会保留。".to_string();
    let ideas = value["ideas"].as_array().ok_or_else(fail)?;
    if value["ideasVersion"] != 2 || ideas.len() != 4 {
        return Err(fail());
    }
    for platform in ["起点", "番茄"] {
        if ideas.iter().filter(|idea| idea["platform"] == platform).count() != 2 {
            return Err(fail());
        }
    }
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
        result["ideas"] = json!(["起点", "起点", "番茄", "番茄"].map(|platform| {
            let mut copy = idea.clone(); copy["platform"] = json!(platform); copy
        }));
        result
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
}
