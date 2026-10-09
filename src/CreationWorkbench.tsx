import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Sparkles, History, Download, X, Maximize2, Minimize2, Check, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@/components/ui/select";
import { CreationResources } from "./CreationResources";
import { useProjectDraft } from "./lib/use-creation-draft";
import { countText } from "./lib/word-count";
import { cn } from "./lib/utils";
import { acceptCreationTask, chapterAction, creationVersions, dismissCreationTask, exportCreation, exportCreationDraft, generateCreation, listCreationTasks, readCreationChapter, restoreCreationVersion, type ChapterState, type CreationDoc, type CreationProject, type CreationTask, type CreationVersion } from "./lib/creation";
import type { BookSummary, ModelConfig } from "./types";

type View = "story" | "chapters" | "resources";
type Phase = "prepare" | "draft" | "review" | "revision" | "finalized";
const phases: [Phase, string][] = [["prepare", "准备"], ["draft", "草稿"], ["review", "审稿"], ["revision", "修订"], ["finalized", "定稿"]];
const emptyState: ChapterState = { review: null, activeFinalization: null, finalizations: [], recordTaskIds: [] };
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const stamp = (s: string) => new Date(s).toLocaleString("zh-CN");

export function CreationWorkbench({ initial, config, onSettings, onBack, onFocusChange }: {
  initial: CreationProject; books: BookSummary[]; config: ModelConfig; onSettings: () => void; onBack: () => void; onFocusChange: (value: boolean) => void;
}) {
  const draft = useProjectDraft(initial), p = draft.project;
  const chapters = p.volumes.flatMap(v => p.documents.filter(d => d.kind === "chapter" && d.volumeId === v.id));
  const [view, setView] = useState<View>(() => chapters.some(d => d.content.trim()) ? "chapters" : p.documents.some(d => d.kind === "source") ? "resources" : "story");
  const [docId, setDocId] = useState(chapters.find(d => d.content.trim())?.id || chapters[0]?.id || "");
  const doc = p.documents.find(d => d.id === docId && d.kind === "chapter");
  const brief = p.documents.find(d => d.kind === "brief")!;
  const outline = p.documents.find(d => d.kind === "outline")!;
  const [resourceId, setResourceId] = useState(p.documents.find(d => d.kind === "resource")?.id || brief.id);
  const [phase, setPhase] = useState<Phase>(doc?.content.trim() ? "draft" : "prepare");
  const [cycle, setCycle] = useState<ChapterState>(emptyState);
  const [cycleLoading, setCycleLoading] = useState(false);
  const [cycleTick, setCycleTick] = useState(0);
  const [tasks, setTasks] = useState<CreationTask[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [assistant, setAssistant] = useState<{ skill: string; documentId: string; label: string } | null>(null);
  const [instruction, setInstruction] = useState("");
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null);
  const [polish, setPolish] = useState<{ taskId: string; start: number; end: number; source: string } | null>(null);
  const [preview, setPreview] = useState<CreationTask | null>(null);
  const [issues, setIssues] = useState<{ text: string; checked: boolean }[]>([]);
  const [reviewTaskId, setReviewTaskId] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<"finalize" | "confirm_records" | null>(null);
  const [focus, setFocus] = useState(false);
  const [more, setMore] = useState(false);
  const [versions, setVersions] = useState<CreationVersion[] | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<CreationVersion | null>(null);
  const [settings, setSettings] = useState(false);
  const [volumeName, setVolumeName] = useState("");
  const [volumeDialog, setVolumeDialog] = useState(false);
  const locked = !!cycle.activeFinalization;
  const running = tasks.some(t => t.status === "running");
  const chapterTasks = tasks.filter(t => t.documentId === docId);
  const reviewTask = chapterTasks.find(t => t.skill === "review" && t.status === "ready");
  const revisionTask = chapterTasks.find(t => t.skill === "revision" && t.status === "ready");
  const memoryTask = chapterTasks.find(t => t.skill === "memory" && t.status === "ready" && t.finalizationId === cycle.activeFinalization);
  const currentRecords = cycle.recordTaskIds.filter(id => tasks.some(t => t.id === id && t.finalizationId === cycle.activeFinalization));
  const reviewCurrent = !!doc && cycle.review?.sourceContent === doc.content;
  const total = chapters.reduce((sum,d) => sum + countText(d.content), 0);
  const related: string[] = (() => { try { return JSON.parse(doc?.details?.relatedIds || "[]"); } catch { return []; } })();
  const resources = p.documents.filter(d => d.kind === "resource" && d.details?.status !== "已弃用");

  useEffect(() => {
    let active = true;
    const refresh = () => listCreationTasks(initial.id).then(v => { if (active) setTasks(v); }).catch(e => { if (active) setError(message(e)); });
    void refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [initial.id]);
  useEffect(() => {
    let active = true;
    setCycle(emptyState); setCycleLoading(!!docId);
    if (docId) void readCreationChapter(initial.id, docId).then(v => {
      if (!active) return;
      setCycle(v); setCycleLoading(false);
      if (v.activeFinalization) setPhase("finalized");
      if (v.review) { setIssues(v.review.issues.map(text => ({ text, checked: true }))); setReviewTaskId(v.review.taskId || undefined); }
      else { setIssues([]); setReviewTaskId(undefined); }
    }).catch(e => { if (active) { setError(message(e)); setCycleLoading(false); } });
    return () => { active = false; };
  }, [initial.id, docId, cycleTick]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focus) { setFocus(false); onFocusChange(false); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void draft.flush().catch(e => setError(message(e))); }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });
  const perform = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await fn(); } catch(e) { setError(message(e)); } finally { busyRef.current = false; setBusy(false); }
  };
  const update = (id: string, patch: Partial<CreationDoc>) => draft.change(value => ({ ...value, documents: value.documents.map(d => d.id === id ? { ...d, ...patch } : d) }));
  const detail = (key: string, value: string) => { if(doc) update(doc.id, { details: { ...doc.details, [key]: value } }); };
  const selectChapter = (d: CreationDoc) => { setDocId(d.id); setView("chapters"); setPhase(d.content.trim() ? "draft" : "prepare"); setAssistant(null); setSelection(null); setPolish(null); setPreview(null); setIssues([]); };
  const addChapter = (volumeId: string) => {
    const chapter: CreationDoc = { id: crypto.randomUUID(), kind: "chapter", title: `第${chapters.length + 1}章`, content: "", goal: "", volumeId, details: {} };
    draft.change(value => ({ ...value, documents: [...value.documents, chapter] })); selectChapter(chapter);
  };
  const openAssistant = (skill: string, target: CreationDoc, label: string) => { setAssistant({ skill, documentId: target.id, label }); setInstruction(""); };
  const generate = () => perform(async () => {
    if(!assistant) return;
    if(!config.apiKey.trim()) { onSettings(); return; }
    const saved = await draft.flush();
    const request = assistant.skill === "polish" && selection ? `${instruction}\n只润色以下选中片段，只返回该片段：\n${selection.text}` : instruction;
    const task = await generateCreation(saved.id, assistant.documentId, assistant.skill, request, config, saved.revision, { workflowMode: true, reviewId: assistant.skill === "revision" ? cycle.review?.id : undefined, finalizationId: assistant.skill === "memory" ? cycle.activeFinalization || undefined : undefined });
    if(assistant.skill === "polish" && selection && doc) setPolish({ taskId: task.id, start: selection.start, end: selection.end, source: doc.content });
    setTasks(await listCreationTasks(saved.id));
  });
  const action = (actionName: "confirm_review" | "finalize" | "reopen" | "confirm_records") => perform(async () => {
    if(!doc) return;
    const saved = await draft.flush();
    const result = await chapterAction({ id: saved.id, documentId: doc.id, revision: saved.revision, action: actionName, taskId: actionName === "confirm_review" ? reviewTaskId : actionName === "confirm_records" ? memoryTask?.id : undefined, issues: actionName === "confirm_review" ? issues.filter(i => i.checked).map(i => i.text) : undefined });
    draft.replace(result); setCycleTick(v => v + 1); setConfirm(null);
    if(actionName === "confirm_review") setPhase("revision");
    if(actionName === "reopen") setPhase("draft");
    if(actionName === "finalize") { setPhase("finalized"); setAssistant(null); }
    setTasks(await listCreationTasks(saved.id));
  });
  const useReview = () => {
    if(!reviewTask) return;
    setIssues(reviewTask.content.split(/\n\s*\n/).filter(v => v.trim()).slice(0,30).map(text => ({ text: text.trim(), checked: true })));
    setReviewTaskId(reviewTask.id);
  };
  const accept = (task: CreationTask) => perform(async () => {
    const saved = await draft.flush();
    if(task.revision !== saved.revision) throw new Error("候选生成后作品已有修改，请重新生成或复制后手动合并。");
    if(task.skill === "polish") {
      const current = saved.documents.find(d => d.id === task.documentId)!;
      if(!polish || polish.taskId !== task.id || current.content !== polish.source) throw new Error("选段来源已改变，请重新选择文字。");
      update(current.id, { content: current.content.slice(0,polish.start) + task.content + current.content.slice(polish.end) });
      await draft.flush(); await dismissCreationTask(task.id);
    } else draft.replace(await acceptCreationTask(task.id, task.skill === "draft" && task.sourceContent.trim() ? "append" : "replace", saved.revision));
    setPreview(null); setSelection(null); setTasks(await listCreationTasks(saved.id));
    if(task.skill === "revision") setPhase("draft");
  });
  const proceed = () => {
    const currentIndex = chapters.findIndex(d => d.id === docId);
    const next = chapters[currentIndex + 1];
    if(next) selectChapter(next); else addChapter(doc?.volumeId || p.volumes[0].id);
  };
  const assistantTasks = assistant ? tasks.filter(t => t.documentId === assistant.documentId && t.skill === assistant.skill) : [];
  const latest = assistantTasks[0];
  const canEdit = !busy && !locked && !cycleLoading;

  return <section className={cn("creation-workspace", "creation-workbench", focus && "creation-workspace--focus")}>
    <header className="creation-heading"><div className="creation-heading-title"><Button variant="ghost" size="icon-sm" aria-label="返回作品列表" onClick={() => void perform(async () => { await draft.flush(); onBack(); })}><ArrowLeft /></Button><div><h2>{p.title}</h2><p>{p.genre || "题材待定"} · {total.toLocaleString()} 字</p></div></div><div className="creation-heading-actions"><span role="status">{draft.state}</span><Button variant="ghost" size="sm" onClick={() => setMore(true)}>更多</Button><Button variant="ghost" size="icon-sm" aria-label={focus ? "退出专注写作" : "专注写作"} onClick={() => { setFocus(!focus); onFocusChange(!focus); }} >{focus ? <Minimize2 /> : <Maximize2 />}</Button></div></header>
    {!focus && <div className="creation-stage-bar"><Tabs value={view} onValueChange={v => { setView(v as View); setAssistant(null); }}><TabsList variant="line" aria-label="作品导航"><TabsTrigger value="story">故事准备</TabsTrigger><TabsTrigger value="chapters">章节</TabsTrigger><TabsTrigger value="resources">资料库</TabsTrigger></TabsList></Tabs></div>}
    {(error || draft.error) && <Alert variant="destructive"><AlertDescription>{error || draft.error}<Button variant="ghost" size="sm" onClick={() => void perform(async () => { await draft.flush(); })}>重新保存</Button><Button variant="ghost" size="sm" onClick={() => void perform(async () => { const raw = localStorage.getItem(`inkscope-creation-conflict-${p.id}`) || JSON.stringify(p); toast.success(await exportCreationDraft(raw)); })}>导出恢复草稿</Button></AlertDescription></Alert>}
    <div className={cn("workbench-content", assistant && "workbench-content--assistant")}>
      {view === "story" && <main className="workbench-story"><header><h2>故事准备</h2><p>写下故事想法，安排近期情节，然后进入章节开始写作。</p></header><FieldGroup><Field><div className="workbench-field-heading"><FieldLabel htmlFor="story-brief">故事简案</FieldLabel><Button variant="ghost" size="sm" onClick={() => openAssistant("premise", brief, "完善故事简案")}><Sparkles />AI 协助</Button></div><Textarea id="story-brief" rows={6} value={brief.content} onChange={e => update(brief.id,{ content:e.target.value })} placeholder="谁想得到什么？面临什么阻力？这个故事最吸引你的是什么？" /><FieldDescription>已有设定不必重抄。在资料库保留原文，并确认写作需要的部分。</FieldDescription></Field><Field><div className="workbench-field-heading"><FieldLabel htmlFor="story-outline">近期情节与章节安排</FieldLabel><Button variant="ghost" size="sm" onClick={() => openAssistant("outline",outline,"规划近期章节")}><Sparkles />AI 协助</Button></div><Textarea id="story-outline" rows={8} value={outline.content} onChange={e => update(outline.id,{ content:e.target.value })} placeholder="当前卷的目标、主要冲突、关键选择、卷末变化。先展开近期3–5章。" /></Field><div className="workbench-actions"><Button onClick={() => { setView("chapters"); setPhase("prepare"); if(!doc) addChapter(p.volumes[0].id); }}>进入章节写作</Button></div></FieldGroup></main>}
      {view === "resources" && <CreationResources project={p} onChange={draft.change} selectedId={resourceId} onSelect={d => setResourceId(d.id)} />}
      {view === "chapters" && <div className="workbench-chapters">{!focus && <nav className="creation-navigation" aria-label="分卷与章节"><header><span>分卷与章节</span><Button variant="ghost" size="icon-sm" aria-label="添加分卷" onClick={() => setVolumeDialog(true)}><Plus /></Button></header>{p.volumes.map(v => <section key={v.id}><div className="creation-volume-heading"><strong>{v.title}</strong><Button variant="ghost" size="icon-sm" aria-label={`向${v.title}添加章节`} onClick={() => addChapter(v.id)}><Plus /></Button></div>{chapters.filter(d => d.volumeId === v.id).map(d => <button key={d.id} className={cn("creation-doc-link", d.id === docId && "is-active")} onClick={() => selectChapter(d)}><span>{d.title}</span><small>{countText(d.content).toLocaleString()} 字</small></button>)}</section>)}</nav>}
      {doc ? <main className="workbench-chapter-main"><header className="workbench-chapter-header"><Input aria-label="文档名称" value={doc.title} readOnly={!canEdit} onChange={e => update(doc.id,{ title:e.target.value })} /><span>{countText(doc.content).toLocaleString()} 字{locked && " · 已定稿"}</span></header>{!focus && <Tabs value={phase} onValueChange={v => { setPhase(v as Phase); setAssistant(null); }}><TabsList variant="line" aria-label="本章流程">{phases.map(([key,label]) => <TabsTrigger key={key} value={key}>{label}</TabsTrigger>)}</TabsList></Tabs>}
      {cycleLoading ? <p className="workbench-loading">正在读取章节流程…</p> : <>
      {phase === "prepare" && <div className="workbench-phase"><h3>这一章要发生什么</h3><p>写清目标、阻力和变化，再选择本章确实需要的资料。</p><FieldGroup><Field><FieldLabel htmlFor="chapter-goal">本章目标</FieldLabel><Textarea id="chapter-goal" readOnly={!canEdit} value={doc.goal} onChange={e => update(doc.id,{goal:e.target.value})} placeholder="人物想做什么？本章承担什么故事功能？" /></Field>{[["conflict","主要阻力","什么阻止人物达成目标？"],["outcome","本章结果","结束时发生了什么变化，付出什么代价？"],["characters","出场人物","本章涉及哪些人物？"]].map(([key,label,hint]) => <Field key={key}><FieldLabel htmlFor={`chapter-${key}`}>{label}</FieldLabel><Input id={`chapter-${key}`} readOnly={!canEdit} value={doc.details?.[key] || ""} onChange={e => detail(key,e.target.value)} placeholder={hint} /></Field>)}<Field><FieldLabel>本章相关资料</FieldLabel><FieldDescription>勾选后明确带入本章。待确认资料会标明状态；已弃用条目不参与选择。</FieldDescription><div className="workbench-linked-resources">{resources.map(r => <label key={r.id}><Checkbox disabled={!canEdit} checked={related.includes(r.id)} onCheckedChange={v => detail("relatedIds", JSON.stringify(v === true ? [...related,r.id] : related.filter(id => id !== r.id)))} /><span>{r.title}<small>{r.details?.status || "待确认"}</small></span></label>)}{!resources.length && <p>还没有资料条目，可以先写，也可以去资料库整理。</p>}</div></Field><div className="workbench-actions"><Button variant="outline" onClick={() => setView("resources")}>整理资料</Button><Button onClick={() => setPhase(locked ? "finalized" : "draft")}>{locked ? "查看定稿" : "开始写作"}</Button></div></FieldGroup></div>}
      {phase === "draft" && <div className="workbench-draft"><div className="workbench-actions">{!locked && <><Button size="sm" disabled={busy || running} onClick={() => openAssistant("draft",doc,doc.content.trim() ? "续写本章" : "起草本章")}><Sparkles />{doc.content.trim() ? "续写本章" : "起草本章"}</Button>{selection && <Button size="sm" variant="outline" onClick={() => openAssistant("polish",doc,"润色选中内容")}>润色选中内容</Button>}<Button size="sm" variant="outline" disabled={!doc.content.trim()} onClick={() => setPhase("review")}>进入审稿</Button><Button size="sm" variant="ghost" disabled={!doc.content.trim() || busy || running} onClick={() => setConfirm("finalize")}>人工确认定稿</Button></>}{locked && <Button onClick={() => setPhase("finalized")}>查看定稿与记录</Button>}</div><Textarea aria-label="章节正文" className="creation-body" value={doc.content} readOnly={!canEdit} onChange={e => { update(doc.id,{content:e.target.value}); setSelection(null); }} onSelect={e => { const node=e.currentTarget; setSelection(node.selectionEnd > node.selectionStart ? { start:node.selectionStart,end:node.selectionEnd,text:node.value.slice(node.selectionStart,node.selectionEnd) } : null); }} placeholder="写下正文。你可以手动写作，也可以让 AI 根据本章计划起草。" /><p className="workbench-save-note">自动保存 · ⌘ / Ctrl S · AI 候选采用前不会覆盖正文</p></div>}
      {phase === "review" && <div className="workbench-phase"><h3>选择真正需要修改的问题</h3><p>意见可以修改、忽略或自行补充。确认后才交给修订。</p>{cycle.review && !reviewCurrent && <Alert><AlertDescription>原审稿基于旧稿，当前正文已改变。请重新审稿或重新确认人工意见。</AlertDescription></Alert>}<div className="workbench-actions"><Button variant="outline" disabled={locked || !doc.content.trim() || busy || running} onClick={() => openAssistant("review",doc,"检查本章")}><Sparkles />检查本章</Button>{reviewTask && <Button variant="outline" disabled={reviewTask.sourceContent !== doc.content} onClick={useReview}>载入最新审稿意见</Button>}<Button variant="ghost" disabled={locked} onClick={() => { setReviewTaskId(undefined); setIssues(v => [...v,{text:"",checked:true}]); }}>添加人工意见</Button></div>{reviewTask && reviewTask.sourceContent !== doc.content && <p>最新报告基于旧稿，无法直接用于当前修订。</p>}<div className="workbench-issues">{issues.map((issue,index) => <div key={index}><Checkbox aria-label={`采用意见${index+1}`} disabled={locked} checked={issue.checked} onCheckedChange={v => setIssues(items => items.map((it,i) => i===index ? {...it,checked:v===true} : it))} /><Textarea aria-label={`审稿意见${index+1}`} readOnly={locked} value={issue.text} onChange={e => setIssues(items => items.map((it,i) => i===index ? {...it,text:e.target.value} : it))} /><Button variant="ghost" size="icon-sm" aria-label={`删除意见${index+1}`} disabled={locked} onClick={() => setIssues(items => items.filter((_,i) => i!==index))}><X /></Button></div>)}</div>{!issues.length && <p>可以先检查本章，也可以直接填写人工意见。无需为了继续流程调用 AI。</p>}<Button disabled={locked || busy || !issues.some(i=>i.checked && i.text.trim())} onClick={() => void action("confirm_review")}>确认意见，进入修订</Button></div>}
      {phase === "revision" && <div className="workbench-phase"><h3>按确认意见修订</h3>{!reviewCurrent ? <><p>尚无针对当前草稿确认的意见。</p><Button variant="outline" onClick={() => setPhase("review")}>返回审稿</Button></> : <><ol>{cycle.review?.issues.map((text,i) => <li key={i}>{text}</li>)}</ol><div className="workbench-actions"><Button disabled={locked || busy || running} onClick={() => openAssistant("revision",doc,"生成修订稿")}><Sparkles />生成修订稿</Button><Button variant="outline" onClick={() => setPhase("draft")}>手动修改正文</Button>{revisionTask && <Button variant="outline" onClick={() => setPreview(revisionTask)}>对照修订稿</Button>}</div><p>修订稿先与原稿对照。采用后保存为新版本，不直接修改旧定稿。</p></>}</div>}
      {phase === "finalized" && <div className="workbench-phase"><h3>{locked ? "本章已定稿" : "确认这一章"}</h3>{!locked ? <><p>将当前正文保存为不可变快照。以后修改时创建修订版，保留这次定稿。</p><Button disabled={!doc.content.trim() || busy || running} onClick={() => setConfirm("finalize")}>确认定稿</Button></> : <><p>正文已保留。接下来核对本章记录，为下一章提供可靠的衔接。</p><div className="workbench-actions"><Button variant="outline" disabled={busy || running} onClick={() => openAssistant("memory",doc,"整理本章记录")}>整理本章记录</Button><Button variant="ghost" disabled={busy} onClick={() => void action("reopen")}>创建修订版</Button></div>{memoryTask && <section className="workbench-records"><h4>待核对的本章记录</h4><pre>{memoryTask.content}</pre><Button disabled={busy} onClick={() => setConfirm("confirm_records")}>核对后确认保存记录</Button></section>}{currentRecords.length > 0 && <p><Check className="inline size-4" /> 已有 {currentRecords.length} 份当前定稿的确认记录；历史记录与其定稿版本关联。</p>}<details><summary>查看当前定稿正文</summary><pre className="creation-source-text">{doc.content}</pre></details><Button onClick={proceed}>{currentRecords.length ? "准备下一章" : "暂不整理记录，准备下一章"}</Button></>}<details><summary>历史定稿 · {cycle.finalizations.length} 版</summary>{cycle.finalizations.map(f => <details key={f.id}><summary>{stamp(f.createdAt)} · {f.title}</summary><pre className="creation-source-text">{f.content}</pre></details>)}</details></div>}
      </> }</main> : <main className="workbench-phase"><h3>安排第一章</h3><p>先添加一章，明确这一章要发生的事情。</p><Button onClick={() => addChapter(p.volumes[0].id)}>添加第一章</Button></main>}</div>}
      {assistant && <aside className="workbench-assistant"><header><strong>{assistant.label}</strong><Button variant="ghost" size="icon-sm" aria-label="关闭AI协作" onClick={() => setAssistant(null)}><X /></Button></header><FieldGroup><Field><FieldLabel htmlFor="workflow-instruction">本次要求（可选）</FieldLabel><Textarea id="workflow-instruction" value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="补充希望保留的内容或修改重点" /></Field><Button disabled={busy || running || cycleLoading} onClick={() => void generate()}>{(busy || running) && <LoaderCircle className="animate-spin" />}{running ? "正在生成…" : assistant.label}</Button></FieldGroup>{latest && <article data-testid="creation-proposal"><p>{latest.status === "running" ? "任务已保存，可以关闭辅助栏后继续查看作品。" : latest.status === "failed" ? "本次任务未完成，已有正文保留。" : "候选结果 · 采用前不写入正文"}</p>{latest.error && <Alert><AlertDescription>{latest.error}</AlertDescription></Alert>}<pre>{latest.content}</pre><details><summary>本次使用的资料范围</summary><p>{latest.context}</p></details>{latest.status === "ready" && <div className="workbench-actions">{latest.skill === "review" ? <Button onClick={() => { setView("chapters"); setPhase("review"); setIssues(latest.content.split(/\n\s*\n/).filter(v=>v.trim()).slice(0,30).map(text=>({text,checked:true}))); setReviewTaskId(latest.id); setAssistant(null); }}>选择审稿意见</Button> : latest.skill === "memory" ? <Button onClick={() => { setPhase("finalized"); setAssistant(null); }}>去核对记录</Button> : <Button onClick={() => setPreview(latest)}>预览并采用</Button>}<Button variant="ghost" onClick={() => void perform(async () => { await dismissCreationTask(latest.id); setTasks(await listCreationTasks(p.id)); })}>忽略候选</Button></div>}</article>}</aside>}
    </div>
    <Dialog open={!!preview} onOpenChange={v=>{if(!v&&!busy)setPreview(null);}}><DialogContent className="creation-compare-dialog"><DialogHeader><DialogTitle>{preview?.skill === "revision" ? "修订对照" : "采用预览"}</DialogTitle><DialogDescription>核对原文与候选。采用会保存新版本；过期候选不会覆盖新输入。</DialogDescription></DialogHeader>{preview && <div className="creation-compare"><section><h4>原文</h4><pre>{preview.sourceContent || "（空白）"}</pre></section><section><h4>{preview.skill === "draft" && preview.sourceContent.trim() ? "追加内容" : "候选内容"}</h4><pre>{preview.content}</pre></section></div>}<DialogFooter><Button variant="outline" onClick={()=>setPreview(null)}>保留原文</Button><Button disabled={busy || !preview || preview.revision !== p.revision || draft.dirty()} onClick={()=>preview&&void accept(preview)}>确认采用</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!confirm} onOpenChange={v=>{if(!v&&!busy)setConfirm(null);}}><DialogContent><DialogHeader><DialogTitle>{confirm === "finalize" ? "确认当前正文定稿" : "确认本章记录"}</DialogTitle><DialogDescription>{confirm === "finalize" ? "保存当前可见正文为独立快照。以后修改请创建修订版；AI 审稿不是必需步骤。" : "请确认记录与本章实际正文一致。确认后保存到资料库，并关联当前定稿版本。"}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={()=>setConfirm(null)}>取消</Button><Button disabled={busy} onClick={()=>confirm&&void action(confirm)}>确认</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={more} onOpenChange={setMore}><DialogContent><DialogHeader><DialogTitle>作品操作</DialogTitle><DialogDescription>设置、导出与历史版本。日常写作在章节流程中完成。</DialogDescription></DialogHeader><div className="workbench-actions"><Button variant="outline" onClick={()=>{setMore(false);setSettings(true);}}>作品设置</Button><Button variant="outline" disabled={!doc} onClick={()=>void perform(async()=>{await draft.flush();setVersions(await creationVersions(p.id,docId));setMore(false);})}><History />本章历史版本</Button>{["txt","docx"].map(format=><Button key={format} variant="outline" onClick={()=>void perform(async()=>{await draft.flush();toast.success(`已导出到 ${await exportCreation(p.id,format as "txt"|"docx")}`);})}><Download />导出 {format === "txt" ? "TXT" : "Word"}</Button>)}</div></DialogContent></Dialog>
    <Dialog open={versions!==null} onOpenChange={v=>{if(!v){setVersions(null);setSelectedVersion(null);}}}><DialogContent className="creation-dialog"><DialogHeader><DialogTitle>本章历史版本</DialogTitle><DialogDescription>恢复会另存版本。定稿章节需要先创建修订版。</DialogDescription></DialogHeader><Select value={selectedVersion?.id || "none"} onValueChange={id=>setSelectedVersion(versions?.find(v=>v.id===id)||null)}><SelectTrigger aria-label="选择历史版本"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="none">选择版本</SelectItem>{versions?.map(v=><SelectItem key={v.id} value={v.id}>{stamp(v.createdAt)} · {v.reason}</SelectItem>)}</SelectGroup></SelectContent></Select>{selectedVersion&&<pre className="creation-source-text">{selectedVersion.content}</pre>}<DialogFooter><Button disabled={!selectedVersion||locked||busy} onClick={()=>void perform(async()=>{const saved=await draft.flush();draft.replace(await restoreCreationVersion(p.id,selectedVersion!.id,saved.revision));setVersions(null);setCycleTick(v=>v+1);})}>恢复此版本</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={settings} onOpenChange={setSettings}><DialogContent><DialogHeader><DialogTitle>作品设置</DialogTitle><DialogDescription>这些信息用于组织作品与写作上下文。</DialogDescription></DialogHeader><FieldGroup>{[["title","作品名称"],["genre","题材"],["audience","目标读者"]].map(([key,label])=><Field key={key}><FieldLabel htmlFor={`project-${key}`}>{label}</FieldLabel><Input id={`project-${key}`} value={p[key as "title"|"genre"|"audience"]} onChange={e=>draft.change(v=>({...v,[key]:e.target.value}))}/></Field>)}</FieldGroup><DialogFooter><Button onClick={()=>void perform(async()=>{await draft.flush();setSettings(false);})}>保存设置</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={volumeDialog} onOpenChange={setVolumeDialog}><DialogContent><DialogHeader><DialogTitle>添加分卷</DialogTitle><DialogDescription>将章节按阶段组织。</DialogDescription></DialogHeader><Field><FieldLabel htmlFor="new-volume">分卷名称</FieldLabel><Input id="new-volume" value={volumeName} onChange={e=>setVolumeName(e.target.value)}/></Field><DialogFooter><Button disabled={!volumeName.trim()} onClick={()=>{draft.change(v=>({...v,volumes:[...v.volumes,{id:crypto.randomUUID(),title:volumeName.trim()}]}));setVolumeName("");setVolumeDialog(false);}}>添加</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
