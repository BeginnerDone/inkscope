use crate::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    pub position: i64,
    pub ratio: f64,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingHistoryItem {
    pub position: i64,
    pub title: String,
    pub ratio: f64,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingClip {
    pub id: String,
    pub position: i64,
    pub chapter_title: String,
    pub quote: String,
    pub note: String,
    pub paragraph: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewClip {
    pub book_id: String,
    pub position: i64,
    pub quote: String,
    pub note: String,
    pub paragraph: i64,
}

fn validate_ratio(ratio: f64) -> Result<f64, String> {
    if !ratio.is_finite() || !(0.0..=1.0).contains(&ratio) {
        return Err("阅读进度必须在 0% 到 100% 之间".into());
    }
    Ok(ratio)
}

fn normalize_quote(value: &str) -> String {
    value.chars().filter(|c| !c.is_whitespace()).collect()
}

fn save_clip_in(conn: &Connection, input: NewClip) -> Result<ReadingClip, String> {
    let quote = input.quote.trim();
    let note = input.note.trim();
    if quote.is_empty() || quote.chars().count() > 3000 {
        return Err("请选择不超过 3000 字的正文片段".into());
    }
    if note.chars().count() > 2000 {
        return Err("备注不能超过 2000 字".into());
    }
    if input.paragraph < 0 {
        return Err("无效的段落位置".into());
    }
    let (chapter_title, content): (String, String) = conn
        .query_row(
            "SELECT title,content FROM chapters WHERE position=?",
            params![input.position],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "章节不存在或已更新，请重新选择文字".to_string())?;
    if !normalize_quote(&content).contains(&normalize_quote(quote)) {
        return Err("所选文字与当前章节不一致，请重新划选".into());
    }
    let timestamp = now();
    let clip = ReadingClip {
        id: Uuid::new_v4().to_string(),
        position: input.position,
        chapter_title,
        quote: quote.into(),
        note: note.into(),
        paragraph: input.paragraph,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };
    conn.execute("INSERT INTO reading_clips(id,position,chapter_title,quote,note,paragraph,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        params![clip.id,clip.position,clip.chapter_title,clip.quote,clip.note,clip.paragraph,clip.created_at,clip.updated_at]
    ).map_err(|e|e.to_string())?;
    Ok(clip)
}

#[tauri::command]
pub fn get_reading_progress(app: AppHandle, id: String) -> Result<Option<ReadingProgress>, String> {
    let conn = open_book(&app, &id)?;
    conn.query_row(
        "SELECT position,ratio,updated_at FROM reading_progress WHERE id=1",
        [],
        |row| {
            Ok(ReadingProgress {
                position: row.get(0)?,
                ratio: row.get(1)?,
                updated_at: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_reading_progress(
    app: AppHandle,
    id: String,
    position: i64,
    ratio: f64,
) -> Result<(), String> {
    let ratio = validate_ratio(ratio)?;
    let mut conn = open_book(&app, &id)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let title: String = tx
        .query_row(
            "SELECT title FROM chapters WHERE position=?",
            params![position],
            |row| row.get(0),
        )
        .map_err(|_| "章节不存在".to_string())?;
    let timestamp = now();
    tx.execute("INSERT INTO reading_progress(id,position,ratio,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,ratio=excluded.ratio,updated_at=excluded.updated_at",params![position,ratio,timestamp]).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO reading_history(position,title,ratio,updated_at) VALUES(?,?,?,?) ON CONFLICT(position) DO UPDATE SET title=excluded.title,ratio=excluded.ratio,updated_at=excluded.updated_at",params![position,title,ratio,timestamp]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_reading_history(app: AppHandle, id: String) -> Result<Vec<ReadingHistoryItem>, String> {
    let conn = open_book(&app, &id)?;
    let mut stmt=conn.prepare("SELECT position,title,ratio,updated_at FROM reading_history ORDER BY updated_at DESC LIMIT 40").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ReadingHistoryItem {
                position: row.get(0)?,
                title: row.get(1)?,
                ratio: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_reading_clips(app: AppHandle, id: String) -> Result<Vec<ReadingClip>, String> {
    let conn = open_book(&app, &id)?;
    let mut stmt=conn.prepare("SELECT id,position,chapter_title,quote,note,paragraph,created_at,updated_at FROM reading_clips ORDER BY updated_at DESC").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ReadingClip {
                id: row.get(0)?,
                position: row.get(1)?,
                chapter_title: row.get(2)?,
                quote: row.get(3)?,
                note: row.get(4)?,
                paragraph: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_reading_clip(app: AppHandle, input: NewClip) -> Result<ReadingClip, String> {
    let conn = open_book(&app, &input.book_id)?;
    save_clip_in(&conn, input)
}

#[tauri::command]
pub fn update_reading_clip(
    app: AppHandle,
    id: String,
    clip_id: String,
    note: String,
) -> Result<(), String> {
    Uuid::parse_str(&clip_id).map_err(|_| "无效的片段 ID".to_string())?;
    if note.chars().count() > 2000 {
        return Err("备注不能超过 2000 字".into());
    }
    let conn = open_book(&app, &id)?;
    let changed = conn
        .execute(
            "UPDATE reading_clips SET note=?,updated_at=? WHERE id=?",
            params![note.trim(), now(), clip_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("收藏片段不存在".into());
    }
    Ok(())
}

#[tauri::command]
pub fn delete_reading_clip(app: AppHandle, id: String, clip_id: String) -> Result<(), String> {
    Uuid::parse_str(&clip_id).map_err(|_| "无效的片段 ID".to_string())?;
    let conn = open_book(&app, &id)?;
    let changed = conn
        .execute("DELETE FROM reading_clips WHERE id=?", params![clip_id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("收藏片段不存在".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_progress_and_nonexistent_or_modified_quotes() {
        assert!(validate_ratio(f64::NAN).is_err());
        assert!(validate_ratio(1.1).is_err());
        assert_eq!(validate_ratio(0.75).unwrap(), 0.75);
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE chapters(position INTEGER PRIMARY KEY,title TEXT,content TEXT);CREATE TABLE reading_clips(id TEXT PRIMARY KEY,position INTEGER,chapter_title TEXT,quote TEXT,note TEXT,paragraph INTEGER,created_at TEXT,updated_at TEXT);INSERT INTO chapters VALUES(0,'第一章','这里是一段完整的正文，标点也在。');").unwrap();
        let create = |quote: &str| NewClip {
            book_id: "test".into(),
            position: 0,
            quote: quote.into(),
            note: "写法很好".into(),
            paragraph: 0,
        };
        let clip = save_clip_in(&conn, create("一段完整的正文，标点")).unwrap();
        assert_eq!(clip.chapter_title, "第一章");
        assert!(save_clip_in(&conn, create("正文里不存在的文字")).is_err());
    }
}
