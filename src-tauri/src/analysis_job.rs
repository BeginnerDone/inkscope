//! Stop the in-flight request and acknowledge only after the worker releases its book lock.
use crate::*;
use futures::{channel::oneshot, future::{AbortHandle, Abortable, BoxFuture, Shared}, FutureExt};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

struct Active {
    token: String,
    abort: AbortHandle,
    finished: Shared<BoxFuture<'static, ()>>,
}
static JOBS: OnceLock<Mutex<HashMap<String, Active>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<String, Active>> { JOBS.get_or_init(Mutex::default) }

pub fn pause_in(conn: &Connection) -> Result<(), String> {
    conn.execute("UPDATE analysis_job SET status='paused',stage='已暂停，已完成进度保留',error=NULL,updated_at=? WHERE id=1 AND status='analyzing'", params![now()]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn launch(app: AppHandle, id: String, config: ModelConfig, operation: completeness::BookOperation) -> Result<(), String> {
    let (abort, registration) = AbortHandle::new_pair();
    let (sender, receiver) = oneshot::channel::<()>();
    let finished = receiver.map(|_| ()).boxed().shared();
    let token = Uuid::new_v4().to_string();
    jobs().lock().map_err(|_| "分析任务锁不可用")?.insert(id.clone(), Active { token: token.clone(), abort, finished });
    tauri::async_runtime::spawn(async move {
        match Abortable::new(run_analysis(app.clone(), id.clone(), config), registration).await {
            Ok(Err(error)) => { let _ = fail_job(&app, &id, &error); }
            Err(_) => { if let Ok(conn) = open_book(&app, &id) { let _ = pause_in(&conn); } }
            Ok(Ok(())) => {}
        }
        drop(operation);
        if let Ok(mut active) = jobs().lock() {
            if active.get(&id).is_some_and(|job| job.token == token) { active.remove(&id); }
        }
        let _ = sender.send(());
    });
    Ok(())
}

#[tauri::command]
pub async fn pause_analysis(app: AppHandle, id: String) -> Result<BookSummary, String> {
    let finished = {
        let active = jobs().lock().map_err(|_| "分析任务锁不可用")?;
        active.get(&id).map(|job| { job.abort.abort(); job.finished.clone() })
    };
    if let Some(finished) = finished { finished.await; }
    let book = read_book(&app, &id)?;
    if book.status == "analyzing" { return Err("未能暂停分析，请刷新任务状态后重试".into()); }
    Ok(book)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pause_retains_progress_checkpoints_and_previous_report() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE analysis_job(id INTEGER,status TEXT,stage TEXT,completed INTEGER,total INTEGER,error TEXT,updated_at TEXT); INSERT INTO analysis_job VALUES(1,'analyzing','分析片段',12,300,NULL,''); CREATE TABLE checkpoints(body TEXT); INSERT INTO checkpoints VALUES('已完成的片段和综合模块'); CREATE TABLE report(body TEXT); INSERT INTO report VALUES('上一份完整报告');").unwrap();
        pause_in(&conn).unwrap();
        let state: (String, i64, i64) = conn.query_row("SELECT status,completed,total FROM analysis_job", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(state, ("paused".into(),12,300));
        assert_eq!(conn.query_row("SELECT body FROM checkpoints", [], |r| r.get::<_,String>(0)).unwrap(), "已完成的片段和综合模块");
        assert_eq!(conn.query_row("SELECT body FROM report", [], |r| r.get::<_,String>(0)).unwrap(), "上一份完整报告");
        conn.execute("UPDATE analysis_job SET status='completed'", []).unwrap();
        pause_in(&conn).unwrap();
        assert_eq!(conn.query_row("SELECT status FROM analysis_job", [], |r| r.get::<_,String>(0)).unwrap(), "completed");
    }
    #[test]
    fn abort_drops_pending_request_and_lock_before_acknowledgement() {
        use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
        struct Request(Arc<AtomicBool>);
        impl Drop for Request { fn drop(&mut self) { self.0.store(true, Ordering::SeqCst); } }
        let dropped = Arc::new(AtomicBool::new(false));
        let (abort, registration) = AbortHandle::new_pair();
        let (sender, receiver) = oneshot::channel::<()>();
        let request = Request(dropped.clone());
        let id = Uuid::new_v4().to_string();
        let operation = completeness::BookOperation::acquire(&id).unwrap();
        let worker = async {
            let result = Abortable::new(async move { let _request = request; futures::future::pending::<()>().await; }, registration).await;
            assert!(result.is_err());
            drop(operation);
            sender.send(()).unwrap();
        };
        let stop = async {
            abort.abort(); receiver.await.unwrap();
            assert!(dropped.load(Ordering::SeqCst));
            assert!(completeness::BookOperation::acquire(&id).is_ok());
        };
        futures::executor::block_on(futures::future::join(worker, stop));
    }
}
