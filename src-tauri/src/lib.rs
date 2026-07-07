use chrono::Utc;
use regex::Regex;
use reqwest::Url;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, io::Write, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

mod legado;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelConfig {
    api_key: String,
    model: String,
    base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBookInput {
    title: String,
    source_type: String,
    source_uri: Option<String>,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractedPage {
    title: String,
    content: String,
    source_uri: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BookSummary {
    id: String,
    title: String,
    source_type: String,
    source_uri: String,
    character_count: i64,
    created_at: String,
    updated_at: String,
    status: String,
    stage: String,
    completed: i64,
    total: i64,
    error: Option<String>,
    model: String,
    report: Option<Value>,
    job_started_at: String,
    job_updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChapterSummary {
    position: i64,
    title: String,
    character_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChapterDetail {
    position: i64,
    title: String,
    content: String,
    character_count: i64,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn books_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?
        .join("books");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建书库目录: {e}"))?;
    Ok(dir)
}

fn book_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Uuid::parse_str(id).map_err(|_| "无效的书籍 ID".to_string())?;
    Ok(books_dir(app)?.join(format!("{id}.sqlite")))
}

fn open_book(app: &AppHandle, id: &str) -> Result<Connection, String> {
    let path=book_path(app,id)?;
    if !path.exists(){return Err("书籍数据库不存在或已删除".into())}
    let mut conn = Connection::open(path).map_err(|e| format!("无法打开书籍数据库: {e}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS book(
           id TEXT PRIMARY KEY, title TEXT NOT NULL, source_type TEXT NOT NULL,
           source_uri TEXT NOT NULL DEFAULT '', content TEXT NOT NULL,
           character_count INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS chunks(
           id INTEGER PRIMARY KEY AUTOINCREMENT, position INTEGER NOT NULL UNIQUE,
           content TEXT NOT NULL, summary_json TEXT, summary_version INTEGER NOT NULL DEFAULT 1
         );
         CREATE TABLE IF NOT EXISTS analysis_job(
           id INTEGER PRIMARY KEY CHECK(id=1), status TEXT NOT NULL, stage TEXT NOT NULL,
           completed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
           error TEXT, updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS report(
           id INTEGER PRIMARY KEY CHECK(id=1), report_json TEXT NOT NULL,
           model TEXT NOT NULL, created_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS analysis_modules(
           name TEXT PRIMARY KEY, report_json TEXT NOT NULL, updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS chapters(
           id INTEGER PRIMARY KEY AUTOINCREMENT, position INTEGER NOT NULL UNIQUE,
           title TEXT NOT NULL, content TEXT NOT NULL, source_uri TEXT NOT NULL DEFAULT '',
           character_count INTEGER NOT NULL DEFAULT 0
         );",
    )
    .map_err(|e| format!("无法初始化书籍数据库: {e}"))?;
    let _ = conn.execute("ALTER TABLE analysis_job ADD COLUMN started_at TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE chunks ADD COLUMN summary_version INTEGER NOT NULL DEFAULT 1", []);
    backfill_chapters(&mut conn)?;
    Ok(conn)
}

fn clean_reader_text(raw: &str) -> String {
    let breaks = Regex::new(r"(?i)<br\s*/?>|</p>|</div>").unwrap().replace_all(raw, "\n");
    let tags = Regex::new(r"(?is)<[^>]+>").unwrap().replace_all(&breaks, "");
    let text = html_escape::decode_html_entities(&tags).to_string();
    Regex::new(r"\n{3,}").unwrap().replace_all(text.trim(), "\n\n").to_string()
}

fn chapters_from_content(book_title: &str, content: &str) -> Vec<(String,String)> {
    let mut chapters = Vec::new();
    let mut title = String::new();
    let mut body = String::new();
    for line in content.lines() {
        if let Some(next_title) = line.strip_prefix("# ") {
            if !title.is_empty() || !body.trim().is_empty() {
                chapters.push((if title.is_empty(){book_title.to_string()}else{title}, clean_reader_text(&body)));
            }
            title = next_title.trim().to_string(); body.clear();
        } else { body.push_str(line); body.push('\n'); }
    }
    if !title.is_empty() || !body.trim().is_empty() { chapters.push((if title.is_empty(){book_title.to_string()}else{title}, clean_reader_text(&body))); }
    if chapters.is_empty() && !content.trim().is_empty() { chapters.push((book_title.to_string(), clean_reader_text(content))); }
    chapters
}

fn backfill_chapters(conn: &mut Connection) -> Result<(), String> {
    let count:i64=conn.query_row("SELECT COUNT(*) FROM chapters",[],|row|row.get(0)).map_err(|e|e.to_string())?;
    if count>0{return Ok(())}
    let book=conn.query_row("SELECT title,content,source_uri FROM book LIMIT 1",[],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?))).optional().map_err(|e|e.to_string())?;
    let Some((book_title,content,source_uri))=book else{return Ok(())};
    let chapters=chapters_from_content(&book_title,&content);let tx=conn.transaction().map_err(|e|e.to_string())?;
    for(position,(title,chapter))in chapters.into_iter().enumerate(){tx.execute("INSERT INTO chapters(position,title,content,source_uri,character_count) VALUES(?,?,?,?,?)",params![position as i64,title,chapter,source_uri,chapter.chars().count() as i64]).map_err(|e|e.to_string())?;}
    tx.commit().map_err(|e|e.to_string())?;Ok(())
}

fn update_job(
    app: &AppHandle,
    id: &str,
    status: &str,
    stage: &str,
    completed: i64,
    total: i64,
    error: Option<&str>,
) -> Result<(), String> {
    let conn = open_book(app, id)?;
    conn.execute(
        "INSERT INTO analysis_job(id,status,stage,completed,total,error,updated_at)
         VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
         status=excluded.status,stage=excluded.stage,completed=excluded.completed,
         total=excluded.total,error=excluded.error,updated_at=excluded.updated_at",
        params![status, stage, completed, total, error, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn begin_job(app: &AppHandle, id: &str) -> Result<(), String> {
    let conn = open_book(app, id)?;
    let timestamp = now();
    conn.execute(
        "INSERT INTO analysis_job(id,status,stage,completed,total,error,updated_at,started_at)
         VALUES(1,'analyzing','启动分析',0,1,NULL,?,?) ON CONFLICT(id) DO UPDATE SET
         status='analyzing',stage='启动分析',completed=0,total=1,error=NULL,
         updated_at=excluded.updated_at,started_at=excluded.started_at",
        params![timestamp, timestamp],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn fail_job(app: &AppHandle, id: &str, error: &str) -> Result<(), String> {
    let conn=open_book(app,id)?;
    conn.execute("UPDATE analysis_job SET status='failed',stage='分析失败',error=?,updated_at=? WHERE id=1",params![error,now()]).map_err(|e|e.to_string())?;
    Ok(())
}

fn read_book(app: &AppHandle, id: &str) -> Result<BookSummary, String> {
    let conn = open_book(app, id)?;
    let mut book = conn
        .query_row(
            "SELECT id,title,source_type,source_uri,character_count,created_at,updated_at FROM book LIMIT 1",
            [],
            |row| {
                Ok(BookSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    source_type: row.get(2)?,
                    source_uri: row.get(3)?,
                    character_count: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                    status: "ready".into(),
                    stage: String::new(),
                    completed: 0,
                    total: 0,
                    error: None,
                    model: String::new(),
                    report: None,
                    job_started_at: String::new(),
                    job_updated_at: String::new(),
                })
            },
        )
        .map_err(|e| format!("无法读取书籍: {e}"))?;
    if let Some(job) = conn
        .query_row(
            "SELECT status,stage,completed,total,error,started_at,updated_at FROM analysis_job WHERE id=1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        book.status = job.0;
        book.stage = job.1;
        book.completed = job.2;
        book.total = job.3;
        book.error = job.4;
        book.job_started_at = job.5;
        book.job_updated_at = job.6;
    }
    if let Some((report_json, model)) = conn
        .query_row(
            "SELECT report_json,model FROM report WHERE id=1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        book.report = serde_json::from_str(&report_json).ok();
        book.model = model;
    }
    Ok(book)
}

fn recover_interrupted_jobs(app: &AppHandle) -> Result<(), String> {
    for entry in fs::read_dir(books_dir(app)?).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|v| v.to_str()) != Some("sqlite") { continue; }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE analysis_job SET status='failed',stage='分析被客户端重启中断',
             error='上次分析未正常结束，可以直接重新分析。原文与已抓取章节仍保留。',updated_at=?
             WHERE status='analyzing'",
            params![now()],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn list_books(app: AppHandle, query: Option<String>) -> Result<Vec<BookSummary>, String> {
    let query = query.unwrap_or_default().to_lowercase();
    let mut books = Vec::new();
    for entry in fs::read_dir(books_dir(&app)?).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|v| v.to_str()) != Some("sqlite") {
            continue;
        }
        if let Some(id) = path.file_stem().and_then(|v| v.to_str()) {
            if let Ok(book) = read_book(&app, id) {
                let searchable = format!(
                    "{} {}",
                    book.title,
                    book.report
                        .as_ref()
                        .map(Value::to_string)
                        .unwrap_or_default()
                )
                .to_lowercase();
                if query.is_empty() || searchable.contains(&query) {
                    books.push(book);
                }
            }
        }
    }
    books.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(books)
}

#[tauri::command]
fn get_book(app: AppHandle, id: String) -> Result<BookSummary, String> {
    read_book(&app, &id)
}

#[tauri::command]
fn list_chapters(app: AppHandle, id: String) -> Result<Vec<ChapterSummary>, String> {
    let conn=open_book(&app,&id)?;let mut stmt=conn.prepare("SELECT position,title,character_count FROM chapters ORDER BY position").map_err(|e|e.to_string())?;
    let rows=stmt.query_map([],|row|Ok(ChapterSummary{position:row.get(0)?,title:row.get(1)?,character_count:row.get(2)?})).map_err(|e|e.to_string())?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
}

#[tauri::command]
fn get_chapter(app: AppHandle, id: String, position: i64) -> Result<ChapterDetail, String> {
    let conn=open_book(&app,&id)?;
    conn.query_row("SELECT position,title,content,character_count FROM chapters WHERE position=?",params![position],|row|Ok(ChapterDetail{position:row.get(0)?,title:row.get(1)?,content:row.get(2)?,character_count:row.get(3)?})).map_err(|e|format!("无法读取章节: {e}"))
}

fn safe_file_name(value:&str)->String{value.chars().map(|c|if matches!(c,'/'|'\\'|':'|'*'|'?'|'"'|'<'|'>'|'|'){ '_' }else{c}).collect::<String>().trim().to_string()}

fn docx_paragraph(text:&str,heading:bool)->String{
    let escaped=html_escape::encode_text(text);
    if heading{format!(r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>{escaped}</w:t></w:r></w:p>"#)}
    else{format!(r#"<w:p><w:pPr><w:ind w:firstLine="420"/><w:spacing w:line="480" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">{escaped}</w:t></w:r></w:p>"#)}
}

fn write_docx(path:&std::path::Path,title:&str,chapters:&[(String,String)])->Result<(),String>{
    let file=fs::File::create(path).map_err(|e|e.to_string())?;let mut zip=zip::ZipWriter::new(file);let options=zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let content_types=r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>"#;
    let rels=r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let styles=r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="360" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style></w:styles>"#;
    zip.start_file("[Content_Types].xml",options).map_err(|e|e.to_string())?;zip.write_all(content_types.as_bytes()).map_err(|e|e.to_string())?;zip.add_directory("_rels/",options).map_err(|e|e.to_string())?;zip.start_file("_rels/.rels",options).map_err(|e|e.to_string())?;zip.write_all(rels.as_bytes()).map_err(|e|e.to_string())?;zip.add_directory("word/",options).map_err(|e|e.to_string())?;zip.start_file("word/styles.xml",options).map_err(|e|e.to_string())?;zip.write_all(styles.as_bytes()).map_err(|e|e.to_string())?;
    zip.start_file("word/document.xml",options).map_err(|e|e.to_string())?;let mut document=String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>"#);document.push_str(&docx_paragraph(title,true));for(chapter_title,content)in chapters{document.push_str(&docx_paragraph(chapter_title,true));for line in content.lines(){if line.trim().is_empty(){document.push_str("<w:p/>")}else{document.push_str(&docx_paragraph(line,false))}}}document.push_str(r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#);zip.write_all(document.as_bytes()).map_err(|e|e.to_string())?;zip.finish().map_err(|e|e.to_string())?;Ok(())
}

#[tauri::command]
fn export_book(app:AppHandle,id:String,format:String)->Result<String,String>{
    let conn=open_book(&app,&id)?;let title:String=conn.query_row("SELECT title FROM book LIMIT 1",[],|row|row.get(0)).map_err(|e|e.to_string())?;let mut stmt=conn.prepare("SELECT title,content FROM chapters ORDER BY position").map_err(|e|e.to_string())?;let chapters=stmt.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;if chapters.is_empty(){return Err("书籍尚未下载章节，无法导出".into())}
    let dir=app.path().download_dir().map_err(|e|format!("无法定位下载目录: {e}"))?;fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let base=safe_file_name(&title);let stamp=Utc::now().format("%Y%m%d-%H%M%S");
    let path=match format.as_str(){"txt"=>dir.join(format!("{base}-{stamp}.txt")),"docx"=>dir.join(format!("{base}-{stamp}.docx")),_=>return Err("仅支持 txt 或 docx 导出".into())};
    if format=="txt"{let mut output=format!("《{title}》\n\n");for(chapter_title,content)in &chapters{output.push_str(&format!("{chapter_title}\n\n{content}\n\n"));}fs::write(&path,output).map_err(|e|format!("TXT 导出失败: {e}"))?;}else{write_docx(&path,&title,&chapters)?}Ok(path.display().to_string())
}

#[tauri::command]
fn create_book(app: AppHandle, input: CreateBookInput) -> Result<BookSummary, String> {
    let title = input.title.trim();
    let content = input.content.trim();
    if title.is_empty() {
        return Err("请输入作品名".into());
    }
    if content.chars().count() < 80 {
        return Err("正文至少需要 80 个字符".into());
    }
    let id = Uuid::new_v4().to_string();
    fs::OpenOptions::new().write(true).create_new(true).open(book_path(&app,&id)?).map_err(|e|format!("无法创建书籍数据库文件: {e}"))?;
    let mut conn = open_book(&app, &id)?;
    let timestamp = now();
    conn.execute(
        "INSERT INTO book(id,title,source_type,source_uri,content,character_count,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?)",
        params![id, title, input.source_type, input.source_uri.unwrap_or_default(), content, content.chars().count() as i64, timestamp, timestamp],
    )
    .map_err(|e| e.to_string())?;
    backfill_chapters(&mut conn)?;
    drop(conn);
    update_job(&app, &id, "ready", "等待分析", 0, 0, None)?;
    read_book(&app, &id)
}

#[tauri::command]
fn delete_book(app: AppHandle, id: String) -> Result<(), String> {
    let path = book_path(&app, &id)?;
    let _ = fs::remove_file(books_dir(&app)?.join(format!("{id}.sqlite-wal")));
    let _ = fs::remove_file(books_dir(&app)?.join(format!("{id}.sqlite-shm")));
    if path.exists(){fs::remove_file(&path).map_err(|e| format!("无法删除书籍数据库 {}: {e}",path.display()))?;}
    if path.exists(){return Err("数据库文件仍然存在，删除未完成".into())}
    Ok(())
}

fn split_content(content: &str, target: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < content.len() {
        let mut end = (start + target).min(content.len());
        while end > start && !content.is_char_boundary(end) {
            end -= 1;
        }
        if end < content.len() {
            let mut search_start = start + ((end - start) * 7 / 10);
            while search_start < end && !content.is_char_boundary(search_start) {
                search_start += 1;
            }
            if let Some(relative) = content[search_start..end].rfind(['\n', '。']) {
                end = search_start + relative;
                while end < content.len() && !content.is_char_boundary(end) {
                    end += 1;
                }
            }
        }
        if end <= start {
            break;
        }
        chunks.push(content[start..end].to_string());
        start = end;
    }
    chunks
}

async fn call_deepseek(
    config: &ModelConfig,
    messages: Value,
    max_tokens: u32,
) -> Result<Value, String> {
    if config.api_key.trim().is_empty() {
        return Err("请输入 DeepSeek API Key".into());
    }
    let base = config
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.deepseek.com".into());
    let url = Url::parse(&format!("{}/chat/completions", base.trim_end_matches('/')))
        .map_err(|_| "无效的 API 地址".to_string())?;
    if url.scheme() != "https" {
        return Err("API 地址必须使用 HTTPS".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request_messages = messages;
    let mut last_error = String::new();
    for attempt in 0..3 {
        let attempt_tokens = max_tokens.saturating_mul(1_u32 << attempt).min(384_000);
        let response = client.post(url.clone()).bearer_auth(&config.api_key).json(&json!({
                "model": config.model, "messages": request_messages,
                "response_format": {"type":"json_object"}, "max_tokens": attempt_tokens,
                "thinking": {"type":"disabled"}, "stream": false
            })).send().await.map_err(|e| format!("DeepSeek 网络请求失败: {e}"))?;
        let status = response.status();
        let payload: Value = response.json().await.map_err(|e| format!("DeepSeek 响应无法解析: {e}"))?;
        if !status.is_success() {
            return Err(payload.pointer("/error/message").and_then(Value::as_str).unwrap_or("未知 API 错误").to_string());
        }
        let raw = payload.pointer("/choices/0/message/content").and_then(Value::as_str)
            .ok_or_else(|| "DeepSeek 未返回内容".to_string())?;
        let finish = payload.pointer("/choices/0/finish_reason").and_then(Value::as_str).unwrap_or("");
        let clean = raw.trim().trim_start_matches("```json").trim_end_matches("```").trim();
        if finish != "length" {
            match parse_model_json(clean) {
                Ok(value) => return Ok(value),
                Err(error) => last_error = error,
            }
        } else {
            last_error = "输出达到 token 上限，JSON 被截断".into();
        }
        if attempt < 2 {
            if let Some(items) = request_messages.as_array_mut() {
                items.push(json!({"role":"user","content":format!("上一次输出不是合法 JSON（{}）。请从头重新生成，不要续写上次内容。只能输出一个完整 JSON 对象；保留字段但精炼内容；字符串内部的双引号必须转义；对象成员之间必须有逗号；不要 Markdown；务必闭合所有字符串、数组和对象。",last_error)}));
            }
        }
    }
    Err(format!("DeepSeek 连续 3 次返回无法解析的 JSON（{last_error}）。已保留此前完成的片段和报告模块，可直接重试当前分析。"))
}

fn parse_model_json(raw: &str) -> Result<Value, String> {
    let candidate = match (raw.find('{'), raw.rfind('}')) {
        (Some(start), Some(end)) if end >= start => &raw[start..=end],
        _ => raw,
    };
    if let Ok(value) = serde_json::from_str(candidate) { return Ok(value); }
    let mut repaired = String::with_capacity(candidate.len() + 32);
    let mut in_string = false;
    let mut escaped = false;
    for ch in candidate.chars() {
        if in_string {
            if escaped { repaired.push(ch); escaped = false; continue; }
            match ch {
                '\\' => { repaired.push(ch); escaped = true; }
                '"' => { repaired.push(ch); in_string = false; }
                '\n' => repaired.push_str("\\n"),
                '\r' => repaired.push_str("\\r"),
                '\t' => repaired.push_str("\\t"),
                '\u{08}' => repaired.push_str("\\b"),
                '\u{0C}' => repaired.push_str("\\f"),
                c if c <= '\u{1F}' => repaired.push_str(&format!("\\u{:04x}", c as u32)),
                _ => repaired.push(ch),
            }
        } else {
            if ch == '"' { in_string = true; }
            if ch == '\0' { continue; }
            repaired.push(ch);
        }
    }
    serde_json::from_str(&repaired).map_err(|e| format!("DeepSeek 返回的 JSON 修复后仍无法解析: {e}"))
}

#[tauri::command]
async fn test_model(config: ModelConfig) -> Result<bool, String> {
    let result = call_deepseek(
        &config,
        json!([{"role":"system","content":"输出严格 JSON。"},{"role":"user","content":"只输出 {\"ok\":true}"}]),
        100,
    ).await?;
    Ok(result.get("ok").and_then(Value::as_bool) == Some(true))
}

fn chunk_prompt(text: &str, index: usize, total: usize) -> String {
    format!(
        r#"这是作品的第 {index}/{total} 个原文片段。你正在为零基础小说作者制作“写作教学型拆书”，只根据原文输出：
{{
 "summary":"本片段发生了什么，以及它在全书结构中的作用",
 "segmentFunction":"开篇钩子/铺垫/推进/转折/高潮准备/高潮/收束/过渡等",
 "threads":[{{"type":"主线/辅线/暗线","name":"线索名称","movement":"本段如何推进","intersection":"与其他线的交汇"}}],
 "characters":[{{"name":"","entranceOrExit":"如何出场、退场或转入新阶段","desire":"当下欲望","conflict":"外部与内部冲突","action":"关键选择与行动","change":"前后变化","technique":"作者用何种动作、对话、反差或细节塑造","evidence":"简短转述证据"}}],
 "scenes":[{{"place":"","purpose":"场景承担的叙事任务","entry":"如何进入场景","sensory":"环境与感官细节","conflict":"场内冲突如何升级","transition":"如何离开或转场","evidence":"简短证据"}}],
 "foreshadowing":[{{"setup":"埋了什么","possiblePayoff":"可能如何回收或已如何回收","distance":"近/中/长线","evidence":""}}],
 "craft":[{{"technique":"具体技巧","evidence":"简短转述","effect":"读者效果","beginnerUse":"新人可照做的步骤","pitfall":"常见写坏方式"}}],
 "emotion":{{"label":"","tension":0}},
 "readerExperience":{{"expectation":"本段建立或延续了什么期待","delay":"如何延迟兑现但不令人烦躁","escalation":"如何加码代价、压制、误解或见证者","payoff":"本段兑现了什么爽点","payoffType":"成长/反击/揭秘/获得/认可/情感/智谋/权力等","intensity":0,"nextHook":"兑现后留下的下一个期待","evidence":"简短转述依据"}},
 "readerQuestion":"读完本段，读者最想知道什么",
 "uncertainties":[""]
}}
张力为 0-100 整数。证据只做简短转述，不要大段引用。区分事实与推断，不能补全原文没有的信息。不要只总结剧情，必须解释作者为何这样安排，以及新人怎样模仿其原理而不复制内容。

原文：
{text}"#
    )
}

fn final_prompt(title: &str, summaries: &[Value]) -> String {
    format!(
        r#"作品名：{title}
以下是按原文顺序得到的全部片段教学分析：{}

你是教零基础作者写长篇小说的资深总编。输出严格 JSON，必须把“剧情总结”提升为“作者施工图”：解释每项安排的目的、执行步骤、原文依据、读者效果、新人练习和常见误区。
{{
 "title":"","scope":"明确覆盖到哪些章节/阶段","oneLine":"一句话定义","coreJudgment":"最值得学习的布局能力","summary":"面向新人的全书教学综述","overallScore":0,
 "dimensions":[{{"name":"开篇/布局/人物/节奏/伏笔/场景等","score":0,"finding":"具体判断与依据"}}],
 "plot":{{"structure":"传统结构摘要","stages":[{{"name":"","summary":"","tension":0}}]}},
 "storyArchitecture":{{
   "premise":"故事发动机：谁、要什么、为何得不到、失败代价",
   "mainLine":"主线从起点到终点的因果链，不是事件堆砌",
   "secondaryLines":[{{"name":"辅线","purpose":"它如何塑造人物、调节节奏或服务主题","intersections":["与主线交汇点"]}}],
   "hiddenLines":[{{"name":"暗线","setup":"如何隐藏","reveal":"何时怎样揭示","effect":"揭示后的结构效果"}}],
   "opening":{{"design":"开篇策略","execution":["具体步骤"],"evidence":["原文转述依据"],"readerEffect":"读者为何继续读","beginnerMethod":["新人开篇可执行步骤"],"pitfalls":["常见错误"]}},
   "progression":{{"design":"铺垫和剧情推进策略","execution":["信息、冲突、目标如何逐层升级"],"evidence":["依据"],"readerEffect":"效果","beginnerMethod":["步骤"],"pitfalls":["误区"]}},
   "climax":{{"design":"高潮如何提前蓄力、汇线、升级代价并爆发","execution":["步骤"],"evidence":["依据"],"readerEffect":"效果","beginnerMethod":["步骤"],"pitfalls":["误区"]}},
   "ending":{{"design":"结尾如何回收、兑现情绪并开启余韵/下一卷","execution":["步骤"],"evidence":["依据"],"readerEffect":"效果","beginnerMethod":["步骤"],"pitfalls":["误区"]}},
   "chapterBlueprint":[{{"phase":"阶段","goal":"作者在此阶段必须完成什么","chapters":"覆盖范围","conflict":"核心冲突","turningPoint":"转折点","readerQuestion":"维持追读的问题"}}]
 }},
 "characterDesign":[{{"name":"","role":"结构角色","core":"一句话性格核心","desire":"外在欲望","fear":"内在恐惧或缺口","entrance":"怎样出场并让读者记住","development":"通过哪些选择、代价和关系产生变化","relationships":"关系如何制造冲突并推动主线","exit":"怎样退场或完成阶段收束","techniques":["动作/对话/反差/细节等"],"evidence":"依据","exercise":"新人可立即完成的人物练习"}}],
 "characters":[{{"name":"","role":"","desire":"","arc":"","relationships":[""]}}],
 "foreshadowing":[{{"setup":"伏笔如何伪装进正常叙事","payoff":"何时如何回收或待验证","effect":"回收带来的认知/情绪/结构效果"}}],
 "sceneCraft":[{{"scene":"代表性场景","purpose":"场景任务","entry":"如何切入","sensory":"环境和感官细节如何选择","conflict":"场内冲突怎样变化","transition":"怎样转场","evidence":"依据","transfer":"新人可迁移模板"}}],
 "readerExperience":[{{"phase":"章节或阶段","expectation":"作者让读者期待什么结果","delay":"怎样延迟兑现又持续给进展","escalation":"如何增加压制、代价、见证者或信息差以提高爽感","payoff":"最终怎样兑现","payoffType":"成长/反击/揭秘/获得/认可/情感/智谋/权力等","intensity":0,"evidence":"原文转述依据","nextHook":"爽点后如何创造下一轮期待","method":["新人可执行步骤"],"pitfall":"无铺垫开挂、一直压抑不兑现等风险"}}],
 "writingLessons":[{{"topic":"开篇、铺垫、冲突、节奏、对话、悬念、高潮、结尾等具体课程","principle":"可复用原理","evidence":"原作怎样做","steps":["新人执行步骤"],"pitfall":"最常见失败方式","exercise":"不复制原作内容的练习题"}}],
 "crafts":[{{"title":"","evidence":"转述证据","method":"手法原理","transfer":"可迁移用法"}}],
 "ideas":[{{"title":"","premise":"","difference":"与原作明确不同","risk":"避免模仿提示"}}],
 "emotion":[{{"label":"阶段","value":0}}],
 "limitations":["分析限制"]
}}
至少给出：2条辅线、2条暗线（原文不足则明确不足）、8节写作课、5个代表场景、6组“立期待→延迟→加码→爽点兑现→下一钩子”、主要人物完整出场—发展—阶段退场分析。爽感必须区分类型，说明铺垫时长、价值加码和兑现强度，不得把单纯胜利当作有效爽点。所有分数 0-100。不得编造人物、事件或伏笔；无法确认时写入 limitations。不得长篇引用原文。灵感不得复制专名、人物和核心设定。"#,
        serde_json::to_string(summaries).unwrap_or_default()
    )
}

fn final_module_prompt(title: &str, summaries: &[Value], module: &str, schema: &str) -> String {
    format!(
        "作品名：{title}\n以下是按原文顺序得到的全部片段分析：{}\n\n你是教零基础作者写长篇小说的资深总编。本次只生成「{module}」模块，输出一个严格 JSON 对象，不要 Markdown。每项都要说明原文转述依据、读者效果和可执行方法，但要精炼，确保 JSON 完整闭合。不得编造，无法确认时明说。\n必须严格使用以下结构：\n{schema}",
        serde_json::to_string(summaries).unwrap_or_default()
    )
}

fn merge_report(target: &mut Value, module: Value) {
    if let (Some(target), Some(module)) = (target.as_object_mut(), module.as_object()) {
        for (key, value) in module { target.insert(key.clone(), value.clone()); }
    }
}

async fn run_analysis(app: AppHandle, id: String, config: ModelConfig) -> Result<(), String> {
    let (title, content) = {
        let conn = open_book(&app, &id)?;
        conn.query_row("SELECT title,content FROM book LIMIT 1", [], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
    };
    let chunks = split_content(&content, 100_000);
    let total = chunks.len() as i64 + 5;
    update_job(&app, &id, "analyzing", "准备原文切片", 0, total, None)?;
    {
        let mut conn = open_book(&app, &id)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for (index, chunk) in chunks.iter().enumerate() {
            tx.execute(
                "INSERT INTO chunks(position,content) VALUES(?,?) ON CONFLICT(position) DO UPDATE SET
                 summary_json=CASE WHEN chunks.content=excluded.content THEN chunks.summary_json ELSE NULL END,
                 summary_version=CASE WHEN chunks.content=excluded.content THEN chunks.summary_version ELSE 0 END,
                 content=excluded.content",
                params![index as i64, chunk],
            ).map_err(|e| e.to_string())?;
        }
        tx.execute("DELETE FROM chunks WHERE position>=?", params![chunks.len() as i64]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    let mut summaries = Vec::new();
    for (index, chunk) in chunks.iter().enumerate() {
        let cached = {
            let conn = open_book(&app, &id)?;
            conn.query_row("SELECT summary_json FROM chunks WHERE position=? AND summary_version=3", params![index as i64], |row| row.get::<_, Option<String>>(0))
                .optional().map_err(|e| e.to_string())?.flatten().and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        };
        if let Some(result) = cached {
            summaries.push(result);
            update_job(&app,&id,"analyzing",&format!("复用已完成片段 {}/{}",index+1,chunks.len()),index as i64+1,total,None)?;
            continue;
        }
        update_job(
            &app,
            &id,
            "analyzing",
            &format!("分析原文片段 {}/{}", index + 1, chunks.len()),
            index as i64,
            total,
            None,
        )?;
        let result = call_deepseek(
            &config,
            json!([
                {"role":"system","content":"你是专业中文网络小说编辑。只能根据提供的原文分析，禁止补全。输出严格 JSON，不要 Markdown。"},
                {"role":"user","content":chunk_prompt(chunk, index + 1, chunks.len())}
            ]),
            12_000,
        ).await?;
        {
            let conn = open_book(&app, &id)?;
            conn.execute(
                "UPDATE chunks SET summary_json=?,summary_version=3 WHERE position=?",
                params![result.to_string(), index as i64],
            )
            .map_err(|e| e.to_string())?;
        }
        summaries.push(result);
    }
    let modules = [
        ("总览与全书布局", r#"{"title":"","scope":"","oneLine":"","coreJudgment":"","summary":"","overallScore":0,"dimensions":[{"name":"","score":0,"finding":""}],"plot":{"structure":"","stages":[{"name":"","summary":"","tension":0}]},"storyArchitecture":{"premise":"","mainLine":"","secondaryLines":[{"name":"","purpose":"","intersections":[""]}],"hiddenLines":[{"name":"","setup":"","reveal":"","effect":""}],"opening":{"design":"","execution":[""],"evidence":[""],"readerEffect":"","beginnerMethod":[""],"pitfalls":[""]},"progression":{"design":"","execution":[""],"evidence":[""],"readerEffect":"","beginnerMethod":[""],"pitfalls":[""]},"climax":{"design":"","execution":[""],"evidence":[""],"readerEffect":"","beginnerMethod":[""],"pitfalls":[""]},"ending":{"design":"","execution":[""],"evidence":[""],"readerEffect":"","beginnerMethod":[""],"pitfalls":[""]},"chapterBlueprint":[{"phase":"","goal":"","chapters":"","conflict":"","turningPoint":"","readerQuestion":""}]},"emotion":[{"label":"","value":0}]}"#),
        ("人物、场景与伏笔", r#"{"characterDesign":[{"name":"","role":"","core":"","desire":"","fear":"","entrance":"","development":"","relationships":"","exit":"","techniques":[""],"evidence":"","exercise":""}],"characters":[{"name":"","role":"","desire":"","arc":"","relationships":[""]}],"sceneCraft":[{"scene":"","purpose":"","entry":"","sensory":"","conflict":"","transition":"","evidence":"","transfer":""}],"foreshadowing":[{"setup":"","payoff":"","effect":""}]}"#),
        ("期待感与爽感工程", r#"{"readerExperience":[{"phase":"","expectation":"","delay":"","escalation":"","payoff":"","payoffType":"成长/反击/揭秘/获得/认可/情感/智谋/权力","intensity":0,"evidence":"","nextHook":"","method":[""],"pitfall":""}]}"#),
        ("创作大纲与改编模板", r#"{"outline":{"originalBlueprint":{"premise":"原书故事发动机，用一句话说明谁、要什么、阻力、代价","fiveAct":[{"act":"第一幕/第二幕/第三幕/第四幕/第五幕","purpose":"本幕在全书中的结构任务","keyPlot":"本幕关键剧情链，不是散点罗列","climax":"本幕高潮点或小高潮","mainLine":"主线在本幕如何推进","hiddenLine":"暗线在本幕如何埋、藏、变形或揭示","readerExpectation":"本幕主要拉起的期待","payoff":"本幕兑现的爽点/情绪点","chapters":"覆盖章节或阶段范围","writingTask":"新人作者写这一幕时必须完成的动作"}],"volumes":[{"name":"卷名或阶段名","role":"该卷在全书中的结构作用","chapters":"覆盖章节范围","mainLine":"该卷主线推进","hiddenLine":"该卷暗线变化","keyPlots":["关键剧情1","关键剧情2","关键剧情3"],"climax":"该卷高潮点","endingHook":"卷尾钩子或下一卷期待","craftFocus":"该卷最值得学习的写作手法","newBookPlaceholder":"迁移到新书时应替换成什么，不得复制原作设定"}],"keyPlotBeats":["全书必须保留其功能、但不能复制内容的关键剧情节点"],"climaxLadder":["从小冲突到大高潮的升级台阶"],"mainLine":"全书主线因果链","hiddenLines":["暗线名称与埋设-揭示-回收路径"]},"reusableTemplate":{"title":"可复制的新书大纲模板标题","premise":"把原书结构抽象成可替换的新书简介占位说明","fiveAct":[{"act":"第一幕/第二幕/第三幕/第四幕/第五幕","task":"这一幕要完成的写作任务","mustHave":["必须出现的结构功能，不含原作专名"],"avoid":"避免复制原作的提醒"}],"volumes":[{"name":"新书第X卷占位名","role":"该卷功能","chapters":"建议章节范围","mainLine":"新书主线应如何推进","hiddenLine":"新书暗线应如何安排","keyPlots":["可替换的剧情功能点"],"climax":"高潮功能点","endingHook":"卷尾钩子功能","craftFocus":"训练重点","newBookPlaceholder":"让作者填写自己设定的位置"}],"characterTracks":[{"name":"人物功能名，不用原作专名","function":"结构功能","entrance":"出场任务","growth":"成长任务","turn":"转折任务","exit":"退场或阶段收束任务","reusableSlot":"作者应填入的新书人物设定"}],"threadMap":[{"thread":"主线/辅线/暗线功能名","type":"主线/辅线/暗线","setup":"如何埋设","development":"如何发展","payoff":"如何回收","reusableQuestion":"作者填自己作品时要回答的问题"}],"keyPlotBeats":["可迁移的关键剧情功能"],"climaxLadder":["可迁移的高潮升级阶梯"],"expectationPayoffRules":["立期待-延迟-加码-兑现-下一钩子的规则"],"fillInPrompt":"一段可直接复制给 AI 的提示词：要求根据用户新书简介，沿用本模板的结构功能，但禁止复制原作人物、专名、设定和核心事件，生成全新的分卷五幕式大纲"}}}"#),
        ("写作课与原创迁移", r#"{"writingLessons":[{"topic":"","principle":"","evidence":"","steps":[""],"pitfall":"","exercise":""}],"crafts":[{"title":"","evidence":"","method":"","transfer":""}],"ideas":[{"title":"","premise":"","difference":"","risk":""}],"limitations":[""]}"#),
    ];
    let mut report = json!({});
    for (module_index, (module_name, schema)) in modules.iter().enumerate() {
        update_job(&app,&id,"analyzing",&format!("综合报告 {}/5：{}",module_index+1,module_name),chunks.len() as i64+module_index as i64,total,None)?;
        let cached = {
            let conn=open_book(&app,&id)?;
            conn.query_row("SELECT report_json FROM analysis_modules WHERE name=?",params![module_name],|row|row.get::<_,String>(0))
                .optional().map_err(|e|e.to_string())?.and_then(|raw|serde_json::from_str(&raw).ok())
        };
        let module = if let Some(value)=cached { value } else {
            let value=call_deepseek(&config,json!([
                {"role":"system","content":"你是服务于小说作者的资深拆书编辑。结论必须可验证，不得编造。输出严格 JSON。"},
                {"role":"user","content":final_module_prompt(&title,&summaries,module_name,schema)}
            ]),32_000).await?;
            let conn=open_book(&app,&id)?;
            conn.execute("INSERT INTO analysis_modules(name,report_json,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET report_json=excluded.report_json,updated_at=excluded.updated_at",params![module_name,value.to_string(),now()]).map_err(|e|e.to_string())?;
            value
        };
        merge_report(&mut report,module);
    }
    {
        let conn = open_book(&app, &id)?;
        let timestamp = now();
        conn.execute(
            "INSERT INTO report(id,report_json,model,created_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET report_json=excluded.report_json,model=excluded.model,created_at=excluded.created_at",
            params![report.to_string(), config.model, timestamp],
        ).map_err(|e| e.to_string())?;
        conn.execute("UPDATE book SET updated_at=?", params![timestamp])
            .map_err(|e| e.to_string())?;
    }
    update_job(&app, &id, "completed", "分析完成", total, total, None)?;
    Ok(())
}

#[tauri::command]
async fn start_analysis(app: AppHandle, id: String, config: ModelConfig) -> Result<(), String> {
    let book = read_book(&app, &id)?;
    if book.status == "analyzing" {
        return Err("该书正在分析".into());
    }
    if book.status != "failed" {
        open_book(&app,&id)?.execute("DELETE FROM analysis_modules",[]).map_err(|e|e.to_string())?;
    }
    begin_job(&app, &id)?;
    let worker_app = app.clone();
    let worker_id = id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_analysis(worker_app.clone(), worker_id.clone(), config).await {
            let _ = fail_job(&worker_app,&worker_id,&error);
        }
    });
    Ok(())
}

#[tauri::command]
async fn extract_public_page(url: String) -> Result<ExtractedPage, String> {
    let parsed = Url::parse(&url).map_err(|_| "无效的小说链接".to_string())?;
    let host = parsed.host_str().unwrap_or_default();
    if !(host == "qidian.com"
        || host.ends_with(".qidian.com")
        || host == "fanqienovel.com"
        || host.ends_with(".fanqienovel.com"))
    {
        return Err("目前只支持番茄和起点的公开页面".into());
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?
        .get(parsed.clone())
        .header("User-Agent", "Mozilla/5.0 InkScope/0.2 local-client")
        .send()
        .await
        .map_err(|e| format!("页面读取失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("平台返回错误: {}", response.status()));
    }
    let html = response.text().await.map_err(|e| e.to_string())?;
    let title_re = Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap();
    let title = title_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| html_escape::decode_html_entities(m.as_str()).to_string())
        .unwrap_or_else(|| "未命名作品".into());
    let script_re = Regex::new(r"(?is)<(script|style)[^>]*>.*?</(script|style)>").unwrap();
    let tag_re = Regex::new(r"(?is)<[^>]+>").unwrap();
    let space_re = Regex::new(r"[ \t]+|\n{3,}").unwrap();
    let without_scripts = script_re.replace_all(&html, " ");
    let text = tag_re.replace_all(&without_scripts, "\n");
    let content = space_re.replace_all(&text, "\n\n");
    let content = html_escape::decode_html_entities(content.trim()).to_string();
    if content.chars().count() < 200 {
        return Err("页面中没有足够的公开正文，请上传 TXT/MD 文件".into());
    }
    Ok(ExtractedPage {
        title: title.trim().to_string(),
        content,
        source_uri: parsed.to_string(),
    })
}

#[tauri::command]
async fn sync_legado_sources(app: AppHandle, repository_url: Option<String>) -> Result<legado::SourceStatus, String> {
    legado::sync_sources(app, repository_url).await
}

#[tauri::command]
fn get_legado_source_status(app: AppHandle) -> Result<legado::SourceStatus, String> {
    legado::status(app)
}

#[tauri::command]
async fn search_legado_books(app: AppHandle, query: String, source_keys: Vec<String>) -> Result<legado::SearchResponse, String> {
    legado::search(app, query, source_keys).await
}

#[tauri::command]
async fn extract_legado_book(app: AppHandle, request: legado::ExtractRequest) -> Result<legado::ExtractedBook, String> {
    legado::extract(app, request).await
}

#[tauri::command]
async fn preview_legado_toc(app:AppHandle,request:legado::PreviewRequest)->Result<Vec<legado::RemoteChapter>,String>{legado::preview_toc(app,request).await}

#[tauri::command]
async fn preview_legado_chapter(app:AppHandle,source_key:String,chapter_url:String,title:String)->Result<legado::RemoteChapterDetail,String>{legado::preview_chapter(app,source_key,chapter_url,title).await}

#[tauri::command]
async fn refresh_legado_book(app:AppHandle,id:String)->Result<BookSummary,String>{
    let(title,source_uri)={let conn=open_book(&app,&id)?;conn.query_row("SELECT title,source_uri FROM book LIMIT 1",[],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).map_err(|e|e.to_string())?};
    let(source_name,book_url)=source_uri.split_once(" · ").ok_or("这本书没有可用于补全的 Legado 原书源记录")?;
    let source_key=legado::key_for_source_name(&app,source_name)?;
    let extracted=legado::extract(app.clone(),legado::ExtractRequest{source_key,book_url:book_url.to_string(),title,max_chapters:0}).await?;
    let mut conn=open_book(&app,&id)?;let timestamp=now();let content=extracted.content;let character_count=content.chars().count() as i64;
    conn.execute("UPDATE book SET content=?,character_count=?,updated_at=?",params![content,character_count,timestamp]).map_err(|e|e.to_string())?;
    conn.execute("DELETE FROM chapters",[]).map_err(|e|e.to_string())?;conn.execute("DELETE FROM report",[]).map_err(|e|e.to_string())?;backfill_chapters(&mut conn)?;drop(conn);
    update_job(&app,&id,"ready",&format!("已补全 {} 章，等待分析",extracted.chapter_count),0,0,None)?;read_book(&app,&id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            recover_interrupted_jobs(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_books,
            get_book,
            list_chapters,
            get_chapter,
            export_book,
            create_book,
            delete_book,
            test_model,
            start_analysis,
            extract_public_page,
            sync_legado_sources,
            get_legado_source_status,
            search_legado_books,
            extract_legado_book,
            preview_legado_toc,
            preview_legado_chapter,
            refresh_legado_book
        ])
        .run(tauri::generate_context!())
        .expect("error while running InkScope");
}

#[cfg(test)]
mod tests {
    use super::{chapters_from_content, parse_model_json, split_content, write_docx};

    #[test]
    fn splits_long_chinese_text_on_utf8_boundaries() {
        let content = "第一章\n这是用于验证长篇中文切片的句子。".repeat(8_000);
        let chunks = split_content(&content, 100_000);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.concat(), content);
    }

    #[test]
    fn repairs_raw_control_characters_inside_model_json_strings() {
        let raw = "```json\n{\"summary\":\"第一行\n第二行\t完成\",\"ok\":true}\n```";
        let value = parse_model_json(raw).expect("control characters should be escaped");
        assert_eq!(value["summary"], "第一行\n第二行\t完成");
        assert_eq!(value["ok"], true);
    }

    #[test]
    fn builds_chapter_index_and_valid_docx_package() {
        let chapters=chapters_from_content("测试书","# 第一章\n正文一\n# 第二章\n正文二");
        assert_eq!(chapters.len(),2);assert_eq!(chapters[1].0,"第二章");
        let path=std::env::temp_dir().join("inkscope-export-test.docx");write_docx(&path,"测试书",&chapters).expect("docx export");
        let file=std::fs::File::open(&path).unwrap();let mut archive=zip::ZipArchive::new(file).unwrap();assert!(archive.by_name("word/document.xml").is_ok());let _=std::fs::remove_file(path);
    }
}
