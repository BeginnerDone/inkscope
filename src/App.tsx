import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, ArrowRight, BarChart3, BookOpen, BrainCircuit, Check,
  ChevronRight, Clock3, Copy, Database, FileText, FolderOpen, Gauge,
  Home, KeyRound, Lightbulb, LoaderCircle, Menu, Network, Plus,
  Search, Settings, Sparkles, Trash2, UploadCloud, Users, WandSparkles, X, Zap,
} from 'lucide-react'
import { createBook, deleteBook, exportBook, extractLegadoBook, getBook, getChapter, getLegadoSourceStatus, isTauri, listBooks, listChapters, previewLegadoChapter, previewLegadoToc, refreshLegadoBook, searchLegadoBooks, startAnalysis, syncLegadoSources, testModel } from './lib/tauri'
import type { AnalysisReport, BookSummary, ChapterDetail, ChapterSummary, CreateBookInput, LegadoSearchResult, LegadoSourceStatus, ModelConfig, RemoteChapter, RemoteChapterDetail, TeachingSection } from './types'

type View = 'home' | 'import' | 'reader' | 'analyzing' | 'report'
type ImportMode = 'source' | 'file' | 'text'
type ReportTab = 'overview' | 'outline' | 'plot' | 'payoff' | 'characters' | 'foreshadowing' | 'scenes' | 'crafts' | 'ideas'

const defaultConfig: ModelConfig = { apiKey: '', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' }

function readConfig(): ModelConfig {
  try { return { ...defaultConfig, ...JSON.parse(localStorage.getItem('inkscope-model') || '{}') } }
  catch { return defaultConfig }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '发生未知错误'
}

function score100(value:unknown):number|undefined {
  if(typeof value!=='number'||!Number.isFinite(value))return undefined
  const normalized=value>0&&value<=10?value*10:value
  return Math.round(Math.max(0,Math.min(100,normalized))*10)/10
}

function outlineVolumeCount(report:AnalysisReport) {
  return (report.outline?.originalBlueprint?.volumes?.length||report.storyArchitecture?.chapterBlueprint?.length||report.plot?.stages?.length||0)
}

function normalizeReport(input:AnalysisReport):AnalysisReport {
  const value=(input&&typeof input==='object'?input:{}) as AnalysisReport
  const array=<T,>(candidate:unknown):T[]=>Array.isArray(candidate)?candidate as T[]:candidate&&typeof candidate==='object'?[candidate as T]:[]
  return {...value,
    overallScore:score100(value.overallScore),
    dimensions:array(value.dimensions).map((item:any)=>({...item,score:score100(item.score)??0})),characters:array(value.characters),crafts:array(value.crafts),foreshadowing:array(value.foreshadowing),ideas:array(value.ideas),limitations:array(value.limitations),emotion:array(value.emotion).map((item:any)=>({...item,value:score100(item.value)??0})),
    plot:{...(value.plot||{}),stages:array(value.plot?.stages)},
    characterDesign:array(value.characterDesign),sceneCraft:array(value.sceneCraft),readerExperience:array(value.readerExperience),writingLessons:array(value.writingLessons),
    storyArchitecture:value.storyArchitecture?{...value.storyArchitecture,secondaryLines:array(value.storyArchitecture.secondaryLines),hiddenLines:array(value.storyArchitecture.hiddenLines),chapterBlueprint:array(value.storyArchitecture.chapterBlueprint)}:undefined,
    outline:value.outline?{...value.outline,originalBlueprint:value.outline.originalBlueprint?{...value.outline.originalBlueprint,fiveAct:array(value.outline.originalBlueprint.fiveAct),volumes:array(value.outline.originalBlueprint.volumes),keyPlotBeats:array(value.outline.originalBlueprint.keyPlotBeats),climaxLadder:array(value.outline.originalBlueprint.climaxLadder),hiddenLines:array(value.outline.originalBlueprint.hiddenLines)}:undefined,reusableTemplate:value.outline.reusableTemplate?{...value.outline.reusableTemplate,fiveAct:array(value.outline.reusableTemplate.fiveAct),volumes:array(value.outline.reusableTemplate.volumes),characterTracks:array(value.outline.reusableTemplate.characterTracks),threadMap:array(value.outline.reusableTemplate.threadMap),keyPlotBeats:array(value.outline.reusableTemplate.keyPlotBeats),climaxLadder:array(value.outline.reusableTemplate.climaxLadder),expectationPayoffRules:array(value.outline.reusableTemplate.expectationPayoffRules)}:undefined}:undefined,
  }
}

function App() {
  const [view, setView] = useState<View>('home')
  const [books, setBooks] = useState<BookSummary[]>([])
  const [selected, setSelected] = useState<BookSummary | null>(null)
  const [sidebar, setSidebar] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [config, setConfig] = useState<ModelConfig>(readConfig)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refreshBooks = useCallback(async (query = '') => {
    try { setBooks(await listBooks(query)); setError('') }
    catch (e) { setError(errorText(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (isTauri()) void refreshBooks(); else setLoading(false) }, [refreshBooks])

  useEffect(() => {
    if (!selected || selected.status !== 'analyzing') return
    const timer = window.setInterval(async () => {
      try {
        const current = await getBook(selected.id)
        setSelected(current)
        setBooks(items => items.map(item => item.id === current.id ? current : item))
        if (current.status === 'completed') setView('report')
      } catch (e) { setError(errorText(e)) }
    }, 1400)
    return () => window.clearInterval(timer)
  }, [selected])

  const openBook = async (book: BookSummary) => {
    try {
      const current = await getBook(book.id)
      setSelected(current)
      setView(current.status === 'analyzing' || current.status === 'failed' ? 'analyzing' : current.report ? 'report' : 'import')
    } catch (e) { setError(errorText(e)) }
  }

  const runBook = async (book: BookSummary) => {
    if (!config.apiKey.trim()) { setSelected(book); setSettingsOpen(true); return }
    try {
      await startAnalysis(book.id, config)
      const current = await getBook(book.id)
      setSelected(current); setView('analyzing'); await refreshBooks()
    } catch (e) { setError(errorText(e)) }
  }

  const saveConfig = (next: ModelConfig) => {
    localStorage.setItem('inkscope-model', JSON.stringify(next))
    setConfig(next); setSettingsOpen(false)
  }

  const newBook = () => { setSelected(null); setView('import') }
  const readBook = async (book:BookSummary) => { try { const current=await getBook(book.id);setSelected(current);setView('reader') } catch(e){setError(errorText(e))} }

  return <div className="app-shell">
    <Sidebar open={sidebar} view={view} books={books} selected={selected} onClose={() => setSidebar(false)} onHome={() => setView('home')} onNew={newBook} onOpen={openBook} onSettings={() => setSettingsOpen(true)} />
    <main className="main">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setSidebar(true)} aria-label="打开导航"><Menu size={20}/></button>
        <div className="crumb"><span>InkScope</span><ChevronRight size={14}/><b>{view === 'home' ? '书架' : view === 'import' ? '添加书籍' : view === 'reader' ? '阅读' : view === 'analyzing' ? '分析中' : selected?.title || '拆书报告'}</b></div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => setSearchOpen(true)} aria-label="搜索书库"><Search size={18}/></button>
          <button className="model-chip" onClick={() => setSettingsOpen(true)}><span className={config.apiKey ? 'connected' : ''}/>{config.apiKey ? config.model.replace('deepseek-', '') : '未配置模型'}</button>
        </div>
      </header>
      {!isTauri() && <div className="runtime-banner"><AlertCircle size={17}/><span>当前是普通浏览器。SQLite 与 DeepSeek 功能需通过 <code>npm run tauri</code> 启动客户端。</span></div>}
      {error && <div className="error-banner"><AlertCircle size={17}/><span>{error}</span><button onClick={() => setError('')}><X size={15}/></button></div>}
      {view === 'home' && <HomeView books={books} loading={loading} onNew={newBook} onRead={readBook} onAnalyze={runBook} onReport={openBook} onDelete={async id => {if(selected?.id===id)setSelected(null);await deleteBook(id);await refreshBooks()}} />}
      {view === 'import' && <ImportView selected={selected?.status === 'ready' ? selected : null} modelReady={!!config.apiKey} onSettings={() => setSettingsOpen(true)} onCreated={async book => { setSelected(book); await refreshBooks(); setView('reader') }} onRun={runBook} />}
      {view === 'reader' && selected && <ReaderView book={selected} onAnalyze={() => void runBook(selected)} onReport={() => setView('report')} onRefreshed={async next=>{setSelected(next);await refreshBooks()}} />}
      {view === 'analyzing' && selected && <AnalyzingView book={selected} onHome={() => setView('home')} onRetry={() => void runBook(selected)} />}
      {view === 'report' && selected?.report && <ReportView book={selected} onNew={newBook} onReanalyze={() => void runBook(selected)} />}
    </main>
    {settingsOpen && <SettingsModal value={config} onClose={() => setSettingsOpen(false)} onSave={saveConfig} />}
    {searchOpen && <SearchModal onClose={() => {setSearchOpen(false); void refreshBooks()}} onSearch={refreshBooks} books={books} onOpen={book => {setSearchOpen(false); void openBook(book)}} />}
  </div>
}

function Sidebar({ open, view, books, selected, onClose, onHome, onNew, onOpen, onSettings }: { open:boolean; view:View; books:BookSummary[]; selected:BookSummary|null; onClose:()=>void; onHome:()=>void; onNew:()=>void; onOpen:(book:BookSummary)=>void; onSettings:()=>void }) {
  return <>
    {open && <div className="backdrop" onClick={onClose}/>}<aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><BookOpen size={19}/></div><div><strong>INK<span>SCOPE</span></strong><small>LOCAL STORY LAB</small></div><button className="icon-button close-menu" onClick={onClose}><X size={18}/></button></div>
      <nav>
        <button className={view === 'home' ? 'active' : ''} onClick={() => {onHome();onClose()}}><Home size={18}/>我的书架</button>
        <button className={view === 'import' ? 'active' : ''} onClick={() => {onNew();onClose()}}><Plus size={18}/>添加书籍</button>
      </nav>
      <div className="sidebar-label">BOOK DATABASES</div>
      <div className="recent">{books.slice(0,7).map(book => <button className={selected?.id === book.id ? 'selected-book' : ''} key={book.id} onClick={() => {onOpen(book);onClose()}}><i className={`status-dot ${book.status}`}/><span>{book.title}</span></button>)}{!books.length && <div className="sidebar-empty">还没有 SQLite 书库</div>}</div>
      <div className="sidebar-spacer"/><div className="local-note"><Database size={16}/><div><b>一书一库</b><span>{books.length} 个独立 SQLite 文件</span></div></div>
      <nav className="bottom-nav"><button onClick={onSettings}><Settings size={18}/>模型与设置</button></nav>
    </aside>
  </>
}

function HomeView({ books, loading, onNew, onRead, onAnalyze, onReport, onDelete }: { books:BookSummary[]; loading:boolean; onNew:()=>void; onRead:(b:BookSummary)=>void; onAnalyze:(b:BookSummary)=>void; onReport:(b:BookSummary)=>void; onDelete:(id:string)=>Promise<void> }) {
  const [deleteTarget,setDeleteTarget]=useState<BookSummary|null>(null);const [deleting,setDeleting]=useState(false);const [deleteError,setDeleteError]=useState('')
  const confirmDelete=async()=>{if(!deleteTarget||deleting)return;setDeleting(true);setDeleteError('');try{await onDelete(deleteTarget.id);setDeleteTarget(null)}catch(e){setDeleteError(errorText(e))}finally{setDeleting(false)}}
  return <><div className="page home-page">
    <section className="hero compact-hero"><div><div className="eyebrow"><Sparkles size={14}/> LOCAL STORY INTELLIGENCE</div><h1>读懂故事，<br/><span>留住真正有用的东西。</span></h1><p>每本书都有自己的 SQLite 数据库。原文、切片和 AI 结论可追溯，不展示任何伪造报告。</p><button className="primary" onClick={onNew}><WandSparkles size={18}/>导入第一本书<ArrowRight size={18}/></button></div><div className="library-stat"><Database size={28}/><strong>{books.length}</strong><span>独立书籍数据库</span><small>{books.reduce((sum,b)=>sum+b.characterCount,0).toLocaleString()} 字符已归档</small></div></section>
    <section className="section-head"><div><span className="section-kicker">YOUR LOCAL LIBRARY</span><h2>我的书架</h2></div></section>
    {loading ? <div className="loading-state"><LoaderCircle className="spin"/>读取 SQLite 书架……</div> : books.length ? <div className="project-grid">{books.map(book => <article className="project-card real-book" key={book.id}><button className="book-open-area" onClick={() => onRead(book)}><div className="project-top"><span>{book.sourceType.toUpperCase()}</span><StatusBadge status={book.status}/></div><div className="book-glyph"><span>{book.title.slice(0,1)}</span></div><h3>{book.title}</h3><p>{book.characterCount.toLocaleString()} 字符 · {new Date(book.updatedAt).toLocaleDateString()}</p>{book.report ? <div className="score-row"><div><small>{book.report.coreJudgment || '已完成分析'}</small></div>{typeof book.report.overallScore === 'number' && <strong>{score100(book.report.overallScore)}</strong>}</div> : <div className="pending-line">{book.stage || '等待分析'}</div>}</button><div className="book-card-actions"><button onClick={()=>onRead(book)}><BookOpen size={15}/>阅读</button>{book.report?<button onClick={()=>onReport(book)}><BarChart3 size={15}/>报告</button>:<button onClick={()=>onAnalyze(book)} disabled={book.status==='analyzing'}>{book.status==='analyzing'?<LoaderCircle className="spin" size={15}/>:<BrainCircuit size={15}/>}分析</button>}</div><button className="delete-book" aria-label={`删除${book.title}`} onClick={()=>{setDeleteError('');setDeleteTarget(book)}}><Trash2 size={15}/></button></article>)}</div> : <div className="empty-library"><div className="empty-icon"><FolderOpen size={30}/></div><h3>书架还是空的</h3><p>从书源搜索或导入本地文本，先阅读，再决定是否分析。</p><button className="secondary" onClick={onNew}><Plus size={17}/>添加第一本书</button></div>}
  </div>{deleteTarget&&<div className="modal-backdrop"><section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div className="delete-dialog-icon"><Trash2 size={22}/></div><div><span>DELETE LOCAL BOOK</span><h2 id="delete-title">删除《{deleteTarget.title}》？</h2><p>该书的独立 SQLite、全部章节、分析缓存和报告都会永久删除。</p>{deleteError&&<div className="inline-error"><AlertCircle size={15}/>{deleteError}</div>}</div><footer><button className="secondary" disabled={deleting} onClick={()=>setDeleteTarget(null)}>取消</button><button className="danger-button" disabled={deleting} onClick={()=>void confirmDelete()}>{deleting?<LoaderCircle className="spin" size={16}/>:<Trash2 size={16}/>} {deleting?'正在删除……':'确认删除'}</button></footer></section></div>}</>
}

function StatusBadge({ status }: { status:BookSummary['status'] }) {
  const labels = {ready:'待分析',analyzing:'分析中',completed:'已完成',failed:'失败'}
  return <span className={`status-badge ${status}`}>{status === 'analyzing' && <LoaderCircle size={11} className="spin"/>}{labels[status]}</span>
}

function ImportView({ selected, modelReady, onSettings, onCreated, onRun }: { selected:BookSummary|null; modelReady:boolean; onSettings:()=>void; onCreated:(b:BookSummary)=>Promise<void>; onRun:(b:BookSummary)=>Promise<void> }) {
  const [mode,setMode] = useState<ImportMode>('source'); const [title,setTitle] = useState(''); const [content,setContent] = useState(''); const [fileName,setFileName] = useState(''); const [agreed,setAgreed] = useState(false); const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const inputRef = useRef<HTMLInputElement>(null)
  const readFile = async (file?:File) => { if(!file)return; if(!/\.(txt|md)$/i.test(file.name)){setError('当前真实支持 TXT 和 Markdown，EPUB/DOCX 解析尚未接入');return} setFileName(file.name);setTitle(file.name.replace(/\.(txt|md)$/i,''));setContent(await file.text());setError('') }
  const valid = agreed && mode !== 'source' && !!title.trim() && content.trim().length >= 80
  const submit = async () => { if(!valid)return; setBusy(true);setError(''); try { const input:CreateBookInput={title:title.trim(),sourceType:mode==='file'?'file':'text',sourceUri:fileName,content}; await onCreated(await createBook(input)) } catch(e){setError(errorText(e))} finally{setBusy(false)} }
  if(selected) return <div className="page import-page"><div className="ready-book"><div className="empty-icon"><Database size={30}/></div><div className="eyebrow">SQLITE DATABASE READY</div><h1>《{selected.title}》已归档</h1><p>{selected.characterCount.toLocaleString()} 字符已写入该书的独立 SQLite 数据库。</p>{modelReady?<button className="primary" onClick={()=>void onRun(selected)}><BrainCircuit size={18}/>开始真实分析</button>:<button className="primary" onClick={onSettings}><KeyRound size={18}/>先配置 DeepSeek</button>}</div></div>
  return <div className="page import-page"><div className="center-heading"><div className="eyebrow"><Plus size={14}/> NEW LOCAL DATABASE</div><h1>找到作品，开始拆书。</h1><p>第三方书源、文件与正文都会写入一本书独有的 SQLite。</p></div><div className="import-card"><div className="mode-tabs"><button className={mode==='source'?'active':''} onClick={()=>setMode('source')}><Search size={17}/>书源搜索</button><button className={mode==='file'?'active':''} onClick={()=>setMode('file')}><UploadCloud size={17}/>文本文件</button><button className={mode==='text'?'active':''} onClick={()=>setMode('text')}><FileText size={17}/>粘贴正文</button></div>
  {mode==='source' ? <SourceSearch agreed={agreed} setAgreed={setAgreed} onCreated={onCreated}/> : <div className="import-body">
    <label className="field-label">作品名 <span>REQUIRED</span></label><input className="text-field" value={title} onChange={e=>setTitle(e.target.value)} placeholder="输入作品名"/>
    {mode==='file'&&<div className={`dropzone ${fileName?'has-file':''}`} onClick={()=>inputRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void readFile(e.dataTransfer.files[0])}}><input ref={inputRef} type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={e=>void readFile(e.target.files?.[0])}/>{fileName?<><div className="file-check"><Check size={24}/></div><h3>{fileName}</h3><p>{content.length.toLocaleString()} 字符已实际读取</p></>:<><UploadCloud size={38}/><h3>拖放 TXT 或 Markdown 文件</h3><p>或点击选择文件</p><span>当前仅展示真实支持的格式</span></>}</div>}
    {mode==='text'&&<><label className="field-label text-label">小说正文 <span>{content.length.toLocaleString()} 字符</span></label><textarea className="paste-area" value={content} onChange={e=>setContent(e.target.value)} placeholder="粘贴需要分析的真实正文……"/></>}
    {error&&<div className="inline-error"><AlertCircle size={15}/>{error}</div>}
    <label className="consent"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><span className="fake-check">{agreed&&<Check size={13}/>}</span><span>我确认对该内容拥有合法阅读和私人分析权限。</span></label>
    <button className="primary start-button" disabled={!valid||busy} onClick={()=>void submit()}>{busy?<LoaderCircle className="spin" size={18}/>:<Database size={18}/>} {busy?'正在创建数据库……':'创建独立书籍数据库'}<ArrowRight size={17}/></button>
  </div>}</div></div>
}

function SourceSearch({agreed,setAgreed,onCreated}:{agreed:boolean;setAgreed:(v:boolean)=>void;onCreated:(b:BookSummary)=>Promise<void>}) {
  const [status,setStatus]=useState<LegadoSourceStatus|null>(null)
  const [query,setQuery]=useState('')
  const [sourceFilter,setSourceFilter]=useState('')
  const [selectedSources,setSelectedSources]=useState<string[]>([])
  const [results,setResults]=useState<LegadoSearchResult[]>([])
  const [failed,setFailed]=useState<string[]>([])
  const [chosen,setChosen]=useState<LegadoSearchResult|null>(null)
  const [remoteChapters,setRemoteChapters]=useState<RemoteChapter[]>([])
  const [remoteChapter,setRemoteChapter]=useState<RemoteChapterDetail|null>(null)
  const [maxChapters,setMaxChapters]=useState(0)
  const [busy,setBusy]=useState<'sync'|'search'|'preview'|'download'|''>('')
  const [error,setError]=useState('')

  const loadStatus=useCallback(async()=>{
    try { let next=await getLegadoSourceStatus();if(next.installed&&next.repositoryUrl.includes('71e56d4f'))next=await syncLegadoSources();setStatus(next);if(!selectedSources.length)setSelectedSources(next.sources.filter(s=>s.importCompatible).slice(0,30).map(s=>s.key)) }
    catch(e){setError(errorText(e))}
  },[selectedSources.length])
  useEffect(()=>{void loadStatus()},[loadStatus])

  const sync=async()=>{setBusy('sync');setError('');try{const next=await syncLegadoSources();setStatus(next);setSelectedSources(next.sources.filter(s=>s.importCompatible).slice(0,30).map(s=>s.key))}catch(e){setError(errorText(e))}finally{setBusy('')}}
  const search=async()=>{if(!query.trim()||!selectedSources.length)return;setBusy('search');setError('');setChosen(null);setRemoteChapters([]);setRemoteChapter(null);try{const response=await searchLegadoBooks(query.trim(),selectedSources);setResults(response.results);setFailed(response.failedSources)}catch(e){setError(errorText(e))}finally{setBusy('')}}
  const importBook=async()=>{if(!chosen||!agreed)return;setBusy('download');setError('');try{const book=await extractLegadoBook({sourceKey:chosen.sourceKey,bookUrl:chosen.bookUrl,title:chosen.title,maxChapters});const created=await createBook({title:book.title,sourceType:'legado',sourceUri:`${book.sourceName} · ${book.sourceUri}`,content:book.content});await onCreated(created)}catch(e){setError(errorText(e))}finally{setBusy('')}}
  const loadRemoteToc=async()=>{if(!chosen)return;setBusy('preview');setError('');try{const items=await previewLegadoToc({sourceKey:chosen.sourceKey,bookUrl:chosen.bookUrl});setRemoteChapters(items);setRemoteChapter(null)}catch(e){setError(errorText(e))}finally{setBusy('')}}
  const loadRemoteChapter=async(item:RemoteChapter)=>{if(!chosen)return;setBusy('preview');setError('');try{setRemoteChapter(await previewLegadoChapter(chosen.sourceKey,item.chapterUrl,item.title))}catch(e){setError(errorText(e))}finally{setBusy('')}}
  const toggle=(key:string)=>setSelectedSources(items=>items.includes(key)?items.filter(x=>x!==key):items.length<60?[...items,key]:items)

  if(!status?.installed)return <div className="source-empty"><div className="source-repo-mark"><Network size={27}/></div><div className="eyebrow">AOAOSTAR / LEGADO</div><h2>先同步真实书源</h2><p>默认载入 aoaostar 的全量 Legado 书源集合。同步后会检测每条规则，JavaScript、登录和当前不支持的规则会清楚标记。</p><button className="primary" disabled={busy==='sync'} onClick={()=>void sync()}>{busy==='sync'?<LoaderCircle size={17} className="spin"/>:<Database size={17}/>}同步第三方书源</button>{error&&<div className="inline-error"><AlertCircle size={15}/>{error}</div>}</div>

  const compatible=status.sources.filter(s=>s.searchCompatible)
  const visibleSources=compatible.filter(s=>!sourceFilter.trim()||`${s.name} ${s.group} ${s.url}`.toLowerCase().includes(sourceFilter.trim().toLowerCase())).slice(0,300)
  return <div className="source-workspace">
    <section className="source-toolbar"><div><span>LEGADO SOURCES</span><b>{status.total} 条已同步 · {status.importable} 条可自动抓取</b></div><button className="secondary" disabled={!!busy} onClick={()=>void sync()}>{busy==='sync'?<LoaderCircle size={15} className="spin"/>:<Database size={15}/>}重新同步</button></section>
    <div className="source-layout"><aside className="source-picker"><header><div><b>搜索目标</b><span>最多选择 60 个</span></div><strong>{selectedSources.length} 个已选</strong></header><div className="source-actions"><button onClick={()=>setSelectedSources(visibleSources.slice(0,60).map(s=>s.key))}>选择当前前 60 个</button><button onClick={()=>setSelectedSources([])}>清空</button></div><div className="source-filter"><Search size={13}/><input value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)} placeholder={`筛选 ${compatible.length} 个可搜索书源`}/></div><div className="source-list">{visibleSources.map(source=>{const checked=selectedSources.includes(source.key);return <label key={source.key} className={checked?'selected':''}><input type="checkbox" checked={checked} onChange={()=>toggle(source.key)}/><span className="fake-check">{checked&&<Check size={13}/>}</span><div><b>{source.name}</b><small>{source.reason}{source.responseTime>0&&source.responseTime<999999?` · 历史 ${source.responseTime}ms`:''}</small></div><i className={source.importCompatible?'ready':''}>{source.importCompatible?'可抓取':'仅搜索'}</i></label>})}</div></aside>
      <section className="source-results"><div className="novel-search"><Search size={20}/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void search()}} placeholder="输入小说名，例如：诡秘之主"/><button className="primary" disabled={!query.trim()||!selectedSources.length||!!busy} onClick={()=>void search()}>{busy==='search'?<LoaderCircle size={17} className="spin"/>:'搜索'}</button></div>
      {!results.length&&busy!=='search'&&<div className="source-result-empty"><BookOpen size={28}/><b>从真实书源中查找</b><span>结果来自你勾选的第三方站点，不生成示例数据。</span></div>}
      {!!results.length&&<div className="result-list">{results.map((result,index)=><button key={`${result.sourceKey}-${result.bookUrl}-${index}`} className={chosen?.bookUrl===result.bookUrl?'chosen':''} onClick={()=>{setChosen(result);setRemoteChapters([]);setRemoteChapter(null)}}><div className="result-cover">{result.coverUrl?<img src={result.coverUrl} alt=""/>:<span>{result.title.slice(0,1)}</span>}</div><div><div className="result-meta"><em>{result.sourceName}</em>{result.importCompatible?<i>可查看目录</i>:<i className="limited">仅搜索</i>}</div><h3>{result.title}</h3><p>{result.author||'作者未知'}{result.intro&&` · ${result.intro.slice(0,70)}`}</p></div><span className="result-radio">{chosen?.bookUrl===result.bookUrl&&<Check size={13}/>}</span></button>)}</div>}
      {!!failed.length&&<details className="source-failures"><summary>{failed.length} 个书源未返回结果</summary>{failed.map((x,i)=><p key={i}>{x}</p>)}</details>}
      </section></div>
    {chosen&&<section className="import-dock"><div><span>已选择</span><b>《{chosen.title}》</b><small>{chosen.sourceName} · {maxChapters===0?'下载目录中的全部章节':`仅下载前 ${maxChapters} 章`}</small></div><button className="secondary preview-toc" disabled={!chosen.importCompatible||!!busy} onClick={()=>void loadRemoteToc()}><BookOpen size={16}/>查看目录</button><label>下载范围<select value={maxChapters} onChange={e=>setMaxChapters(Number(e.target.value))}><option value={0}>全部章节（推荐）</option><option value={30}>前 30 章 · 测试</option><option value={100}>前 100 章 · 测试</option><option value={200}>前 200 章 · 测试</option></select></label><label className="consent compact"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><span className="fake-check">{agreed&&<Check size={13}/>}</span><span>我拥有合法阅读与私人分析权限</span></label><button className="primary" disabled={!chosen.importCompatible||!agreed||!!busy} onClick={()=>void importBook()}>{busy==='download'?<LoaderCircle size={17} className="spin"/>:<DownloadIcon/>}{busy==='download'?'正在下载全书…':'下载并加入书架'}</button></section>}
    {!!remoteChapters.length&&<section className="remote-reader"><aside><header><b>目录</b><span>{remoteChapters.length} 章 · 尚未下载</span></header>{remoteChapters.map(item=><button key={item.position} onClick={()=>void loadRemoteChapter(item)}><span>{String(item.position+1).padStart(3,'0')}</span>{item.title}</button>)}</aside><article>{busy==='preview'&&!remoteChapter?<LoaderCircle className="spin"/>:remoteChapter?<><span>ONLINE PREVIEW · 尚未加入书架</span><h3>{remoteChapter.title}</h3><small>{remoteChapter.characterCount.toLocaleString()} 字</small><div>{remoteChapter.content.split('\n').map((line,i)=><p key={i}>{line}</p>)}</div></>:<div className="remote-reader-empty"><BookOpen size={24}/><p>选择章节在线预览；加入书架会下载全部正文</p></div>}</article></section>}
    {error&&<div className="inline-error source-error"><AlertCircle size={15}/>{error}</div>}
  </div>
}

function ReaderView({book,onAnalyze,onReport,onRefreshed}:{book:BookSummary;onAnalyze:()=>void;onReport:()=>void;onRefreshed:(book:BookSummary)=>Promise<void>}) {
  const [chapters,setChapters]=useState<ChapterSummary[]>([]);const [chapter,setChapter]=useState<ChapterDetail|null>(null);const [query,setQuery]=useState('');const [busy,setBusy]=useState(true);const [refreshing,setRefreshing]=useState(false);const [exporting,setExporting]=useState('');const [exported,setExported]=useState('');const [error,setError]=useState('')
  const openChapter=useCallback(async(position:number)=>{setBusy(true);setError('');try{setChapter(await getChapter(book.id,position));requestAnimationFrame(()=>document.querySelector('.reader-content')?.scrollTo({top:0}))}catch(e){setError(errorText(e))}finally{setBusy(false)}},[book.id])
  useEffect(()=>{void(async()=>{setBusy(true);try{const items=await listChapters(book.id);setChapters(items);if(items.length)await openChapter(items[0].position)}catch(e){setError(errorText(e));setBusy(false)}})()},[book.id,openChapter])
  const visible=useMemo(()=>chapters.filter(c=>!query.trim()||c.title.toLowerCase().includes(query.trim().toLowerCase())),[chapters,query])
  const currentIndex=chapters.findIndex(c=>c.position===chapter?.position)
  const refreshFull=async()=>{if(!confirm(`将从原书源补全《${book.title}》的全部章节，并清除旧的部分报告。是否继续？`))return;setRefreshing(true);setError('');try{const next=await refreshLegadoBook(book.id);await onRefreshed(next);const items=await listChapters(book.id);setChapters(items);if(items.length)await openChapter(items[0].position)}catch(e){setError(errorText(e))}finally{setRefreshing(false)}}
  const doExport=async(format:'txt'|'docx')=>{setExporting(format);setError('');setExported('');try{setExported(await exportBook(book.id,format))}catch(e){setError(errorText(e))}finally{setExporting('')}}
  return <div className="reader-page"><header className="reader-header"><div><div className="eyebrow"><BookOpen size={14}/> LOCAL READER · {chapters.length} CHAPTERS</div><h1>{book.title}</h1><p>{book.characterCount.toLocaleString()} 字符 · {book.sourceUri||'本地导入'}</p>{exported&&<small className="export-success"><Check size={12}/>已导出到 {exported}</small>}</div><div className="reader-actions">{book.sourceType==='legado'&&<button className="secondary" disabled={refreshing||book.status==='analyzing'} onClick={()=>void refreshFull()}>{refreshing?<LoaderCircle size={16} className="spin"/>:<DownloadIcon/>}{refreshing?'正在补全':'补全全书'}</button>}<button className="secondary" disabled={!!exporting||!chapters.length} onClick={()=>void doExport('txt')}>{exporting==='txt'?<LoaderCircle size={15} className="spin"/>:<FileText size={15}/>}TXT</button><button className="secondary" disabled={!!exporting||!chapters.length} onClick={()=>void doExport('docx')}>{exporting==='docx'?<LoaderCircle size={15} className="spin"/>:<FileText size={15}/>}Word</button>{book.report&&<button className="secondary" onClick={onReport}><BarChart3 size={16}/>拆书报告</button>}<button className="primary" disabled={book.status==='analyzing'||refreshing||!chapters.length} onClick={onAnalyze}>{book.status==='analyzing'?<LoaderCircle size={16} className="spin"/>:<BrainCircuit size={16}/>} {book.status==='analyzing'?'分析中':book.status==='failed'?'继续分析':'开始分析'}</button></div></header><div className="reader-shell"><aside className="chapter-sidebar"><div className="chapter-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索章节"/></div><div className="chapter-count">目录 · {visible.length} 章</div><div className="chapter-list">{visible.map(item=><button className={chapter?.position===item.position?'active':''} key={item.position} onClick={()=>void openChapter(item.position)}><span>{String(item.position+1).padStart(3,'0')}</span><div><b>{item.title}</b><small>{item.characterCount.toLocaleString()} 字</small></div></button>)}</div></aside><article className="reader-content">{busy&&!chapter?<div className="reader-loading"><LoaderCircle className="spin"/>读取章节……</div>:chapter?<><div className="chapter-heading"><span>CHAPTER {String(chapter.position+1).padStart(3,'0')}</span><h2>{chapter.title}</h2><small>{chapter.characterCount.toLocaleString()} 字</small></div><div className="chapter-prose">{chapter.content.split('\n').map((line,i)=>line.trim()?<p key={i}>{line}</p>:<br key={i}/>)}</div><footer className="reader-pagination"><button disabled={currentIndex<=0} onClick={()=>void openChapter(chapters[currentIndex-1].position)}>上一章</button><span>{currentIndex+1} / {chapters.length}</span><button disabled={currentIndex<0||currentIndex>=chapters.length-1} onClick={()=>void openChapter(chapters[currentIndex+1].position)}>下一章</button></footer></>:<div className="reader-loading">没有可阅读章节</div>}{error&&<div className="inline-error"><AlertCircle size={15}/>{error}</div>}</article></div></div>
}

function DownloadIcon(){return <ArrowRight size={16} style={{transform:'rotate(90deg)'}}/>}

function AnalyzingView({book,onHome,onRetry}:{book:BookSummary;onHome:()=>void;onRetry:()=>void}) {
  const [clock,setClock]=useState(Date.now())
  useEffect(()=>{const timer=window.setInterval(()=>setClock(Date.now()),1000);return()=>window.clearInterval(timer)},[])
  const progress=book.total?Math.round(book.completed/book.total*100):0
  const started=book.jobStartedAt?new Date(book.jobStartedAt).getTime():0
  const updated=book.jobUpdatedAt?new Date(book.jobUpdatedAt).getTime():0
  const elapsed=started?Math.max(0,clock-started):0
  const stale=book.status==='analyzing'&&updated>0&&clock-updated>10*60*1000
  const duration=(ms:number)=>{const seconds=Math.floor(ms/1000);const h=Math.floor(seconds/3600);const m=Math.floor(seconds%3600/60);const s=seconds%60;return h?`${h}时 ${m}分`:`${m}分 ${String(s).padStart(2,'0')}秒`}
  return <div className="page analyzing-page"><div className="analysis-visual">{book.status==='analyzing'?<LoaderCircle className="spin" size={48}/>:<AlertCircle size={48}/>}<span>{progress}%</span></div><div className="eyebrow"><Database size={14}/> LIVE SQLITE JOB</div><h1>{book.status==='failed'?'分析已中断':`正在分析《${book.title}》`}</h1><p>{book.stage}</p><div className="progress-track"><i style={{width:`${progress}%`}}/></div><div className="job-facts"><span><b>{book.completed}</b> / {book.total} 个真实步骤</span><span>{book.characterCount.toLocaleString()} 字符</span></div><div className="job-timing"><div><Clock3 size={16}/><span>已运行</span><b>{started?duration(elapsed):'尚未开始'}</b></div><div><Zap size={16}/><span>最后更新</span><b>{updated?`${duration(clock-updated)}前`:'暂无记录'}</b></div></div>{stale&&<div className="analysis-warning"><AlertCircle size={18}/><div><b>超过 10 分钟没有新进度</b><p>当前请求可能超时或网络已中断。重启客户端后可安全地重新分析。</p></div></div>}{book.status==='failed'&&<div className="analysis-error"><AlertCircle size={18}/><div><b>分析失败</b><p>{book.error}</p></div></div>}<div className="analysis-actions">{book.status==='failed'&&<button className="primary" onClick={onRetry}><BrainCircuit size={17}/>重新分析</button>}<button className="secondary" onClick={onHome}>返回书库{book.status==='analyzing'?'（后台继续）':''}</button></div></div>
}

function ReportView({book,onNew,onReanalyze}:{book:BookSummary;onNew:()=>void;onReanalyze:()=>void}) {
  const report=normalizeReport(book.report as AnalysisReport); const [tab,setTab]=useState<ReportTab>('overview')
  const copyReport=async()=>{await navigator.clipboard.writeText(JSON.stringify(report,null,2));alert('报告 JSON 已复制到剪贴板')}
  return <div className="page report-page"><section className="report-header"><div><div className="eyebrow"><span className="live-dot"/> DEEPSEEK ANALYSIS · {book.model}</div><h1>{book.title}</h1><p>{report.scope||`${book.characterCount.toLocaleString()} 字符分析`} · {new Date(book.updatedAt).toLocaleString()}</p></div><div className="report-actions"><button className="secondary" onClick={()=>void copyReport()}><Copy size={17}/>复制 JSON</button><button className="secondary" onClick={onReanalyze}><BrainCircuit size={17}/>重新分析</button><button className="primary" onClick={onNew}><Plus size={17}/>新建</button></div></section>
    <div className="report-tabs"><Tab id="overview" label="总览" current={tab} set={setTab}/><Tab id="outline" label={`大纲模板 ${outlineVolumeCount(report)}`} current={tab} set={setTab}/><Tab id="plot" label="全书布局" current={tab} set={setTab}/><Tab id="payoff" label={`期待·爽感 ${report.readerExperience?.length||0}`} current={tab} set={setTab}/><Tab id="characters" label={`人物塑造 ${report.characterDesign?.length||report.characters?.length||0}`} current={tab} set={setTab}/><Tab id="foreshadowing" label={`伏笔暗线 ${report.foreshadowing?.length||0}`} current={tab} set={setTab}/><Tab id="scenes" label={`场景 ${report.sceneCraft?.length||0}`} current={tab} set={setTab}/><Tab id="crafts" label={`写作课 ${report.writingLessons?.length||report.crafts?.length||0}`} current={tab} set={setTab}/><Tab id="ideas" label={`原创灵感 ${report.ideas?.length||0}`} current={tab} set={setTab}/></div>
    {tab==='overview'&&<Overview report={report}/>} {tab==='outline'&&<OutlineView report={report}/>} {tab==='plot'&&<ArchitectureView report={report}/>} {tab==='payoff'&&<ReaderExperienceView report={report}/>} {tab==='characters'&&<CharactersView report={report}/>} {tab==='foreshadowing'&&<ForeshadowingView report={report}/>} {tab==='scenes'&&<ScenesView report={report}/>} {tab==='crafts'&&<LessonsView report={report}/>} {tab==='ideas'&&<IdeasView report={report}/>} </div>
}

function Tab({id,label,current,set}:{id:ReportTab;label:string;current:ReportTab;set:(v:ReportTab)=>void}) {return <button className={current===id?'active':''} onClick={()=>set(id)}>{label}</button>}
function Overview({report}:{report:AnalysisReport}) {return <div className="report-grid"><article className="score-card"><div className="card-title"><span><Gauge size={18}/>综合评估</span></div><div className="big-score"><strong>{typeof report.overallScore==='number'?report.overallScore:'—'}</strong><span>/ 100</span></div><div className="metrics">{report.dimensions?.map(d=><div className="metric" key={d.name}><span>{d.name}</span><div><i style={{width:`${Math.max(0,Math.min(100,d.score))}%`}}/></div><b>{d.score}</b></div>)}</div></article><article className="summary-card"><div className="card-title"><span><BrainCircuit size={18}/>核心判断</span><span className="ai-badge">REAL OUTPUT</span></div><h2>{report.coreJudgment||report.oneLine}</h2><p>{report.summary}</p>{report.oneLine&&<div className="quote">{report.oneLine}</div>}</article><EmotionChart points={report.emotion||[]}/><article className="limitations-card"><div className="card-title"><span><AlertCircle size={18}/>分析边界</span></div>{report.limitations?.length?<ul>{report.limitations.map((x,i)=><li key={i}>{x}</li>)}</ul>:<p>模型未返回额外限制说明。</p>}</article></div>}
function EmotionChart({points}:{points:Array<{label:string;value:number}>}) {const safe=Array.isArray(points)?points:[];const path=useMemo(()=>safe.map((p,i)=>`${i?'L':'M'} ${safe.length===1?350:18+i*(664/(safe.length-1))} ${135-Math.max(0,Math.min(100,p.value))}`).join(' '),[safe]); if(!safe.length)return null; return <article className="chart-card"><div className="card-title"><span><BarChart3 size={18}/>情绪张力</span></div><div className="chart-wrap"><svg viewBox="0 0 700 150" preserveAspectRatio="none"><path d={path} fill="none" stroke="#746d64" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg><div className="chart-labels">{safe.map((p,i)=><span key={i}>{p.label}</span>)}</div></div></article>}
function PlotView({report}:{report:AnalysisReport}) {return <div className="detail-stack"><section className="detail-intro"><GitIcon/><div><span>STRUCTURE</span><h2>{report.plot?.structure||'模型未返回结构判断'}</h2></div></section>{report.plot?.stages?.map((s,i)=><article className="detail-row" key={i}><strong>{String(i+1).padStart(2,'0')}</strong><div><h3>{s.name}</h3><p>{s.summary}</p></div><span>{s.tension}</span></article>)}</div>}
function GitIcon(){return <div className="placeholder-icon"><Network size={28}/></div>}
function TeachingBlock({title,data}:{title:string;data?:TeachingSection}) {if(!data)return null;return <article className="teaching-block"><div className="teaching-title"><span>{title}</span><h3>{data.design||'尚未返回'}</h3></div><p><b>怎样执行</b>{Array.isArray(data.execution)?data.execution.join(' → '):''}</p><p><b>原文依据</b>{Array.isArray(data.evidence)?data.evidence.join('；'):''}</p><p><b>读者效果</b>{data.readerEffect}</p><div className="beginner-method"><Lightbulb size={16}/><div><b>新人照着做</b><ol>{Array.isArray(data.beginnerMethod)&&data.beginnerMethod.map((x:string,i:number)=><li key={i}>{x}</li>)}</ol></div></div>{Array.isArray(data.pitfalls)&&data.pitfalls.length>0&&<small>常见误区：{data.pitfalls.join('；')}</small>}</article>}
function fallbackOutline(report:AnalysisReport):NonNullable<AnalysisReport['outline']> {
  const architecture=report.storyArchitecture
  const stages=architecture?.chapterBlueprint?.length?architecture.chapterBlueprint:(report.plot?.stages||[]).map((stage,i)=>({phase:stage.name||`阶段${i+1}`,goal:stage.summary||'',chapters:'未标注',conflict:'从阶段摘要中提炼',turningPoint:'从阶段转折中提炼',readerQuestion:'下一步会怎样'}))
  const volumes=stages.map((stage:any,i:number)=>({name:stage.phase||`第${i+1}卷`,role:stage.goal||'承担阶段推进任务',chapters:stage.chapters||'未标注',mainLine:stage.goal||architecture?.mainLine||report.coreJudgment||'',hiddenLine:(architecture?.hiddenLines?.[i]?.setup||architecture?.hiddenLines?.[i]?.name||'从伏笔暗线页选择一条暗线迁移'),keyPlots:[stage.conflict,stage.turningPoint,stage.readerQuestion].filter(Boolean),climax:stage.turningPoint||'本卷阶段性转折/高潮',endingHook:stage.readerQuestion||'留下下一卷追问',craftFocus:'把该卷拆成“目标—阻力—转折—兑现—新钩子”',newBookPlaceholder:'替换为你的新书人物、设定、矛盾和阶段目标'}))
  const fallbackActs=['第一幕 · 开篇入局','第二幕 · 目标成形','第三幕 · 对抗升级','第四幕 · 汇线爆发','第五幕 · 回收与余波']
  const fiveAct=fallbackActs.map((act,i)=>{const stage=stages[i] as any;const payoff=report.readerExperience?.[i];return {act,purpose:stage?.goal||stage?.summary||'完成该幕的结构推进',keyPlot:stage?.conflict||stage?.phase||'关键剧情待从原书阶段中提炼',climax:stage?.turningPoint||payoff?.payoff||'阶段高潮/转折点',mainLine:architecture?.mainLine||report.plot?.structure||'',hiddenLine:architecture?.hiddenLines?.[i]?.setup||architecture?.hiddenLines?.[i]?.reveal||'安排一条读者暂时看不懂、后续能回收的暗线',readerExpectation:payoff?.expectation||stage?.readerQuestion||'让读者追问下一步',payoff:payoff?.payoff||'阶段性兑现期待',chapters:stage?.chapters||'按你的篇幅重分配',writingTask:'写清本幕目标、阻力、转折、爽点兑现和下一钩子'}})
  const keyPlotBeats=volumes.flatMap(v=>v.keyPlots).filter(Boolean)
  const climaxLadder=volumes.map((v,i)=>`第${i+1}阶：${v.climax}`)
  return {originalBlueprint:{premise:architecture?.premise||report.summary||report.oneLine,fiveAct,volumes,keyPlotBeats,climaxLadder,mainLine:architecture?.mainLine||report.plot?.structure,hiddenLines:(architecture?.hiddenLines||[]).map(x=>`${x.name}：${x.setup} → ${x.reveal} → ${x.effect}`)},reusableTemplate:{title:'新书分卷五幕式大纲模板副本',premise:'把你的新书简介填在这里：主角是谁、想要什么、最大阻力是什么、失败代价是什么、核心爽点是什么。',fiveAct:fiveAct.map(x=>({act:x.act,task:x.writingTask,mustHave:[x.purpose,x.readerExpectation,x.payoff].filter(Boolean),avoid:'只借结构功能，不复制原作人物、专名、设定和核心事件'})),volumes:volumes.map(v=>({...v,name:v.name.replace(/第?\d+卷|VOL\s*\d+/i,'新书卷名'),keyPlots:v.keyPlots.map(x=>`替换剧情功能：${x}`)})),characterTracks:(report.characterDesign||report.characters||[]).slice(0,6).map((c:any)=>({name:c.role||c.name||'人物功能位',function:c.core||c.role||'承担结构功能',entrance:c.entrance||'用动作/选择/反差出场',growth:c.development||c.arc||'通过选择和代价成长',turn:c.fear||c.conflict||'设计一次价值观转折',exit:c.exit||'阶段性收束或转入下一阶段',reusableSlot:'填入你的原创人物设定'})),threadMap:[{thread:'主线',type:'主线',setup:'开篇给目标和代价',development:'每卷升级阻力',payoff:'高潮处兑现核心矛盾',reusableQuestion:'你的主角最终必须解决什么问题？'},...(architecture?.secondaryLines||[]).slice(0,2).map(x=>({thread:x.name,type:'辅线',setup:x.purpose,development:x.intersections?.join(' → ')||'与主线多次交汇',payoff:'在高潮或结尾服务主线',reusableQuestion:'这条辅线如何改变主角或主题？'})),...(architecture?.hiddenLines||[]).slice(0,2).map(x=>({thread:x.name,type:'暗线',setup:x.setup,development:x.reveal,payoff:x.effect,reusableQuestion:'这条暗线前期如何伪装，后期如何让读者恍然大悟？'}))],keyPlotBeats,climaxLadder,expectationPayoffRules:(report.readerExperience||[]).slice(0,8).map(x=>`${x.phase}：立期待「${x.expectation}」→ 延迟「${x.delay}」→ 加码「${x.escalation}」→ 兑现「${x.payoff}」`),fillInPrompt:'请根据我提供的新书简介，沿用这个模板的结构功能，生成原创分卷五幕式大纲。要求包含：每卷主线、暗线、关键剧情、高潮点、卷尾钩子、人物出场成长退场、期待感与爽感设计。禁止复制原作人物、专名、设定和核心事件。'}}
}
function outlineTemplateText(report:AnalysisReport) {
  const t=(report.outline||fallbackOutline(report)).reusableTemplate
  if(!t)return ''
  return `# ${t.title||'新书大纲模板副本'}\n\n## 新书简介\n${t.premise||'在这里填入你的新书简介、题材、主角、核心卖点和禁忌。'}\n\n## 五幕式\n${(t.fiveAct||[]).map((x,i)=>`${i+1}. ${x.act}\n- 阶段任务：${x.task}\n- 必须包含：${(x.mustHave||[]).join('；')}\n- 避免：${x.avoid}`).join('\n\n')}\n\n## 分卷卷纲\n${(t.volumes||[]).map((v,i)=>`### 第${i+1}卷：${v.name}\n- 结构作用：${v.role}\n- 章节范围：${v.chapters}\n- 主线推进：${v.mainLine}\n- 暗线埋设/揭示：${v.hiddenLine}\n- 关键剧情：${(v.keyPlots||[]).join('；')}\n- 高潮点：${v.climax}\n- 卷尾钩子：${v.endingHook}\n- 本卷写作训练：${v.craftFocus}\n- 新书替换槽：${v.newBookPlaceholder}`).join('\n\n')}\n\n## 人物轨道\n${(t.characterTracks||[]).map(x=>`- ${x.name}：${x.function}｜出场：${x.entrance}｜成长：${x.growth}｜转折：${x.turn}｜阶段退场：${x.exit}｜替换槽：${x.reusableSlot}`).join('\n')}\n\n## 主线/辅线/暗线\n${(t.threadMap||[]).map(x=>`- ${x.thread}（${x.type}）：埋设=${x.setup}；发展=${x.development}；回收=${x.payoff}；新书提问=${x.reusableQuestion}`).join('\n')}\n\n## 关键剧情\n${(t.keyPlotBeats||[]).map(x=>`- ${x}`).join('\n')}\n\n## 高潮阶梯\n${(t.climaxLadder||[]).map(x=>`- ${x}`).join('\n')}\n\n## 期待感/爽感规则\n${(t.expectationPayoffRules||[]).map(x=>`- ${x}`).join('\n')}\n\n## 给 AI 生成新大纲的提示词\n${t.fillInPrompt||'请根据我的新书简介，沿用这个模板的结构功能，但不要复制原作人物、设定、专名和核心事件，生成新的分卷五幕式大纲。'}`
}
function OutlineView({report}:{report:AnalysisReport}) {const outline=report.outline||fallbackOutline(report);const original=outline?.originalBlueprint;const template=outline?.reusableTemplate;const synthetic=!report.outline;const copyOriginal=async()=>{await navigator.clipboard.writeText(JSON.stringify(original,null,2));alert('原书大纲 JSON 已复制')};const copyTemplate=async()=>{await navigator.clipboard.writeText(outlineTemplateText(report));alert('新书大纲模板副本已复制')};if(!original&&!template)return <div className="empty-library"><div className="empty-icon"><FileText size={30}/></div><h3>当前报告还没有可生成大纲的数据</h3><p>点“重新分析”后，会生成分卷、五幕式、关键剧情、高潮阶梯、主线和暗线，并附带可复制的新书模板。</p></div>;return <div className="teaching-stack outline-view"><section className="architecture-summary outline-hero"><div><span>{synthetic?'COMPATIBLE OUTLINE':'REUSABLE OUTLINE'}</span><h2>{template?.title||'拆书大纲与新书模板'}</h2><p>{synthetic?'这是根据当前旧报告里的全书布局、阶段施工图、人物线与期待爽感即时整理出的兼容大纲；重新分析后会得到更精确的专用大纲模块。':original?.premise||template?.premise}</p></div><div className="outline-actions"><button className="secondary" disabled={!original} onClick={()=>void copyOriginal()}><Copy size={16}/>复制原书大纲</button><button className="primary" disabled={!template} onClick={()=>void copyTemplate()}><Copy size={16}/>复制新书模板副本</button></div></section>{original?.fiveAct?.length&&<section className="outline-section"><header><b>五幕式结构</b><span>每一幕都对应“作者要完成的叙事任务”</span></header>{original.fiveAct.map((x,i)=><article className="outline-act" key={i}><strong>{String(i+1).padStart(2,'0')}</strong><div><span>{x.act} · {x.chapters}</span><h3>{x.purpose}</h3><p>{x.keyPlot}</p><small>主线：{x.mainLine}　暗线：{x.hiddenLine}</small><small>高潮/兑现：{x.climax}　期待：{x.readerExpectation}　爽点：{x.payoff}</small><em>写作任务：{x.writingTask}</em></div></article>)}</section>}{original?.volumes?.length&&<section className="outline-section"><header><b>分卷卷纲</b><span>每卷都要有主线推进、暗线变化和卷内高潮</span></header><div className="outline-volume-grid">{original.volumes.map((v,i)=><article className="outline-volume" key={i}><span>VOL {String(i+1).padStart(2,'0')} · {v.chapters}</span><h3>{v.name}</h3><p>{v.role}</p><dl><dt>主线</dt><dd>{v.mainLine}</dd><dt>暗线</dt><dd>{v.hiddenLine}</dd><dt>关键剧情</dt><dd>{v.keyPlots?.join('；')}</dd><dt>高潮点</dt><dd>{v.climax}</dd><dt>卷尾钩子</dt><dd>{v.endingHook}</dd><dt>迁移训练</dt><dd>{v.craftFocus}</dd></dl></article>)}</div></section>}<div className="thread-grid"><article><b>关键剧情骨架</b>{original?.keyPlotBeats?.map((x,i)=><div key={i}><h4>{String(i+1).padStart(2,'0')}</h4><p>{x}</p></div>)}</article><article><b>高潮阶梯</b>{original?.climaxLadder?.map((x,i)=><div key={i}><h4>{String(i+1).padStart(2,'0')}</h4><p>{x}</p></div>)}</article></div>{template&&<section className="outline-section"><header><b>新书模板预览</b><span>复制后可填入你自己的简介，让 AI 生成全新的大纲</span></header><pre className="outline-template">{outlineTemplateText(report)}</pre></section>}</div>}
function ArchitectureView({report}:{report:AnalysisReport}) {const a=report.storyArchitecture;if(!a)return <PlotView report={report}/>;return <div className="teaching-stack"><section className="architecture-summary"><div><span>MAIN LINE</span><h2>{a.mainLine}</h2><p>{a.premise}</p></div></section><div className="thread-grid"><article><b>辅线如何服务主线</b>{a.secondaryLines?.map((line,i)=><div key={i}><h4>{line.name}</h4><p>{line.purpose}</p><small>交汇点：{line.intersections?.join(' → ')}</small></div>)}</article><article><b>暗线如何埋藏与揭示</b>{a.hiddenLines?.map((line,i)=><div key={i}><h4>{line.name}</h4><p>{line.setup}</p><small>{line.reveal} · {line.effect}</small></div>)}</article></div><div className="teaching-grid"><TeachingBlock title="01 · 开篇" data={a.opening}/><TeachingBlock title="02 · 铺垫与推进" data={a.progression}/><TeachingBlock title="03 · 高潮" data={a.climax}/><TeachingBlock title="04 · 结尾" data={a.ending}/></div><section className="blueprint"><header><b>全书阶段施工图</b><span>从作者意图反推每阶段任务</span></header>{a.chapterBlueprint?.map((item,i)=><article key={i}><strong>{String(i+1).padStart(2,'0')}</strong><div><h4>{item.phase} · {item.chapters}</h4><p>{item.goal}</p><small>冲突：{item.conflict}　转折：{item.turningPoint}　读者追问：{item.readerQuestion}</small></div></article>)}</section></div>}
function ReaderExperienceView({report}:{report:AnalysisReport}) {const items=report.readerExperience||[];return <div className="teaching-stack">{items.length?<><section className="architecture-summary"><span>READER EXPERIENCE</span><h2>期待不是悬念一句话，爽感也不是突然开挂</h2><p>看清作者如何先让读者渴望一个结果，再通过延迟与加码提高价值，最后兑现并留下下一个钩子。</p></section>{items.map((x,i)=><article className="payoff-lesson" key={i}><header><strong>{String(i+1).padStart(2,'0')}</strong><div><span>{x.phase} · {x.payoffType}</span><h3>{x.expectation}</h3></div><b>{Math.max(0,Math.min(100,x.intensity||0))}</b></header><div className="payoff-chain"><div><span>立期待</span><p>{x.expectation}</p></div><i>→</i><div><span>压着不给</span><p>{x.delay}</p></div><i>→</i><div><span>加码</span><p>{x.escalation}</p></div><i>→</i><div><span>爽点兑现</span><p>{x.payoff}</p></div></div><p className="evidence-line"><b>原文依据</b>{x.evidence}</p><div className="next-hook"><b>兑现后如何继续拉追读</b><p>{x.nextHook}</p></div><div className="beginner-method"><Lightbulb size={16}/><div><b>新人可复用的步骤</b><ol>{x.method?.map((step,j)=><li key={j}>{step}</li>)}</ol></div></div><p className="pitfall"><b>容易写崩</b>{x.pitfall}</p></article>)}</>:<div className="empty-library">当前旧报告没有“期待·爽感”工程数据，重新进行教学型拆书后生成。</div>}</div>}
function CharactersView({report}:{report:AnalysisReport}) {if(report.characterDesign?.length)return <div className="teaching-stack">{report.characterDesign.map((c,i)=><article className="character-lesson" key={i}><header><span>{c.name?.slice(0,1)||'?'}</span><div><h3>{c.name}</h3><small>{c.role} · {c.core}</small></div></header><div className="character-map"><p><b>欲望</b>{c.desire}</p><p><b>恐惧/缺口</b>{c.fear}</p><p><b>如何出场</b>{c.entrance}</p><p><b>如何成长</b>{c.development}</p><p><b>关系推动</b>{c.relationships}</p><p><b>如何退场/阶段收束</b>{c.exit}</p></div><p className="evidence-line"><b>塑造证据</b>{c.evidence}</p><div className="technique-tags">{c.techniques?.map((x,j)=><span key={j}>{x}</span>)}</div><div className="beginner-method"><Lightbulb size={16}/><div><b>练习</b><p>{c.exercise}</p></div></div></article>)}</div>;return <div className="insight-grid">{report.characters?.map((c,i)=><article className="insight-card" key={i}><div className="insight-card-head"><span>{c.name?.slice(0,1)||'?'}</span><div><h3>{c.name}</h3><small>{c.role}</small></div></div><dl><dt>欲望</dt><dd>{c.desire}</dd><dt>弧光</dt><dd>{c.arc}</dd><dt>关系</dt><dd>{Array.isArray(c.relationships)?c.relationships.join(' · '):String(c.relationships||'')}</dd></dl></article>)}</div>}
function ForeshadowingView({report}:{report:AnalysisReport}) {return <div className="teaching-stack">{report.foreshadowing?.length?report.foreshadowing.map((item,i)=><article className="foreshadow-row" key={i}><strong>{String(i+1).padStart(2,'0')}</strong><div><span>埋设</span><h3>{item.setup}</h3><p><b>回收</b>{item.payoff}</p><p><b>作用</b>{item.effect}</p></div></article>):<div className="empty-library">当前旧报告没有结构化伏笔数据，重新进行“教学型拆书”后生成。</div>}</div>}
function ScenesView({report}:{report:AnalysisReport}) {return <div className="teaching-stack">{report.sceneCraft?.length?report.sceneCraft.map((s,i)=><article className="scene-lesson" key={i}><div className="eyebrow">SCENE {String(i+1).padStart(2,'0')}</div><h3>{s.scene}</h3><div className="scene-grid"><p><b>场景任务</b>{s.purpose}</p><p><b>如何进入</b>{s.entry}</p><p><b>感官与氛围</b>{s.sensory}</p><p><b>场内冲突</b>{s.conflict}</p><p><b>如何转场</b>{s.transition}</p><p><b>原文依据</b>{s.evidence}</p></div><div className="beginner-method"><Lightbulb size={16}/><div><b>迁移到你的小说</b><p>{s.transfer}</p></div></div></article>):<div className="empty-library">当前旧报告没有场景拆解，重新分析后生成。</div>}</div>}
function LessonsView({report}:{report:AnalysisReport}) {if(report.writingLessons?.length)return <div className="teaching-stack">{report.writingLessons.map((lesson,i)=><article className="writing-lesson" key={i}><header><strong>{String(i+1).padStart(2,'0')}</strong><div><span>WRITING LESSON</span><h3>{lesson.topic}</h3></div></header><h4>{lesson.principle}</h4><p><b>原文怎样做</b>{lesson.evidence}</p><div className="lesson-steps"><b>可执行步骤</b><ol>{lesson.steps?.map((step,j)=><li key={j}>{step}</li>)}</ol></div><p className="pitfall"><b>别这样写</b>{lesson.pitfall}</p><div className="beginner-method"><Lightbulb size={16}/><div><b>马上练习</b><p>{lesson.exercise}</p></div></div></article>)}</div>;return <CraftsView report={report}/>}
function CraftsView({report}:{report:AnalysisReport}) {return <div className="detail-stack">{report.crafts?.map((c,i)=><article className="method-card" key={i}><span>{String(i+1).padStart(2,'0')}</span><div><h3>{c.title}</h3><p><b>原文证据</b>{c.evidence}</p><p><b>手法原理</b>{c.method}</p><div className="transfer"><Lightbulb size={16}/><span>{c.transfer}</span></div></div></article>)}</div>}
function IdeasView({report}:{report:AnalysisReport}) {return <div className="insight-grid">{report.ideas?.map((idea,i)=><article className="idea-card" key={i}><div className="eyebrow">ORIGINAL IDEA {String(i+1).padStart(2,'0')}</div><h3>{idea.title}</h3><p>{idea.premise}</p><div><b>原创差异</b>{idea.difference}</div><small><AlertCircle size={13}/>{idea.risk}</small></article>)}</div>}

function SettingsModal({value,onClose,onSave}:{value:ModelConfig;onClose:()=>void;onSave:(v:ModelConfig)=>void}) {const [form,setForm]=useState(value);const [testing,setTesting]=useState(false);const [status,setStatus]=useState('');const test=async()=>{setTesting(true);setStatus('');try{setStatus(await testModel(form)?'连接成功':'模型未返回预期结果')}catch(e){setStatus(errorText(e))}finally{setTesting(false)}};return <div className="modal-backdrop"><section className="modal"><header><div><span>MODEL SETTINGS</span><h2>DeepSeek 设置</h2></div><button className="icon-button" onClick={onClose}><X size={19}/></button></header><div className="modal-body"><label>API Key<input type="password" value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})} placeholder="sk-..."/></label><p className="field-note"><KeyRound size={13}/>密钥仅保存在当前设备的 WebView localStorage，不写入任何书籍 SQLite。</p><label>模型<select value={form.model} onChange={e=>setForm({...form,model:e.target.value as ModelConfig['model']})}><option value="deepseek-v4-flash">DeepSeek V4 Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label><label>Base URL<input value={form.baseUrl} onChange={e=>setForm({...form,baseUrl:e.target.value})}/></label>{status&&<div className={`test-status ${status==='连接成功'?'success':''}`}>{status}</div>}</div><footer><button className="secondary" disabled={!form.apiKey||testing} onClick={()=>void test()}>{testing?<LoaderCircle size={16} className="spin"/>:<Zap size={16}/>} 测试连接</button><button className="primary" disabled={!form.apiKey} onClick={()=>onSave(form)}><Check size={16}/>保存设置</button></footer></section></div>}

function SearchModal({onClose,onSearch,books,onOpen}:{onClose:()=>void;onSearch:(q:string)=>Promise<void>;books:BookSummary[];onOpen:(b:BookSummary)=>void}) {const [query,setQuery]=useState('');useEffect(()=>{if(!isTauri())return;const t=setTimeout(()=>void onSearch(query),200);return()=>clearTimeout(t)},[query,onSearch]);return <div className="modal-backdrop search-backdrop"><section className="search-modal"><div className="search-input"><Search size={20}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索书名、人物、手法或灵感……"/><button className="icon-button" onClick={onClose}><X size={18}/></button></div><div className="search-results">{books.map(book=><button key={book.id} onClick={()=>onOpen(book)}><div className="mini-book">{book.title.slice(0,1)}</div><div><b>{book.title}</b><span>{book.report?.coreJudgment||book.stage}</span></div><StatusBadge status={book.status}/></button>)}{!books.length&&<div className="search-empty">没有找到真实书籍数据</div>}</div></section></div>}

export default App
