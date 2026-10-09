//! Chapter lifecycle. Old projects migrate lazily without changing author text.
use super::*;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterState {
    pub review: Option<ConfirmedReview>,
    pub active_finalization: Option<String>,
    pub finalizations: Vec<Finalization>,
    pub record_task_ids: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmedReview {
    pub id: String,
    pub task_id: Option<String>,
    pub source_content: String,
    pub issues: Vec<String>,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finalization {
    pub id: String,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub revision: i64,
}
pub(super) fn chapter_state(
    conn: &Connection,
    project_id: &str,
    document_id: &str,
) -> Result<ChapterState, String> {
    use rusqlite::OptionalExtension;
    let raw: Option<String> = conn
        .query_row(
            "SELECT body FROM creation_chapter_states WHERE project_id=? AND document_id=?",
            params![project_id, document_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|v| serde_json::from_str(&v).map_err(|e| format!("章节流程读取失败：{e}")))
        .unwrap_or(Ok(ChapterState::default()))
}
pub(super) fn guard_finalized(
    conn: &Connection,
    old: &Project,
    next: &Project,
) -> Result<(), String> {
    for source in old.documents.iter().filter(|d| d.kind == "source") {
        if next.documents.iter().find(|d| d.id == source.id) != Some(source) {
            return Err("导入原文只读，请在资料副本中整理".into());
        }
    }
    for d in old.documents.iter().filter(|d| d.kind == "chapter") {
        if chapter_state(conn, &old.id, &d.id)?
            .active_finalization
            .is_some()
            && next.documents.iter().find(|v| v.id == d.id) != Some(d)
        {
            return Err("定稿章节不能直接修改或转换，请先创建修订版；旧定稿会保留".into());
        }
    }
    Ok(())
}
#[tauri::command]
pub fn read_creation_chapter(
    app: AppHandle,
    id: String,
    document_id: String,
) -> Result<ChapterState, String> {
    let conn = database(&app)?;
    let p = load(&conn, &id)?;
    if !p
        .documents
        .iter()
        .any(|d| d.id == document_id && d.kind == "chapter")
    {
        return Err("章节不存在".into());
    }
    chapter_state(&conn, &id, &document_id)
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterAction {
    pub id: String,
    pub document_id: String,
    pub revision: i64,
    pub action: String,
    pub task_id: Option<String>,
    #[serde(default)]
    pub issues: Vec<String>,
}
pub(super) fn act(conn: &mut Connection, input: ChapterAction) -> Result<Project, String> {
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let mut p = load(&tx, &input.id)?;
    if p.revision != input.revision {
        return Err("作品已有新修改，请保存后重试".into());
    }
    let d = p
        .documents
        .iter()
        .find(|d| d.id == input.document_id && d.kind == "chapter")
        .ok_or("章节不存在")?
        .clone();
    let mut state = chapter_state(&tx, &p.id, &d.id)?;
    match input.action.as_str() {
        "confirm_review" => {
            if state.active_finalization.is_some() {
                return Err("请先创建修订版".into());
            }
            if d.content.trim().is_empty() {
                return Err("请先写草稿".into());
            }
            let issues: Vec<String> = input
                .issues
                .into_iter()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .collect();
            if issues.is_empty()
                || issues.len() > 30
                || issues.iter().map(|v| v.chars().count()).sum::<usize>() > 12000
            {
                return Err("请确认1至30条意见，总长度不超过12000字".into());
            }
            if let Some(task_id) = &input.task_id {
                let task = load_task(&tx, task_id)?;
                if task.project_id != p.id
                    || task.document_id != d.id
                    || task.skill != "review"
                    || task.status != "ready"
                    || task.source_content != d.content
                {
                    return Err("审稿基于旧稿或其他章节，请重新检查".into());
                }
            }
            state.review = Some(ConfirmedReview {
                id: Uuid::new_v4().to_string(),
                task_id: input.task_id,
                source_content: d.content.clone(),
                issues,
                created_at: now(),
            });
        }
        "finalize" => {
            if d.content.trim().is_empty() {
                return Err("空白正文不能定稿".into());
            }
            if state.active_finalization.is_some() {
                return Err("本章已经定稿".into());
            }
            let running: i64 = tx
                .query_row(
                    "SELECT count(*) FROM creation_tasks WHERE project_id=? AND status='running'",
                    [&p.id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if running > 0 {
                return Err("请等待当前任务完成，再确认定稿".into());
            }
            let finalization = Finalization {
                id: Uuid::new_v4().to_string(),
                title: d.title.clone(),
                content: d.content.clone(),
                created_at: now(),
                revision: p.revision,
            };
            state.active_finalization = Some(finalization.id.clone());
            state.finalizations.push(finalization);
        }
        "reopen" => {
            if state.active_finalization.take().is_none() {
                return Err("本章尚未定稿".into());
            }
        }
        "confirm_records" => {
            let task_id = input.task_id.as_ref().ok_or("请选择本章记录候选")?;
            let mut task = load_task(&tx, task_id)?;
            if task.project_id != p.id
                || task.document_id != d.id
                || task.skill != "memory"
                || task.status != "ready"
                || task.content.trim().is_empty()
            {
                return Err("记录候选不可用".into());
            }
            let active = state.active_finalization.as_deref().ok_or("请先定稿")?;
            if task.finalization_id.as_deref() != Some(active) || task.source_content != d.content {
                return Err("记录不属于当前定稿，请重新整理".into());
            }
            let mut entry = document(
                "resource",
                &format!("{} · 本章记录", clip_text(&d.title, 170)),
                task.content.clone(),
                "",
            );
            entry.details.extend([
                ("category".into(), "facts".into()),
                ("status".into(), "已确认".into()),
                ("source".into(), d.title.clone()),
                ("chapterId".into(), d.id.clone()),
                ("finalizationId".into(), active.into()),
                ("sourceHash".into(), source_fingerprint(&d.content)),
            ]);
            p.documents.push(entry);
            state.record_task_ids.push(task.id.clone());
            task.status = "accepted".into();
            store_task(&tx, &task)?;
        }
        _ => return Err("未知章节操作".into()),
    }
    validate(&p)?;
    p.revision += 1;
    p.updated_at = now();
    record(&tx, &p, &d, &format!("章节流程：{}", input.action))?;
    for entry in p
        .documents
        .iter()
        .filter(|v| v.kind == "resource" && v.details.get("chapterId") == Some(&d.id))
    {
        record(&tx, &p, entry, "章节记录确认")?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO creation_chapter_states VALUES(?,?,?)",
        params![
            p.id,
            d.id,
            serde_json::to_string(&state).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE creations SET body=? WHERE id=?",
        params![serde_json::to_string(&p).map_err(|e| e.to_string())?, p.id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(p)
}
#[tauri::command]
pub fn creation_chapter_action(app: AppHandle, input: ChapterAction) -> Result<Project, String> {
    act(&mut database(&app)?, input)
}
