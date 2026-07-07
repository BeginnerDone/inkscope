use futures::{stream, StreamExt};
use regex::Regex;
use reqwest::{Client, Url};
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, fs, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager};

pub const DEFAULT_SOURCE_URL: &str = "https://legado.aoaostar.com/sources/b778fe6b.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceItem {
    pub key: String,
    pub name: String,
    pub group: String,
    pub url: String,
    pub search_compatible: bool,
    pub import_compatible: bool,
    pub reason: String,
    pub response_time: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub installed: bool,
    pub repository_url: String,
    pub total: usize,
    pub searchable: usize,
    pub importable: usize,
    pub sources: Vec<SourceItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub source_key: String,
    pub source_name: String,
    pub title: String,
    pub author: String,
    pub intro: String,
    pub cover_url: String,
    pub book_url: String,
    pub import_compatible: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub searched_sources: usize,
    pub failed_sources: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractRequest {
    pub source_key: String,
    pub book_url: String,
    pub title: String,
    pub max_chapters: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedBook {
    pub title: String,
    pub content: String,
    pub source_uri: String,
    pub source_name: String,
    pub chapter_count: usize,
    pub failed_chapters: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRequest { pub source_key:String, pub book_url:String }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteChapter { pub position:usize, pub title:String, pub chapter_url:String }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteChapterDetail { pub title:String, pub content:String, pub character_count:usize }

fn source_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("sources");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建书源目录: {e}"))?;
    Ok(dir)
}

fn source_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(source_dir(app)?.join("legado.json"))
}

fn meta_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(source_dir(app)?.join("legado.url"))
}

fn load_sources(app: &AppHandle) -> Result<Vec<Value>, String> {
    let path = source_path(app)?;
    let raw = fs::read_to_string(&path).map_err(|_| "尚未同步第三方书源".to_string())?;
    serde_json::from_str::<Vec<Value>>(&raw).map_err(|e| format!("书源 JSON 无法解析: {e}"))
}

pub fn key_for_source_name(app:&AppHandle,name:&str)->Result<String,String>{
    load_sources(app)?.into_iter().find(|source|str_at(source,"/bookSourceName")==name&&source_item(source).import_compatible).map(|source|source_key(&source)).ok_or_else(||format!("没有找到可补全的原书源：{name}"))
}

fn str_at<'a>(source: &'a Value, pointer: &str) -> &'a str {
    source.pointer(pointer).and_then(Value::as_str).unwrap_or("")
}

fn source_key(source: &Value) -> String {
    format!("{}|{}", str_at(source, "/bookSourceName"), str_at(source, "/bookSourceUrl"))
}

fn has_script(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("@js") || lower.contains("<js") || lower.contains("java.") ||
        lower.contains("eval(") || lower.contains("@get:") || lower.contains("@put:")
}

fn source_item(source: &Value) -> SourceItem {
    let search_url = str_at(source, "/searchUrl");
    let search_rules = ["/ruleSearch/bookList", "/ruleSearch/name", "/ruleSearch/bookUrl"]
        .iter().map(|p| str_at(source, p)).collect::<Vec<_>>().join(" ");
    let import_rules = [
        "/ruleBookInfo/init", "/ruleBookInfo/tocUrl", "/ruleToc/chapterList",
        "/ruleToc/chapterName", "/ruleToc/chapterUrl", "/ruleToc/nextTocUrl",
        "/ruleContent/content", "/ruleContent/nextContentUrl",
    ].iter().map(|p| str_at(source, p)).collect::<Vec<_>>().join(" ");
    let enabled = source.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    let search_compatible = enabled && !search_url.is_empty() && !has_script(search_url) &&
        !has_script(&search_rules) && !str_at(source, "/ruleSearch/bookList").starts_with("//") &&
        Url::parse(str_at(source, "/bookSourceUrl").split('#').next().unwrap_or("")).is_ok();
    let import_compatible = search_compatible && !has_script(&import_rules) &&
        !str_at(source, "/ruleToc/chapterList").is_empty() &&
        !str_at(source, "/ruleToc/chapterUrl").is_empty() &&
        !str_at(source, "/ruleContent/content").is_empty() &&
        str_at(source, "/ruleContent/nextContentUrl").is_empty() &&
        !str_at(source, "/ruleToc/chapterList").starts_with("//");
    let reason = if import_compatible { "可搜索并自动抓取" }
        else if search_compatible { "可搜索，正文规则暂不兼容" }
        else if !str_at(source,"/ruleContent/nextContentUrl").is_empty() { "章节正文分页规则暂不兼容" }
        else if has_script(&format!("{search_url} {search_rules}")) { "包含 JavaScript 规则" }
        else { "规则类型暂不兼容" }.to_string();
    SourceItem {
        key: source_key(source),
        name: str_at(source, "/bookSourceName").to_string(),
        group: str_at(source, "/bookSourceGroup").to_string(),
        url: str_at(source, "/bookSourceUrl").to_string(),
        search_compatible, import_compatible, reason,
        response_time: source.get("respondTime").and_then(Value::as_i64).unwrap_or(999_999),
    }
}

pub async fn sync_sources(app: AppHandle, repository_url: Option<String>) -> Result<SourceStatus, String> {
    let url = repository_url.filter(|v| !v.trim().is_empty()).unwrap_or_else(|| DEFAULT_SOURCE_URL.into());
    let parsed = Url::parse(&url).map_err(|_| "书源地址无效".to_string())?;
    if parsed.scheme() != "https" { return Err("书源地址必须使用 HTTPS".into()); }
    let response = client()?.get(parsed).send().await.map_err(|e| format!("下载书源失败: {e}"))?;
    if !response.status().is_success() { return Err(format!("书源服务器返回 {}", response.status())); }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 64 * 1024 * 1024 { return Err("书源文件超过 64MB 安全上限".into()); }
    let sources: Vec<Value> = serde_json::from_slice(&bytes).map_err(|e| format!("不是有效的 Legado 书源数组: {e}"))?;
    let valid = sources.iter().filter(|s| !str_at(s, "/bookSourceName").is_empty()).count();
    if valid == 0 { return Err("文件中没有识别到 Legado 书源".into()); }
    fs::write(source_path(&app)?, &bytes).map_err(|e| format!("保存书源失败: {e}"))?;
    fs::write(meta_path(&app)?, &url).map_err(|e| e.to_string())?;
    status(app)
}

pub fn status(app: AppHandle) -> Result<SourceStatus, String> {
    let path = source_path(&app)?;
    if !path.exists() {
        return Ok(SourceStatus { installed:false, repository_url:DEFAULT_SOURCE_URL.into(), total:0, searchable:0, importable:0, sources:vec![] });
    }
    let sources = load_sources(&app)?;
    let total = sources.len();
    let mut seen = HashSet::new();
    let mut items = sources.iter().map(source_item).filter(|item|seen.insert(item.key.clone())).collect::<Vec<_>>();
    items.sort_by(|a,b| {
        let ar=if a.response_time < 50 {999_999}else{a.response_time};
        let br=if b.response_time < 50 {999_999}else{b.response_time};
        b.import_compatible.cmp(&a.import_compatible).then(b.search_compatible.cmp(&a.search_compatible)).then(ar.cmp(&br)).then(a.name.cmp(&b.name))
    });
    let repository_url = fs::read_to_string(meta_path(&app)?).unwrap_or_else(|_| DEFAULT_SOURCE_URL.into());
    Ok(SourceStatus {
        installed:true, repository_url, total,
        searchable:items.iter().filter(|x| x.search_compatible).count(),
        importable:items.iter().filter(|x| x.import_compatible).count(), sources:items,
    })
}

fn client() -> Result<Client, String> {
    Client::builder().timeout(Duration::from_secs(25)).redirect(reqwest::redirect::Policy::limited(8))
        .build().map_err(|e| e.to_string())
}

fn split_rule(rule: &str) -> (&str, Option<(&str, &str)>) {
    let mut parts = rule.splitn(3, "##");
    let main = parts.next().unwrap_or("");
    match parts.next() {
        Some(pattern) => (main, Some((pattern, parts.next().unwrap_or("")))),
        None => (main, None),
    }
}

fn apply_replace(value: String, replace: Option<(&str, &str)>) -> String {
    if let Some((pattern, replacement)) = replace {
        if let Ok(re) = Regex::new(pattern) { return re.replace_all(&value, replacement).to_string(); }
    }
    value
}

fn json_children(value: &Value, segment: &str) -> Vec<Value> {
    let wildcard = segment.ends_with("[*]");
    let mut key = segment.trim_end_matches("[*]");
    let mut index = None;
    if let Some(open) = key.rfind('[') {
        if key.ends_with(']') {
            index = key[open+1..key.len()-1].parse::<usize>().ok();
            key = &key[..open];
        }
    }
    let next = if key.is_empty() { Some(value) } else { value.get(key) };
    match next {
        Some(Value::Array(items)) if wildcard => items.clone(),
        Some(Value::Array(items)) if index.is_some() => items.get(index.unwrap()).cloned().into_iter().collect(),
        Some(v) => vec![v.clone()], None => vec![],
    }
}

fn recursive_key(value: &Value, key: &str, out: &mut Vec<Value>) {
    match value {
        Value::Object(map) => {
            if let Some(v) = map.get(key) { out.push(v.clone()); }
            for v in map.values() { recursive_key(v, key, out); }
        }
        Value::Array(items) => for v in items { recursive_key(v, key, out); },
        _ => {}
    }
}

fn json_select(root: &Value, raw: &str) -> Vec<Value> {
    let raw = raw.trim().trim_matches('{').trim_matches('}');
    if raw.contains("||") {
        for part in raw.split("||") { let found = json_select(root, part); if !found.is_empty() { return found; } }
        return vec![];
    }
    if raw.contains("&&") {
        for part in raw.split("&&").collect::<Vec<_>>().into_iter().rev() { let found = json_select(root, part); if !found.is_empty() { return found; } }
        return vec![];
    }
    let path = raw.trim_start_matches('$').trim_start_matches('.');
    if raw.starts_with("$..") {
        let first = path.split('.').next().unwrap_or("").trim_end_matches("[*]");
        let mut found = vec![]; recursive_key(root, first, &mut found);
        let rest = path.strip_prefix(first).unwrap_or("").trim_start_matches('.');
        if rest.is_empty() { return found.into_iter().flat_map(|v| if let Value::Array(a)=v {a}else{vec![v]}).collect(); }
        return found.into_iter().flat_map(|v| json_select(&v, rest)).collect();
    }
    if path.is_empty() { return vec![root.clone()]; }
    let mut current = vec![root.clone()];
    for segment in path.split('.') {
        current = current.iter().flat_map(|v| json_children(v, segment)).collect();
    }
    current
}

fn scalar(value: &Value) -> String {
    match value { Value::String(v)=>v.clone(), Value::Number(v)=>v.to_string(), Value::Bool(v)=>v.to_string(), Value::Null=>String::new(), _=>value.to_string() }
}

fn eval_json(root: &Value, rule: &str) -> String {
    let (main, replace) = split_rule(rule);
    let template = Regex::new(r"\{\{([^{}]+)\}\}").unwrap();
    let value = if main.contains("{{") {
        template.replace_all(main, |caps: &regex::Captures| json_select(root, &caps[1]).first().map(scalar).unwrap_or_default()).to_string()
    } else {
        json_select(root, main).iter().map(scalar).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n")
    };
    apply_replace(value, replace).trim().to_string()
}

fn parse_segment(segment: &str) -> (String, Option<isize>) {
    if let Some((head, tail)) = segment.rsplit_once('.') {
        if let Ok(index) = tail.parse::<isize>() { return (head.to_string(), Some(index)); }
    }
    (segment.to_string(), None)
}

fn select_html<'a>(nodes: Vec<ElementRef<'a>>, rule: &str) -> Vec<ElementRef<'a>> {
    let (main, _) = split_rule(rule);
    let mut current = nodes;
    for raw in main.split('@').filter(|s| !s.is_empty()) {
        if matches!(raw, "text"|"html"|"href"|"src"|"title"|"content"|"data-src"|"alt") { break; }
        let (seg, index) = parse_segment(raw);
        let css = if let Some(v)=seg.strip_prefix("css:") { v.to_string() }
            else if let Some(v)=seg.strip_prefix("class.") { format!(".{}", v.replace('.', " .")) }
            else if let Some(v)=seg.strip_prefix("id.") { format!("#{v}") }
            else if let Some(v)=seg.strip_prefix("tag.") { v.to_string() }
            else if seg.starts_with('.') || seg.starts_with('#') || seg.contains('[') || seg.contains('>') { seg.clone() }
            else { seg.clone() };
        let Ok(selector) = Selector::parse(&css) else { return vec![] };
        let mut next = current.iter().flat_map(|n| n.select(&selector)).collect::<Vec<_>>();
        if let Some(i)=index {
            let actual = if i < 0 { next.len() as isize + i } else { i };
            next = next.get(actual.max(0) as usize).copied().into_iter().collect();
        }
        current = next;
    }
    current
}

fn eval_html(node: ElementRef<'_>, rule: &str) -> String {
    let (main, replace) = split_rule(rule);
    let nodes = select_html(vec![node], main);
    let last = main.split('@').last().unwrap_or("");
    let value = if matches!(last, "href"|"src"|"title"|"content"|"data-src"|"alt") {
        nodes.iter().filter_map(|n| n.value().attr(last)).collect::<Vec<_>>().join("\n")
    } else if last == "html" {
        nodes.iter().map(|n| n.inner_html()).collect::<Vec<_>>().join("\n")
    } else {
        nodes.iter().map(|n| n.text().collect::<Vec<_>>().join("")).collect::<Vec<_>>().join("\n")
    };
    apply_replace(html_escape::decode_html_entities(&value).to_string(), replace).trim().to_string()
}

fn absolute(base: &str, value: &str) -> String {
    let (target, options) = split_request(value);
    let base = base.split('#').next().unwrap_or(base);
    let resolved = if target.starts_with("http://") || target.starts_with("https://") { target.to_string() }
        else { Url::parse(base).ok().and_then(|u| u.join(target).ok()).map(|u| u.to_string()).unwrap_or_else(|| target.to_string()) };
    options.map(|v| format!("{resolved},{}",v)).unwrap_or(resolved)
}

fn render_url(template: &str, root: Option<&Value>, key: &str, page: usize) -> String {
    let (target, options) = split_request(template);
    let mut result = target.replace("{{key}}", &urlencoding::encode(key)).replace("{{page}}", &page.to_string());
    if let Some(value)=root {
        let re=Regex::new(r"\{\{([^{}]+)\}\}").unwrap();
        result=re.replace_all(&result, |caps:&regex::Captures| urlencoding::encode(&eval_json(value,&caps[1])).to_string()).to_string();
    }
    if let Some(options)=options {
        let mut rendered=options.replace("{{key}}",key).replace("{{page}}",&page.to_string());
        if let Some(value)=root { let re=Regex::new(r"\{\{([^{}]+)\}\}").unwrap();rendered=re.replace_all(&rendered,|caps:&regex::Captures|eval_json(value,&caps[1])).to_string(); }
        format!("{result},{rendered}")
    } else { result }
}

fn split_request(value:&str)->(&str,Option<&str>){
    if let Some(index)=value.find(",{") {(&value[..index],Some(&value[index+1..]))}
    else if let Some(index)=value.find(",[{") {(&value[..index],Some(&value[index+1..]))}
    else {(value,None)}
}

async fn fetch(client: &Client, source: &Value, url_spec: &str) -> Result<String, String> {
    let (url, options_raw)=split_request(url_spec);
    let parsed = Url::parse(url).map_err(|_| "书源生成了无效 URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") { return Err("书源只允许 HTTP/HTTPS 请求".into()); }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host == "0.0.0.0" || host == "::1" {
        return Err("已阻止书源访问本机地址".into());
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let private = match ip {
            std::net::IpAddr::V4(v) => v.is_private() || v.is_loopback() || v.is_link_local(),
            std::net::IpAddr::V6(v) => v.is_loopback() || v.is_unique_local() || v.is_unicast_link_local(),
        };
        if private { return Err("已阻止书源访问内网地址".into()); }
    }
    let options=options_raw.and_then(|raw|serde_json::from_str::<Value>(&raw.replace('\'',"\"")).ok());
    let is_post=options.as_ref().and_then(|v|v.get("method")).and_then(Value::as_str).map(|v|v.eq_ignore_ascii_case("post")).unwrap_or(false);
    let mut request=if is_post {client.post(parsed.clone())}else{client.get(parsed.clone())};
    request=request.header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 InkScope/0.3");
    let header = str_at(source, "/header").replace('\'', "\"");
    if let Ok(Value::Object(headers))=serde_json::from_str::<Value>(&header) {
        for (key,value) in headers { if let Some(v)=value.as_str() { request=request.header(key,v); } }
    }
    if let Some(body)=options.as_ref().and_then(|v|v.get("body")) {request=if let Some(text)=body.as_str(){request.body(text.to_string())}else{request.json(body)};}
    let response=request.send().await.map_err(|e| if e.is_timeout(){"请求超时".into()}else if e.is_connect(){"站点无法连接或域名已失效".into()}else{format!("网络请求失败: {e}")})?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            404 => "站点已失效或搜索地址已改版（404）".into(),
            403 => "站点拒绝访问，可能需要登录或验证（403）".into(),
            429 => "站点请求过于频繁（429）".into(),
            _ => format!("站点返回 HTTP {}",response.status()),
        });
    }
    response.text().await.map_err(|e| e.to_string())
}

async fn search_one(source: Value, query: String) -> Result<Vec<SearchResult>, String> {
    let item=source_item(&source);
    if !item.search_compatible { return Err(item.reason); }
    let search=render_url(str_at(&source,"/searchUrl"),None,&query,1);
    let url=absolute(str_at(&source,"/bookSourceUrl"),&search);
    let body=fetch(&client()?,&source,&url).await?;
    let mut results=vec![];
    if body.trim_start().starts_with('{') || body.trim_start().starts_with('[') {
        let root:Value=serde_json::from_str(&body).map_err(|e| format!("JSON: {e}"))?;
        for book in json_select(&root,str_at(&source,"/ruleSearch/bookList")).into_iter().take(20) {
            let title=eval_json(&book,str_at(&source,"/ruleSearch/name"));
            let path=render_url(str_at(&source,"/ruleSearch/bookUrl"),Some(&book),"",1);
            if title.is_empty() || path.is_empty() { continue; }
            results.push(SearchResult { source_key:item.key.clone(),source_name:item.name.clone(),title,
                author:eval_json(&book,str_at(&source,"/ruleSearch/author")), intro:eval_json(&book,str_at(&source,"/ruleSearch/intro")),
                cover_url:absolute(&url,&eval_json(&book,str_at(&source,"/ruleSearch/coverUrl"))), book_url:absolute(&url,&path), import_compatible:item.import_compatible });
        }
    } else {
        let doc=Html::parse_document(&body); let root=doc.root_element();
        for book in select_html(vec![root],str_at(&source,"/ruleSearch/bookList")).into_iter().take(20) {
            let title=eval_html(book,str_at(&source,"/ruleSearch/name")); let path=eval_html(book,str_at(&source,"/ruleSearch/bookUrl"));
            if title.is_empty() || path.is_empty(){continue}
            results.push(SearchResult { source_key:item.key.clone(),source_name:item.name.clone(),title,
                author:eval_html(book,str_at(&source,"/ruleSearch/author")), intro:eval_html(book,str_at(&source,"/ruleSearch/intro")),
                cover_url:absolute(&url,&eval_html(book,str_at(&source,"/ruleSearch/coverUrl"))),book_url:absolute(&url,&path),import_compatible:item.import_compatible });
        }
    }
    Ok(results)
}

pub async fn search(app: AppHandle, query: String, source_keys: Vec<String>) -> Result<SearchResponse,String> {
    if query.trim().is_empty(){return Err("请输入小说名".into())}
    if source_keys.is_empty(){return Err("至少选择一个书源".into())}
    if source_keys.len()>60{return Err("一次最多搜索 60 个书源".into())}
    let mut seen=HashSet::new();
    let sources=load_sources(&app)?.into_iter().filter(|s| source_keys.contains(&source_key(s))&&seen.insert(source_key(s))).collect::<Vec<_>>();
    let searched_sources=sources.len();
    let responses=stream::iter(sources.into_iter().map(|s| {let q=query.clone();async move {let name=str_at(&s,"/bookSourceName").to_string();(name,search_one(s,q).await)}})).buffer_unordered(12).collect::<Vec<_>>().await;
    let mut results=vec![];let mut failed_sources=vec![];
    for (name,response) in responses {match response{Ok(mut r)=>results.append(&mut r),Err(e)=>failed_sources.push(format!("{name}：{e}"))}}
    results.sort_by_key(|r| (!r.title.contains(query.trim()),!r.import_compatible));
    results.dedup_by(|a,b|a.title==b.title&&a.author==b.author&&a.book_url==b.book_url);
    Ok(SearchResponse{results,searched_sources,failed_sources})
}

fn parse_content(body:&str,source:&Value)->String{
    let rule=str_at(source,"/ruleContent/content");
    if body.trim_start().starts_with('{')||body.trim_start().starts_with('['){serde_json::from_str::<Value>(body).ok().map(|v|eval_json(&v,rule)).unwrap_or_default()}
    else{let doc=Html::parse_document(body);eval_html(doc.root_element(),rule)}
}

fn parse_toc_page(body:&str,source:&Value,page_url:&str,start:usize,limit:usize)->(Vec<(usize,String,String)>,Option<String>){
    let mut chapters=vec![];
    let next_rule=str_at(source,"/ruleToc/nextTocUrl");
    let next;
    if body.trim_start().starts_with('{')||body.trim_start().starts_with('['){
        let Ok(root)=serde_json::from_str::<Value>(body) else{return(chapters,None)};
        for (offset,ch) in json_select(&root,str_at(source,"/ruleToc/chapterList")).into_iter().take(limit).enumerate(){
            let name=eval_json(&ch,str_at(source,"/ruleToc/chapterName"));
            let path=render_url(str_at(source,"/ruleToc/chapterUrl"),Some(&ch),"",1);
            if !path.is_empty(){chapters.push((start+offset,name,absolute(page_url,&path)))}
        }
        let value=if next_rule.is_empty(){String::new()}else{eval_json(&root,next_rule)};
        next=value.lines().find(|v|!v.trim().is_empty()).map(|v|absolute(page_url,v.trim()));
    }else{
        let doc=Html::parse_document(body);let root=doc.root_element();
        for(offset,ch)in select_html(vec![root],str_at(source,"/ruleToc/chapterList")).into_iter().take(limit).enumerate(){
            let name=eval_html(ch,str_at(source,"/ruleToc/chapterName"));let path=eval_html(ch,str_at(source,"/ruleToc/chapterUrl"));
            if !path.is_empty(){chapters.push((start+offset,name,absolute(page_url,&path)))}
        }
        let value=if next_rule.is_empty(){String::new()}else{eval_html(root,next_rule)};
        next=value.lines().find(|v|!v.trim().is_empty()).map(|v|absolute(page_url,v.trim()));
    }
    (chapters,next)
}

async fn resolve_toc(client:&Client,source:&Value,book_url:&str)->Result<String,String>{
    let info_body=fetch(client,source,book_url).await.map_err(|e|format!("书籍详情读取失败: {e}"))?;
    let toc_rule=str_at(source,"/ruleBookInfo/tocUrl");
    if toc_rule.is_empty(){return Ok(book_url.to_string())}
    if info_body.trim_start().starts_with('{')||info_body.trim_start().starts_with('['){
        let root:Value=serde_json::from_str(&info_body).map_err(|e|e.to_string())?;let init=str_at(source,"/ruleBookInfo/init");let context=if init.starts_with('$'){json_select(&root,init).first().cloned().unwrap_or(root)}else{root};Ok(absolute(book_url,&render_url(toc_rule,Some(&context),"",1)))
    }else{let doc=Html::parse_document(&info_body);Ok(absolute(book_url,&eval_html(doc.root_element(),toc_rule)))}
}

pub async fn preview_toc(app:AppHandle,request:PreviewRequest)->Result<Vec<RemoteChapter>,String>{
    let sources=load_sources(&app)?;let source=sources.into_iter().find(|s|source_key(s)==request.source_key).ok_or("书源已不存在，请重新同步")?;
    if !source_item(&source).import_compatible{return Err("该书源的目录或正文规则当前不兼容".into())}
    let client=client()?;let mut page_url=resolve_toc(&client,&source,&request.book_url).await?;let mut visited=HashSet::new();let mut chapters=vec![];let mut page=1usize;
    while visited.insert(page_url.clone()){
        if page>10_000{return Err("目录分页超过安全范围".into())}
        let body=fetch(&client,&source,&page_url).await.map_err(|e|format!("目录第 {page} 页读取失败: {e}"))?;
        let(items,next)=parse_toc_page(&body,&source,&page_url,chapters.len(),usize::MAX);
        chapters.extend(items.into_iter().map(|(position,title,chapter_url)|RemoteChapter{position,title,chapter_url}));
        let Some(next)=next else{break};page_url=next;page+=1;
    }
    if chapters.is_empty(){return Err("书源返回了空目录，规则可能已经失效".into())}Ok(chapters)
}

pub async fn preview_chapter(app:AppHandle,source_key_value:String,chapter_url:String,title:String)->Result<RemoteChapterDetail,String>{
    let sources=load_sources(&app)?;let source=sources.into_iter().find(|s|source_key(s)==source_key_value).ok_or("书源已不存在")?;
    let body=fetch(&client()?,&source,&chapter_url).await.map_err(|e|format!("章节读取失败: {e}"))?;let content=parse_content(&body,&source);
    if content.chars().count()<20{return Err("章节正文为空，书源规则可能失效".into())}let content=clean_preview_text(&content);let character_count=content.chars().count();Ok(RemoteChapterDetail{title,content,character_count})
}

fn clean_preview_text(raw:&str)->String{
    let breaks=Regex::new(r"(?i)<br\s*/?>|</p>|</div>").unwrap().replace_all(raw,"\n");let tags=Regex::new(r"(?is)<[^>]+>").unwrap().replace_all(&breaks,"");html_escape::decode_html_entities(tags.trim()).to_string()
}

pub async fn extract(app:AppHandle,request:ExtractRequest)->Result<ExtractedBook,String>{
    let sources=load_sources(&app)?;let source=sources.into_iter().find(|s|source_key(s)==request.source_key).ok_or("书源已不存在，请重新同步")?;
    let item=source_item(&source);if !item.import_compatible{return Err(format!("{}：{}",item.name,item.reason))}
    let client=client()?;let toc_url=resolve_toc(&client,&source,&request.book_url).await?;
    // 0 means every chapter returned by the source. A limit is only an explicit
    // user-selected diagnostic mode; professional analysis defaults to the full work.
    let limit=if request.max_chapters==0{usize::MAX}else{request.max_chapters};let mut chapters:Vec<(usize,String,String)>=vec![];
    let mut page_url=toc_url.clone();let mut visited=HashSet::new();let mut page_number=1usize;
    while chapters.len()<limit&&visited.insert(page_url.clone()){
        if page_number>10_000{return Err("目录分页超过 10000 页，已停止异常书源规则".into())}
        let toc_body=fetch(&client,&source,&page_url).await.map_err(|e|format!("目录第 {page_number} 页读取失败: {e}"))?;
        let remaining=limit.saturating_sub(chapters.len());let(chapter_page,next)=parse_toc_page(&toc_body,&source,&page_url,chapters.len(),remaining);
        chapters.extend(chapter_page);let Some(next)=next else{break};page_url=next;page_number+=1;
    }
    if chapters.is_empty(){return Err("书源返回了空目录，规则可能已经失效".into())}
    let requested=chapters.len();let jobs=chapters.into_iter().map(|(i,name,url)|{let client=client.clone();let source=source.clone();async move{let value=fetch(&client,&source,&url).await.ok().map(|body|parse_content(&body,&source)).filter(|v|v.chars().count()>20);(i,name,value)}});
    let mut fetched=stream::iter(jobs).buffer_unordered(8).collect::<Vec<_>>().await;fetched.sort_by_key(|x|x.0);
    let failed_chapters=fetched.iter().filter(|x|x.2.is_none()).count();let chapter_count=requested-failed_chapters;
    let content=fetched.into_iter().filter_map(|(_,name,text)|text.map(|t|format!("\n\n# {name}\n\n{t}"))).collect::<String>();
    if content.chars().count()<80{return Err("章节正文均未能读取，书源规则可能失效或需要登录/JavaScript".into())}
    Ok(ExtractedBook{title:request.title,content,source_uri:request.book_url,source_name:item.name,chapter_count,failed_chapters})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_json_rules() {
        let root = serde_json::json!({"data":[{"id":7,"title":"真实书名","author":"作者"}]});
        let books = json_select(&root, "$.data[*]");
        assert_eq!(books.len(), 1);
        assert_eq!(eval_json(&books[0], "$.title"), "真实书名");
        assert_eq!(render_url("/book/{{$.id}}", Some(&books[0]), "", 1), "/book/7");
    }

    #[test]
    fn parses_common_legado_html_chain() {
        let doc = Html::parse_document(r#"<div class="item"><h3><a href="/book/7">真实书名</a></h3><p>作者甲</p></div>"#);
        let items = select_html(vec![doc.root_element()], "class.item");
        assert_eq!(items.len(), 1);
        assert_eq!(eval_html(items[0], "tag.h3.0@tag.a.0@text"), "真实书名");
        assert_eq!(eval_html(items[0], "tag.h3.0@tag.a.0@href"), "/book/7");
    }

    #[test]
    fn marks_javascript_sources_incompatible() {
        let source = serde_json::json!({
            "bookSourceName":"脚本源","bookSourceUrl":"https://example.com",
            "searchUrl":"@js:buildUrl(key)","ruleSearch":{"bookList":"$.data","name":"$.name","bookUrl":"$.url"}
        });
        assert!(!source_item(&source).search_compatible);
    }
}
