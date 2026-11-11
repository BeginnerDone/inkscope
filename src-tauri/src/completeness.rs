use crate::*;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

static BUSY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
pub struct BookOperation(String);
impl BookOperation {
    pub fn acquire(id: &str) -> Result<Self, String> {
        let mut ids = BUSY.get_or_init(Mutex::default).lock().map_err(|_| "书籍操作锁不可用")?;
        if !ids.insert(id.into()) { return Err("该书正在下载或分析，请等待完成".into()); }
        Ok(Self(id.into()))
    }
}
impl Drop for BookOperation {
    fn drop(&mut self) {
        if let Ok(mut ids) = BUSY.get_or_init(Mutex::default).lock() { ids.remove(&self.0); }
    }
}

pub fn load(conn: &Connection) -> Result<Option<reading::Receipt>, String> {
    let raw = conn.query_row("SELECT receipt_json FROM source_import WHERE id=1", [], |row| row.get::<_, String>(0)).optional().map_err(|e| e.to_string())?;
    raw.map(|value| serde_json::from_str(&value).map_err(|e| format!("下载记录损坏: {e}"))).transpose()
}
pub fn save(conn: &Connection, receipt: &reading::Receipt) -> Result<(), String> {
    conn.execute("INSERT INTO source_import(id,receipt_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET receipt_json=excluded.receipt_json", params![serde_json::to_string(receipt).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Preparation {
    pub book: BookSummary,
    pub can_download: bool,
    pub can_analyze_local: bool,
    pub message: String,
}

pub fn source(app: &AppHandle, book: &BookSummary) -> Result<(String, String), String> {
    if let Some(receipt) = &book.download_receipt { return Ok((receipt.source_key.clone(), receipt.book_url.clone())); }
    let (name, url) = book.source_uri.split_once(" · ").ok_or("没有可用于下载的原书源记录")?;
    Ok((legado::key_for_source_name(app, name)?, url.to_owned()))
}

pub async fn prepare(app: &AppHandle, id: &str) -> Result<Preparation, String> {
    let mut book = read_book(app, id)?;
    let content = local_content(&open_book(app, id)?)?;
    let can_analyze_local = !content.trim().is_empty();
    book.character_count = content.chars().count() as i64;
    if book.source_type != "legado" {
        return Ok(Preparation {book,can_analyze_local, can_download:false,message:"将逐段审读已保存文件的全部正文。文件是否包含作品全本需由你确认；应用不会仅凭文件名判断完结。".into()});
    }
    if book.content_status == "complete" {
        return Ok(Preparation {book,can_analyze_local,can_download:true,message:"已保存上次核对的书源目录全部章节，无需重复下载。后续连载更新不包含在本次完整性记录中。".into()});
    }
    let _source = match source(app, &book) {
        Ok(value) => value,
        Err(error) => return Ok(Preparation {book,can_analyze_local,can_download:false,message:format!("完整性未确认，无法自动下载：{error}。可以直接分析本地正文。")}),
    };
    if book.download_receipt.is_some() {
        return Ok(Preparation {book,can_analyze_local,can_download:true,message:"现有正文未包含下载时的全部目录章节。可以直接分析已保存正文，也可选择补全下载；下载失败会保留原正文和报告。".into()});
    }
    // Old imports predate receipts. Unknown completeness is not missing content.
    // Preparing a local analysis must never depend on a live source catalog.
    Ok(Preparation {book,can_analyze_local,can_download:true,message:"旧版导入未记录下载完整性，本地正文仍可直接分析。报告会标明仅覆盖已保存正文；如需补全或获取后续更新，可选择下载。".into()})
}

pub async fn refresh(app: &AppHandle, id: &str, progress_id: Option<String>) -> Result<BookSummary, String> {
    let prepared=prepare(app,id).await?;
    if prepared.book.content_status=="complete" { return Ok(prepared.book); }
    if prepared.book.source_type!="legado" { return Err("此书没有可补全的书源".into()); }
    let (source_key,book_url)=source(app,&prepared.book)?;
    let extracted=legado::extract(app.clone(),legado::ExtractRequest {source_key,book_url,title:prepared.book.title,max_chapters:0,progress_id}).await?;
    if !extracted.receipt.complete() {
        return Err(format!("有 {} 章下载失败，未替换原正文和报告。请稍后重试或更换书源。",extracted.failed_chapters));
    }
    if extracted.receipt.total_chapters < prepared.book.download_receipt.as_ref().map_or(0, |receipt| receipt.downloaded_chapters)
        || extracted.content.chars().count() < prepared.book.character_count as usize {
        return Err("书源新返回的正文少于已保存内容，未覆盖原正文和报告。请检查书源目录或稍后重试。".into());
    }
    let mut conn=open_book(app,id)?;
    let tx=conn.transaction().map_err(|e|e.to_string())?;
    let content=extracted.content.trim();
    tx.execute("UPDATE book SET content=?,character_count=?,updated_at=?",params![content,content.chars().count() as i64,now()]).map_err(|e|e.to_string())?;
    tx.execute_batch("DELETE FROM chapters; DELETE FROM chunks; DELETE FROM analysis_modules; DELETE FROM report;").map_err(|e|e.to_string())?;
    save(&tx,&extracted.receipt)?;
    for (position,(title,body)) in chapters_from_content(&extracted.title,content).into_iter().enumerate() {
        tx.execute("INSERT INTO chapters(position,title,content,character_count) VALUES(?,?,?,?)",params![position as i64,title,body,body.chars().count() as i64]).map_err(|e|e.to_string())?;
    }
    tx.execute_batch("DELETE FROM reading_history WHERE NOT EXISTS (SELECT 1 FROM chapters WHERE chapters.position=reading_history.position AND chapters.title=reading_history.title); DELETE FROM reading_progress WHERE NOT EXISTS (SELECT 1 FROM reading_history WHERE reading_history.position=reading_progress.position);").map_err(|e|e.to_string())?;
    tx.execute("UPDATE analysis_job SET status='ready',stage='完整正文已保存，等待分析',completed=0,total=0,error=NULL,updated_at=? WHERE id=1",params![now()]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;
    read_book(app,id)
}

/// Use the same persisted text as export, without requesting a book source.
pub fn local_content(conn: &Connection) -> Result<String, String> {
    let content: String = conn.query_row("SELECT content FROM book LIMIT 1", [], |row| row.get(0)).map_err(|e|e.to_string())?;
    if !content.trim().is_empty() { return Ok(content); }
    let mut stmt = conn.prepare("SELECT title,content FROM chapters ORDER BY position").map_err(|e|e.to_string())?;
    let rows = stmt.query_map([], |row| Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?))).map_err(|e|e.to_string())?;
    let mut chapters = Vec::new();
    for row in rows {
        let (title, body) = row.map_err(|e|e.to_string())?;
        if !body.trim().is_empty() { chapters.push(format!("{title}\n{body}")); }
    }
    Ok(chapters.join("\n\n"))
}

pub fn allow_analysis(source_type: &str, status: &str, content: &str, allow_partial: bool) -> Result<(), String> {
    if content.trim().is_empty() { return Err("本地尚无可分析正文，请先导入或下载正文".into()); }
    if source_type == "legado" && status != "complete" && !allow_partial {
        return Err("完整性尚未确认，可选择“分析本地正文”或补全下载后分析".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_and_partial_text_can_be_analyzed_without_claiming_completeness() {
        for status in ["unknown", "partial"] {
            assert!(allow_analysis("legado", status, "本地正文", true).is_ok());
            assert!(allow_analysis("legado", status, "本地正文", false).is_err());
        }
        assert!(allow_analysis("legado", "complete", "本地正文", false).is_ok());
        assert!(allow_analysis("file", "local", "本地正文", false).is_ok());
        assert!(allow_analysis("legado", "complete", "  ", true).is_err());
    }
    #[test]
    fn chapter_only_legacy_book_uses_the_exportable_local_text_in_order() {
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE book(content TEXT); INSERT INTO book VALUES(''); CREATE TABLE chapters(position INTEGER,title TEXT,content TEXT); INSERT INTO chapters VALUES(1,'第二章','正文二'),(0,'第一章','正文一'),(2,'第三章','');").unwrap();
        assert_eq!(local_content(&conn).unwrap(), "第一章\n正文一\n\n第二章\n正文二");
        conn.execute("UPDATE book SET content='原始全文'", []).unwrap();
        assert_eq!(local_content(&conn).unwrap(), "原始全文");
    }
}
