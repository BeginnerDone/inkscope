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
    pub message: String,
}

pub fn source(app: &AppHandle, book: &BookSummary) -> Result<(String, String), String> {
    if let Some(receipt) = &book.download_receipt { return Ok((receipt.source_key.clone(), receipt.book_url.clone())); }
    let (name, url) = book.source_uri.split_once(" · ").ok_or("没有可用于下载的原书源记录")?;
    Ok((legado::key_for_source_name(app, name)?, url.to_owned()))
}

pub async fn prepare(app: &AppHandle, id: &str) -> Result<Preparation, String> {
    let book = read_book(app, id)?;
    if book.source_type != "legado" {
        return Ok(Preparation {book, can_download:false,message:"将逐段审读已保存文件的全部正文。文件是否包含作品全本需由你确认；应用不会仅凭文件名判断完结。".into()});
    }
    if book.content_status == "complete" {
        return Ok(Preparation {book,can_download:true,message:"已保存上次核对的书源目录全部章节，无需重复下载。后续连载更新不包含在本次完整性记录中。".into()});
    }
    let (source_key, book_url) = match source(app, &book) {
        Ok(value) => value,
        Err(error) => return Ok(Preparation {book,can_download:false,message:format!("完整性未确认，无法自动下载：{error}。可返回重新选择书源，或明确仅分析现有正文。")}),
    };
    if book.download_receipt.is_some() {
        return Ok(Preparation {book,can_download:true,message:"现有正文未包含下载时的全部目录章节。建议下载完整正文后自动分析；下载失败会保留原正文和报告。".into()});
    }
    // Legacy imports have no receipt. Only a strict ordered title/body match is
    // accepted; a count alone is insufficient to call a download complete.
    let catalog = match legado::preview_toc(app.clone(), legado::PreviewRequest {source_key:source_key.clone(),book_url:book_url.clone()}).await {
        Ok(value) => value,
        Err(error) => return Ok(Preparation {book,can_download:true,message:format!("暂时无法核对书源目录：{error}。完整性仍未知，可尝试重新下载。")}),
    };
    let local = {
        let conn=open_book(app,id)?;
        let mut stmt=conn.prepare("SELECT title,content FROM chapters ORDER BY position").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).map_err(|e|e.to_string())?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
    };
    if reading::catalog_matches(&local,&catalog) {
        let receipt=reading::Receipt {source_key,book_url,total_chapters:catalog.len(),downloaded_chapters:local.len(),failed_chapters:0,checked_at:now()};
        save(&open_book(app,id)?,&receipt)?;
        return Ok(Preparation {book:read_book(app,id)?,can_download:true,message:"已核对当前目录：章节顺序、名称与本地正文匹配，无需补全。".into()});
    }
    Ok(Preparation {book,can_download:true,message:format!("书源当前有 {} 章，本地目录或正文与之不匹配。建议下载完整正文后自动分析。",catalog.len())})
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
