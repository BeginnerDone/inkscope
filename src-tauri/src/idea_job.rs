//! One original proposal, with durable phase checkpoints and abortable requests.
use crate::*;
use futures::future::{AbortHandle, Abortable};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct State {
    pub id: String,
    pub book_id: String,
    pub platform: String,
    pub status: String,
    pub completed: usize,
    pub message: String,
    pub updated_at: String,
    #[serde(default, skip_serializing)]
    title: String,
    #[serde(default, skip_serializing)]
    report: Value,
    #[serde(default, skip_serializing)]
    candidate: Option<Value>,
    #[serde(default, skip_serializing)]
    reviewed: Option<Value>,
}
// Separate disk serialization so neither model credentials nor source material
// accidentally appear in frontend task snapshots.
#[derive(Serialize, Deserialize)]
struct Checkpoint { state: Value, title: String, report: Value, candidate: Option<Value>, reviewed: Option<Value> }
struct Runtime { state: State, epoch: u64, abort: Option<AbortHandle> }
impl Runtime {
    fn accepts(&self, epoch:u64)->bool { self.epoch==epoch && self.state.status=="running" }
    fn stop(&mut self, cancel:bool) {
        self.epoch+=1;
        if let Some(abort)=self.abort.take(){abort.abort();}
        self.state.status=if cancel {"cancelled"} else {"paused"}.into();
        self.state.message=if cancel {"已取消，原有方案保留"}else{"已暂停；继续时从未完成阶段重试"}.into();
        if cancel {self.state.candidate=None;self.state.reviewed=None;}
        self.state.updated_at=now();
    }
}
type Job = Arc<Mutex<Runtime>>;
static JOBS: OnceLock<Mutex<HashMap<String, Job>>> = OnceLock::new();
fn registry() -> &'static Mutex<HashMap<String, Job>> { JOBS.get_or_init(Mutex::default) }
fn persist(app: &AppHandle, state: &State) -> Result<(),String> {
    let conn=open_book(app,&state.book_id)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS idea_generation(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);").map_err(|e|e.to_string())?;
    let checkpoint=Checkpoint {state:serde_json::to_value(state).map_err(|e|e.to_string())?,title:state.title.clone(),report:state.report.clone(),candidate:state.candidate.clone(),reviewed:state.reviewed.clone()};
    conn.execute("INSERT INTO idea_generation VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![serde_json::to_string(&checkpoint).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    Ok(())
}
fn find(app:&AppHandle, id:&str) -> Result<Option<Job>,String> {
    let mut jobs=registry().lock().map_err(|_|"任务锁不可用")?;
    if let Some(job)=jobs.get(id) { return Ok(Some(job.clone())); }
    let conn=open_book(app,id)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS idea_generation(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);").map_err(|e|e.to_string())?;
    let raw=conn.query_row("SELECT body FROM idea_generation WHERE id=1",[],|row|row.get::<_,String>(0)).optional().map_err(|e|e.to_string())?;
    let Some(raw)=raw else {return Ok(None)};
    let saved:Checkpoint=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
    let mut state:State=serde_json::from_value(saved.state).map_err(|e|e.to_string())?;
    state.title=saved.title; state.report=saved.report; state.candidate=saved.candidate; state.reviewed=saved.reviewed;
    if state.status=="running" {state.status="paused".into();state.message="任务被重启中断，可从已保存阶段继续".into();persist(app,&state)?;}
    let job=Arc::new(Mutex::new(Runtime{state,epoch:0,abort:None}));
    jobs.insert(id.into(),job.clone()); Ok(Some(job))
}
fn unchanged(app:&AppHandle,state:&State)->Result<(),String>{
    if read_book(app,&state.book_id)?.report.as_ref()!=Some(&state.report) {return Err("报告已更新，请取消旧任务后重新生成".into());}
    Ok(())
}
fn checkpoint(app:&AppHandle,job:&Job,epoch:u64,value:Value,reviewed:bool)->Result<(),String>{
    let mut runtime=job.lock().map_err(|_|"任务锁不可用")?;
    if !runtime.accepts(epoch) {return Err("任务已暂停或取消".into());}
    if reviewed {runtime.state.reviewed=Some(value);runtime.state.completed=2;runtime.state.message="3/3 · 正在保存方案".into();}
    else {runtime.state.candidate=Some(value);runtime.state.completed=1;runtime.state.message="2/3 · 正在审稿并核对原创差异".into();}
    runtime.state.updated_at=now();persist(app,&runtime.state)
}
async fn work(app:AppHandle,job:Job,epoch:u64,_operation:completeness::BookOperation,config:ModelConfig)->Result<(),String>{
    let state=job.lock().map_err(|_|"任务锁不可用")?.state.clone();
    unchanged(&app,&state)?;
    let existing=ideas::existing_ideas(&state.report)?;
    let mut context=state.report.clone();
    if let Some(fields)=context.as_object_mut(){for key in ["ideas","ideasVersion","ideasModel","outline","coverage"]{fields.remove(key);}}
    let prompt=ideas::prompt_count(&state.title,&[context],&existing,&[&state.platform],1);
    let system="你是原创网文选题编辑，必须生成新的虚构故事。原作事实只能以资料为依据。输出严格 JSON。";
    let candidate=if let Some(value)=state.candidate {value} else {
        let value=call_deepseek(&config,json!([{"role":"system","content":system},{"role":"user","content":prompt}]),12_000).await?;
        checkpoint(&app,&job,epoch,value.clone(),false)?;value
    };
    if state.reviewed.is_none(){
        let mut messages=json!([{"role":"system","content":system},{"role":"user","content":prompt},{"role":"assistant","content":candidate.to_string()},{"role":"user","content":"进行第二轮编辑审稿。只交付指定平台的一个完整方案。对照原作与已有方案，重写换皮、雷同、开篇无兑现、无法持续的内容，保留三章开篇、三个阶段、至少三个实质差异维度。返回完整 JSON，只含 ideasVersion 和 ideas。"}]);
        let mut accepted=None;
        let mut last_error=String::new();
        for attempt in 0..3{
            let value=call_deepseek(&config,messages.clone(),12_000).await?;
            let check=ideas::validate_count(&value,&[&state.platform],1).and_then(|_|ideas::ensure_distinct(&existing,value["ideas"].as_array().unwrap()));
            match check {Ok(())=>{accepted=Some(value);break;},Err(error)=>{
                last_error=error;
                if attempt<2 {
                    let mut runtime=job.lock().map_err(|_|"任务锁不可用")?;
                    if !runtime.accepts(epoch){return Err("任务已暂停或取消".into());}
                    runtime.state.message=format!("2/3 · 第 {} 次修正：{}",attempt+2,last_error);
                    runtime.state.updated_at=now();persist(&app,&runtime.state)?;
                }
                messages.as_array_mut().unwrap().push(json!({"role":"user","content":format!("结构或避重检查未通过：{last_error}。保留合格内容，修正指出的问题，重新生成完整的单个方案JSON。上一结果：{value}")}));
            }}
        }
        checkpoint(&app,&job,epoch,accepted.ok_or_else(||format!("方案连续三次未通过完整性检查：{last_error}。原有方案未修改。"))?,true)?;
    }
    // Serialize cancellation against the short atomic save. A successful cancel
    // can never race a late model response into writing a proposal.
    let mut runtime=job.lock().map_err(|_|"任务锁不可用")?;
    if !runtime.accepts(epoch){return Err("任务已暂停或取消".into());}
    unchanged(&app,&runtime.state)?;
    let batch=runtime.state.reviewed.as_ref().ok_or("缺少审稿结果")?;
    let mut updated=ideas::append_count(&runtime.state.report,batch,&[&runtime.state.platform],1)?;
    updated["ideasModel"]=json!(config.model);
    let mut done=runtime.state.clone();done.completed=3;done.status="completed".into();done.message="已添加 1 个原创方案".into();done.updated_at=now();
    let mut conn=open_book(&app,&done.book_id)?;
    let tx=conn.transaction().map_err(|e|e.to_string())?;
    let latest:String=tx.query_row("SELECT report_json FROM report WHERE id=1",[],|row|row.get(0)).map_err(|e|e.to_string())?;
    if serde_json::from_str::<Value>(&latest).map_err(|e|e.to_string())?!=done.report{return Err("报告已更新，本次未写入".into());}
    tx.execute("UPDATE report SET report_json=? WHERE id=1",params![updated.to_string()]).map_err(|e|e.to_string())?;
    tx.execute("UPDATE book SET updated_at=?",params![now()]).map_err(|e|e.to_string())?;
    let disk=Checkpoint{state:serde_json::to_value(&done).unwrap(),title:done.title.clone(),report:done.report.clone(),candidate:None,reviewed:None};
    tx.execute("UPDATE idea_generation SET body=? WHERE id=1",params![serde_json::to_string(&disk).unwrap()]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;runtime.state=done;Ok(())
}
fn launch(app:AppHandle,job:Job,config:ModelConfig,operation:completeness::BookOperation)->Result<State,String>{
    if config.api_key.trim().is_empty(){return Err("请先配置模型".into());}
    let (handle,registration)=AbortHandle::new_pair();
    let (epoch,snapshot)={let mut runtime=job.lock().map_err(|_|"任务锁不可用")?;runtime.epoch+=1;runtime.abort=Some(handle);runtime.state.status="running".into();runtime.state.message=if runtime.state.completed==0{"1/3 · 正在构思新的方案"}else if runtime.state.completed==1{"2/3 · 正在审稿并核对原创差异"}else{"3/3 · 正在保存方案"}.into();runtime.state.updated_at=now();persist(&app,&runtime.state)?;(runtime.epoch,runtime.state.clone())};
    tauri::async_runtime::spawn(async move{
        let outcome=Abortable::new(work(app.clone(),job.clone(),epoch,operation,config),registration).await;
        if let Ok(Err(error))=outcome {if let Ok(mut runtime)=job.lock(){if runtime.epoch==epoch && runtime.state.status=="running"{runtime.state.status="failed".into();runtime.state.message=error;runtime.state.updated_at=now();let _=persist(&app,&runtime.state);}}}
    });Ok(snapshot)
}
#[tauri::command]
pub fn get_idea_job(app:AppHandle,id:String)->Result<Option<State>,String>{
    find(&app,&id)?.map(|job|job.lock().map(|r|r.state.clone()).map_err(|_|"任务锁不可用".into())).transpose()
}
#[tauri::command]
pub fn start_idea_job(app:AppHandle,id:String,platform:String,config:ModelConfig)->Result<State,String>{
    if config.api_key.trim().is_empty(){return Err("请先配置模型".into());}
    ideas::platforms(Some(&platform))?;
    let operation=completeness::BookOperation::acquire(&id)?;
    if let Some(job)=find(&app,&id)?{let runtime=job.lock().map_err(|_|"任务锁不可用")?;if ["running","paused"].contains(&runtime.state.status.as_str()){return Err("已有灵感任务，请继续或取消后再添加".into());}}
    let book=read_book(&app,&id)?;if book.status=="analyzing"{return Err("该书正在分析".into());}
    let job=Arc::new(Mutex::new(Runtime{epoch:0,abort:None,state:State{id:Uuid::new_v4().to_string(),book_id:id.clone(),platform,status:"running".into(),completed:0,message:String::new(),updated_at:now(),title:book.title,report:book.report.ok_or("请先生成拆书报告")?,candidate:None,reviewed:None}}));
    registry().lock().map_err(|_|"任务锁不可用")?.insert(id,job.clone());launch(app,job,config,operation)
}
#[tauri::command]
pub fn control_idea_job(app:AppHandle,id:String,task_id:String,action:String,config:Option<ModelConfig>)->Result<State,String>{
    let job=find(&app,&id)?.ok_or("灵感任务不存在")?;
    {
        let mut runtime=job.lock().map_err(|_|"任务锁不可用")?;
        if runtime.state.id!=task_id{return Err("任务已更新，请刷新".into());}
        if action=="resume"{
            if !["paused","failed"].contains(&runtime.state.status.as_str()){return Err("只能继续已暂停或失败任务".into());}
            unchanged(&app,&runtime.state)?;
        }else{
            if !["running","paused"].contains(&runtime.state.status.as_str()) || (runtime.state.status=="running" && runtime.state.completed>=2){return Err("任务已结束或正在保存，无法更改".into());}
            if !["pause","cancel"].contains(&action.as_str()){return Err("未知任务操作".into());}
            runtime.stop(action=="cancel");
            persist(&app,&runtime.state)?;return Ok(runtime.state.clone());
        }
    }
    let operation=completeness::BookOperation::acquire(&id)?;
    launch(app,job,config.ok_or("继续任务需要模型配置")?,operation)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state()->State{State{id:"task".into(),book_id:"book".into(),platform:"起点".into(),status:"running".into(),completed:1,message:String::new(),updated_at:now(),title:"原书".into(),report:json!({"summary":"原报告"}),candidate:Some(json!({"ideas":["已完成构思"]})),reviewed:None}}
    #[test]
    fn pause_aborts_request_retains_checkpoint_and_rejects_late_write(){
        let (handle,registration)=AbortHandle::new_pair();
        let mut runtime=Runtime{state:state(),epoch:7,abort:Some(handle)};
        runtime.stop(false);
        assert!(!runtime.accepts(7));
        assert!(runtime.state.candidate.is_some());
        assert_eq!(runtime.state.completed,1);
        let result=futures::executor::block_on(Abortable::new(futures::future::pending::<()>(),registration));
        assert!(result.is_err());
        runtime.state.status="running".into();runtime.epoch+=1;
        assert!(!runtime.accepts(7));assert!(runtime.accepts(9));
        runtime.stop(true);
        assert!(runtime.state.candidate.is_none());assert!(!runtime.accepts(9));
    }
    #[test]
    fn disk_checkpoint_preserves_resume_data_but_frontend_snapshot_omits_it(){
        let original=state();let public=serde_json::to_value(&original).unwrap();
        assert!(public.get("report").is_none());assert!(public.get("candidate").is_none());
        let saved=Checkpoint{state:public,title:original.title,report:original.report,candidate:original.candidate,reviewed:None};
        let saved:Checkpoint=serde_json::from_str(&serde_json::to_string(&saved).unwrap()).unwrap();
        let mut restored:State=serde_json::from_value(saved.state).unwrap();restored.candidate=saved.candidate;
        assert_eq!(restored.completed,1);assert!(restored.candidate.is_some());
    }
}
