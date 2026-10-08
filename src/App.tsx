import { AnalysisPreparationDialog } from "./components/AnalysisPreparationDialog";
import { ReadingCoverage } from "./components/ReadingCoverage";
import { formatWordCount } from "./lib/word-count";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AlertCircle,
  BarChart3,
  BrainCircuit,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  FileText,
  Gauge,
  Lightbulb,
  LoaderCircle,
  Network,
  Plus,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { toast } from "sonner";
import { HomeView } from "./HomeView";
import { IdeasView } from "./IdeasView";
import { ImportView } from "./ImportView";
import { ReaderView } from "./ReaderView";
import { SearchModal } from "./SearchModal";
import { SettingsModal } from "./SettingsModal";
import { AppSidebar } from "./components/AppSidebar";
import {
  deleteBook,
  getBook,
  isTauri,
  listBooks,
  startAnalysis,
} from "./lib/tauri";
import type {
  AnalysisReport,
  BookSummary,
  ModelConfig,
  TeachingSection,
} from "./types";

type View = "home" | "import" | "reader" | "analyzing" | "report";
type ReportTab =
  | "overview"
  | "outline"
  | "plot"
  | "payoff"
  | "characters"
  | "foreshadowing"
  | "scenes"
  | "crafts"
  | "ideas";

const defaultConfig: ModelConfig = {
  apiKey: "",
  model: "deepseek-v4-flash",
  baseUrl: "https://api.deepseek.com",
};

function readConfig(): ModelConfig {
  try {
    return {
      ...defaultConfig,
      ...JSON.parse(localStorage.getItem("inkscope-model") || "{}"),
    };
  } catch {
    return defaultConfig;
  }
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "发生未知错误";
}

function score100(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = value > 0 && value <= 10 ? value * 10 : value;
  return Math.round(Math.max(0, Math.min(100, normalized)) * 10) / 10;
}

function outlineVolumeCount(report: AnalysisReport) {
  return (
    report.outline?.originalBlueprint?.volumes?.length ||
    report.storyArchitecture?.chapterBlueprint?.length ||
    report.plot?.stages?.length ||
    0
  );
}

function normalizeReport(input: AnalysisReport): AnalysisReport {
  const value = (
    input && typeof input === "object" ? input : {}
  ) as AnalysisReport;
  const array = <T,>(candidate: unknown): T[] =>
    Array.isArray(candidate)
      ? (candidate as T[])
      : candidate && typeof candidate === "object"
        ? [candidate as T]
        : [];
  return {
    ...value,
    overallScore: score100(value.overallScore),
    dimensions: array(value.dimensions).map((item: any) => ({
      ...item,
      score: score100(item.score) ?? 0,
    })),
    characters: array(value.characters),
    crafts: array(value.crafts),
    foreshadowing: array(value.foreshadowing),
    ideas: array(value.ideas),
    limitations: array(value.limitations),
    emotion: array(value.emotion).map((item: any) => ({
      ...item,
      value: score100(item.value) ?? 0,
    })),
    plot: { ...(value.plot || {}), stages: array(value.plot?.stages) },
    characterDesign: array(value.characterDesign),
    sceneCraft: array(value.sceneCraft),
    readerExperience: array(value.readerExperience),
    writingLessons: array(value.writingLessons),
    storyArchitecture: value.storyArchitecture
      ? {
          ...value.storyArchitecture,
          secondaryLines: array(value.storyArchitecture.secondaryLines),
          hiddenLines: array(value.storyArchitecture.hiddenLines),
          chapterBlueprint: array(value.storyArchitecture.chapterBlueprint),
        }
      : undefined,
    outline: value.outline
      ? {
          ...value.outline,
          originalBlueprint: value.outline.originalBlueprint
            ? {
                ...value.outline.originalBlueprint,
                fiveAct: array(value.outline.originalBlueprint.fiveAct),
                volumes: array(value.outline.originalBlueprint.volumes),
                keyPlotBeats: array(
                  value.outline.originalBlueprint.keyPlotBeats,
                ),
                climaxLadder: array(
                  value.outline.originalBlueprint.climaxLadder,
                ),
                hiddenLines: array(value.outline.originalBlueprint.hiddenLines),
              }
            : undefined,
          reusableTemplate: value.outline.reusableTemplate
            ? {
                ...value.outline.reusableTemplate,
                fiveAct: array(value.outline.reusableTemplate.fiveAct),
                volumes: array(value.outline.reusableTemplate.volumes),
                characterTracks: array(
                  value.outline.reusableTemplate.characterTracks,
                ),
                threadMap: array(value.outline.reusableTemplate.threadMap),
                keyPlotBeats: array(
                  value.outline.reusableTemplate.keyPlotBeats,
                ),
                climaxLadder: array(
                  value.outline.reusableTemplate.climaxLadder,
                ),
                expectationPayoffRules: array(
                  value.outline.reusableTemplate.expectationPayoffRules,
                ),
              }
            : undefined,
        }
      : undefined,
  };
}

function App() {
  const [view, setView] = useState<View>("home");
  const [readingMode, setReadingMode] = useState(false);
  const [phoneMode, setPhoneMode] = useState(false);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [selected, setSelected] = useState<BookSummary | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [config, setConfig] = useState<ModelConfig>(readConfig);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshBooks = useCallback(async (query = "") => {
    try {
      setBooks(await listBooks(query));
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isTauri()) void refreshBooks();
    else setLoading(false);
  }, [refreshBooks]);

  useEffect(() => {
    if (!selected || selected.status !== "analyzing") return;
    const timer = window.setInterval(async () => {
      try {
        const current = await getBook(selected.id);
        setSelected(current);
        setBooks((items) =>
          items.map((item) => (item.id === current.id ? current : item)),
        );
        if (current.status === "completed") setView("report");
      } catch (e) {
        setError(errorText(e));
      }
    }, 1400);
    return () => window.clearInterval(timer);
  }, [selected]);

  const openBook = async (book: BookSummary) => {
    try {
      const current = await getBook(book.id);
      setSelected(current);
      setView(
        current.status === "analyzing" || current.status === "failed"
          ? "analyzing"
          : current.report
            ? "report"
            : "import",
      );
    } catch (e) {
      setError(errorText(e));
    }
  };

  const [analysisTarget, setAnalysisTarget] = useState<BookSummary | null>(
    null,
  );
  const runBook = async (book: BookSummary) => {
    if (!config.apiKey.trim()) {
      setSelected(book);
      setSettingsOpen(true);
      return;
    }
    setAnalysisTarget(book);
  };
  const startPreparedBook = async (
    book: BookSummary,
    allowPartial: boolean,
  ) => {
    await startAnalysis(book.id, config, allowPartial);
    const current = await getBook(book.id);
    setSelected(current);
    setView("analyzing");
    await refreshBooks();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (document.querySelector('[role="dialog"], [role="alertdialog"]'))
          return;
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const saveConfig = (next: ModelConfig) => {
    try {
      localStorage.setItem("inkscope-model", JSON.stringify(next));
      setConfig(next);
      setSettingsOpen(false);
      toast.success("模型设置已保存");
    } catch {
      toast.error("无法保存设置，请检查本机存储空间。");
    }
  };

  const newBook = () => {
    setReadingMode(false);
    setSelected(null);
    setView("import");
  };
  const readBook = async (book: BookSummary) => {
    try {
      setReadingMode(false);
      const current = await getBook(book.id);
      setSelected(current);
      setView("reader");
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <TooltipProvider>
      <SidebarProvider
        style={{ "--sidebar-width": "13.5rem" } as CSSProperties}
      >
        {!(view === "reader" && (readingMode || phoneMode)) && (
          <AppSidebar
            view={view}
            books={books}
            selected={selected}
            onHome={() => setView("home")}
            onNew={newBook}
            onOpen={readBook}
            onSettings={() => setSettingsOpen(true)}
            onSearch={() => setSearchOpen(true)}
          />
        )}
        <SidebarInset
          className={`main${view === "reader" && (readingMode || phoneMode) ? " main--reader-focus" : ""}`}
        >
          {!(view === "reader" && (readingMode || phoneMode)) && (
            <header className="topbar">
              <div className="topbar-leading">
                <SidebarTrigger aria-label="展开或收起导航" />
                <Separator orientation="vertical" className="h-4" />
                <div className="crumb">
                  <span>工作空间</span>
                  <ChevronRight size={14} />
                  <b>
                    {view === "home"
                      ? "我的书架"
                      : view === "import"
                        ? "添加书籍"
                        : view === "reader"
                          ? "阅读"
                          : view === "analyzing"
                            ? "分析进度"
                            : "拆书报告"}
                  </b>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSettingsOpen(true)}
              >
                <span
                  className={
                    config.apiKey ? "status-dot completed" : "status-dot"
                  }
                />
                {config.apiKey
                  ? config.model.replace("deepseek-", "")
                  : "配置模型"}
              </Button>
            </header>
          )}
          {!isTauri() && (
            <Alert className="runtime-banner">
              <AlertCircle />
              <AlertDescription>
                浏览器预览 · 阅读本地书库与使用分析功能，请打开 InkScope
                桌面客户端。
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive" className="runtime-banner">
              <AlertCircle />
              <AlertDescription>
                {error}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="关闭错误提示"
                  onClick={() => setError("")}
                >
                  <X />
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {view === "home" && (
            <HomeView
              books={books}
              loading={loading}
              onNew={newBook}
              onRead={readBook}
              onAnalyze={runBook}
              onReport={openBook}
              onDelete={async (id) => {
                if (selected?.id === id) setSelected(null);
                await deleteBook(id);
                await refreshBooks();
              }}
            />
          )}
          {view === "import" && (
            <ImportView
              selected={selected?.status === "ready" ? selected : null}
              modelReady={!!config.apiKey}
              onSettings={() => setSettingsOpen(true)}
              onCreated={async (book) => {
                setSelected(book);
                await refreshBooks();
                setView("reader");
              }}
              onRun={runBook}
            />
          )}
          {view === "reader" && selected && (
            <ReaderView
              key={selected.id}
              book={selected}
              onAnalyze={() => void runBook(selected)}
              onReport={() => setView("report")}
              onProgress={refreshBooks}
              focusMode={readingMode}
              onFocusChange={setReadingMode}
              onPhoneModeChange={setPhoneMode}
            />
          )}
          {view === "analyzing" && selected && (
            <AnalyzingView
              book={selected}
              onHome={() => setView("home")}
              onRetry={() => void runBook(selected)}
            />
          )}
          {view === "report" && selected?.report && (
            <ReportView
              key={selected.id}
              book={selected}
              onNew={newBook}
              onReanalyze={() => void runBook(selected)}
            />
          )}
        </SidebarInset>
        {analysisTarget && (
          <AnalysisPreparationDialog
            book={analysisTarget}
            onClose={() => setAnalysisTarget(null)}
            onStart={startPreparedBook}
            onUpdated={async (book) => {
              setSelected(book);
              await refreshBooks();
            }}
          />
        )}
        {settingsOpen && (
          <SettingsModal
            value={config}
            onClose={() => setSettingsOpen(false)}
            onSave={saveConfig}
          />
        )}
        {searchOpen && (
          <SearchModal
            onClose={() => setSearchOpen(false)}
            books={books}
            onOpen={(book) => {
              setSearchOpen(false);
              void openBook(book);
            }}
          />
        )}
        <Toaster theme="light" position="bottom-right" richColors />
      </SidebarProvider>
    </TooltipProvider>
  );
}

function AnalyzingView({
  book,
  onHome,
  onRetry,
}: {
  book: BookSummary;
  onHome: () => void;
  onRetry: () => void;
}) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const progress = book.total
    ? Math.round((book.completed / book.total) * 100)
    : 0;
  const started = book.jobStartedAt ? new Date(book.jobStartedAt).getTime() : 0;
  const updated = book.jobUpdatedAt ? new Date(book.jobUpdatedAt).getTime() : 0;
  const elapsed = started ? Math.max(0, clock - started) : 0;
  const stale =
    book.status === "analyzing" &&
    updated > 0 &&
    clock - updated > 10 * 60 * 1000;
  const duration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h ? `${h}时 ${m}分` : `${m}分 ${String(s).padStart(2, "0")}秒`;
  };
  return (
    <div className="page analyzing-page">
      <div className="analysis-visual">
        {book.status === "analyzing" ? (
          <LoaderCircle className="spin" size={48} />
        ) : (
          <AlertCircle size={48} />
        )}
        <span>{progress}%</span>
      </div>
      <div className="eyebrow">
        <Database size={14} /> 分析进度
      </div>
      <h1>
        {book.status === "failed" ? "分析已中断" : `正在分析《${book.title}》`}
      </h1>
      <p>{book.stage}</p>
      <Progress value={progress} aria-label="分析进度" className="my-6" />
      <div className="job-facts">
        <span>
          <b>{book.completed}</b> / {book.total} 个步骤
        </span>
        <span>{formatWordCount(book.characterCount)}</span>
      </div>
      <div className="job-timing">
        <div>
          <Clock3 size={16} />
          <span>已运行</span>
          <b>{started ? duration(elapsed) : "尚未开始"}</b>
        </div>
        <div>
          <Zap size={16} />
          <span>最后更新</span>
          <b>{updated ? `${duration(clock - updated)}前` : "暂无记录"}</b>
        </div>
      </div>
      {stale && (
        <Alert className="mt-4 text-left">
          <AlertCircle />
          <AlertDescription>
            超过 10
            分钟没有新进度。当前请求可能超时或网络已中断，重启客户端后可重新分析。
          </AlertDescription>
        </Alert>
      )}
      {book.status === "failed" && (
        <Alert variant="destructive" className="mt-4 text-left">
          <AlertCircle />
          <AlertDescription>
            {book.error || "分析中断，请重试。"}
          </AlertDescription>
        </Alert>
      )}
      <div className="analysis-actions">
        {book.status === "failed" && (
          <Button onClick={onRetry}>
            <BrainCircuit size={17} />
            重新分析
          </Button>
        )}
        <Button variant="outline" onClick={onHome}>
          返回书库{book.status === "analyzing" ? "（后台继续）" : ""}
        </Button>
      </div>
    </div>
  );
}

function ReportView({
  book,
  onNew,
  onReanalyze,
}: {
  book: BookSummary;
  onNew: () => void;
  onReanalyze: () => void;
}) {
  const report = normalizeReport(book.report as AnalysisReport);
  const [tab, setTab] = useState<ReportTab>("overview");
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      toast.success("报告 JSON 已复制");
    } catch {
      toast.error("复制失败，请检查剪贴板权限。");
    }
  };
  return (
    <div className="page report-page">
      <section className="report-header">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> 拆书报告 · {book.model}
          </div>
          <h1>{book.title}</h1>
          <p>
            {report.scope || `${formatWordCount(book.characterCount)}分析`} ·{" "}
            {new Date(book.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="report-actions">
          <Button variant="outline" onClick={() => void copyReport()}>
            <Copy size={17} />
            复制 JSON
          </Button>
          <Button variant="outline" onClick={onReanalyze}>
            <BrainCircuit size={17} />
            重新分析
          </Button>
          <Button onClick={onNew}>
            <Plus size={17} />
            新建
          </Button>
        </div>
      </section>
      <ReadingCoverage
        key={book.id + book.updatedAt}
        coverage={report.coverage}
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value as ReportTab)}>
        <div className="report-tabs">
          <TabsList variant="line" aria-label="拆书报告章节">
            <TabsTrigger value="overview">总览</TabsTrigger>
            <TabsTrigger value="outline">
              大纲模板 {outlineVolumeCount(report)}
            </TabsTrigger>
            <TabsTrigger value="plot">全书布局</TabsTrigger>
            <TabsTrigger value="payoff">
              期待·爽感 {report.readerExperience?.length || 0}
            </TabsTrigger>
            <TabsTrigger value="characters">
              人物塑造{" "}
              {report.characterDesign?.length || report.characters?.length || 0}
            </TabsTrigger>
            <TabsTrigger value="foreshadowing">
              伏笔暗线 {report.foreshadowing?.length || 0}
            </TabsTrigger>
            <TabsTrigger value="scenes">
              场景 {report.sceneCraft?.length || 0}
            </TabsTrigger>
            <TabsTrigger value="crafts">
              写作课{" "}
              {report.writingLessons?.length || report.crafts?.length || 0}
            </TabsTrigger>
            <TabsTrigger value="ideas">
              原创灵感 {report.ideas?.length || 0}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview">
          <Overview report={report} />
        </TabsContent>
        <TabsContent value="outline">
          <OutlineView report={report} />
        </TabsContent>
        <TabsContent value="plot">
          <ArchitectureView report={report} />
        </TabsContent>
        <TabsContent value="payoff">
          <ReaderExperienceView report={report} />
        </TabsContent>
        <TabsContent value="characters">
          <CharactersView report={report} />
        </TabsContent>
        <TabsContent value="foreshadowing">
          <ForeshadowingView report={report} />
        </TabsContent>
        <TabsContent value="scenes">
          <ScenesView report={report} />
        </TabsContent>
        <TabsContent value="crafts">
          <LessonsView report={report} />
        </TabsContent>
        <TabsContent value="ideas">
          <IdeasView report={report} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Overview({ report }: { report: AnalysisReport }) {
  return (
    <div className="report-grid">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge size={16} />
            综合评估
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="big-score">
            <strong>
              {typeof report.overallScore === "number"
                ? report.overallScore
                : "—"}
            </strong>
            <span>/ 100</span>
          </div>
          <div className="metrics">
            {report.dimensions?.map((d) => (
              <div className="metric" key={d.name}>
                <span>{d.name}</span>
                <Progress
                  value={Math.max(0, Math.min(100, d.score))}
                  aria-label={d.name}
                />
                <b>{d.score}</b>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit size={16} />
            核心判断
          </CardTitle>
        </CardHeader>
        <CardContent className="summary-card">
          <h2>{report.coreJudgment || report.oneLine}</h2>
          <p>{report.summary}</p>
          {report.oneLine && <div className="quote">{report.oneLine}</div>}
        </CardContent>
      </Card>
      <EmotionChart points={report.emotion || []} />
      <Card className="limitations-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle size={16} />
            分析边界
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.limitations?.length ? (
            <ul>
              {report.limitations.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>模型未返回额外限制说明。</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function EmotionChart({
  points,
}: {
  points: Array<{ label: string; value: number }>;
}) {
  const safe = Array.isArray(points) ? points : [];
  const path = useMemo(
    () =>
      safe
        .map(
          (point, i) =>
            `${i ? "L" : "M"} ${safe.length === 1 ? 350 : 18 + i * (664 / (safe.length - 1))} ${135 - Math.max(0, Math.min(100, point.value))}`,
        )
        .join(" "),
    [safe],
  );
  if (!safe.length) return null;
  return (
    <Card className="chart-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 size={16} />
          情绪张力
        </CardTitle>
      </CardHeader>
      <CardContent className="chart-wrap">
        <svg
          role="img"
          aria-label="全书情绪张力曲线"
          viewBox="0 0 700 150"
          preserveAspectRatio="none"
        >
          <path
            d={path}
            fill="none"
            stroke="var(--chart-3)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="chart-labels">
          {safe.map((point, i) => (
            <span key={i}>{point.label}</span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
function PlotView({ report }: { report: AnalysisReport }) {
  return (
    <div className="detail-stack">
      <section className="detail-intro">
        <GitIcon />
        <div>
          <span>STRUCTURE</span>
          <h2>{report.plot?.structure || "模型未返回结构判断"}</h2>
        </div>
      </section>
      {report.plot?.stages?.map((s, i) => (
        <article className="detail-row" key={i}>
          <strong>{String(i + 1).padStart(2, "0")}</strong>
          <div>
            <h3>{s.name}</h3>
            <p>{s.summary}</p>
          </div>
          <span>{s.tension}</span>
        </article>
      ))}
    </div>
  );
}
function GitIcon() {
  return (
    <div className="placeholder-icon">
      <Network size={28} />
    </div>
  );
}
function TeachingBlock({
  title,
  data,
}: {
  title: string;
  data?: TeachingSection;
}) {
  if (!data) return null;
  return (
    <article className="teaching-block">
      <div className="teaching-title">
        <span>{title}</span>
        <h3>{data.design || "尚未返回"}</h3>
      </div>
      <p>
        <b>怎样执行</b>
        {Array.isArray(data.execution) ? data.execution.join(" → ") : ""}
      </p>
      <p>
        <b>原文依据</b>
        {Array.isArray(data.evidence) ? data.evidence.join("；") : ""}
      </p>
      <p>
        <b>读者效果</b>
        {data.readerEffect}
      </p>
      <div className="beginner-method">
        <Lightbulb size={16} />
        <div>
          <b>新人照着做</b>
          <ol>
            {Array.isArray(data.beginnerMethod) &&
              data.beginnerMethod.map((x: string, i: number) => (
                <li key={i}>{x}</li>
              ))}
          </ol>
        </div>
      </div>
      {Array.isArray(data.pitfalls) && data.pitfalls.length > 0 && (
        <small>常见误区：{data.pitfalls.join("；")}</small>
      )}
    </article>
  );
}
function fallbackOutline(
  report: AnalysisReport,
): NonNullable<AnalysisReport["outline"]> {
  const architecture = report.storyArchitecture;
  const stages = architecture?.chapterBlueprint?.length
    ? architecture.chapterBlueprint
    : (report.plot?.stages || []).map((stage, i) => ({
        phase: stage.name || `阶段${i + 1}`,
        goal: stage.summary || "",
        chapters: "未标注",
        conflict: "从阶段摘要中提炼",
        turningPoint: "从阶段转折中提炼",
        readerQuestion: "下一步会怎样",
      }));
  const volumes = stages.map((stage: any, i: number) => ({
    name: stage.phase || `第${i + 1}卷`,
    role: stage.goal || "承担阶段推进任务",
    chapters: stage.chapters || "未标注",
    mainLine: stage.goal || architecture?.mainLine || report.coreJudgment || "",
    hiddenLine:
      architecture?.hiddenLines?.[i]?.setup ||
      architecture?.hiddenLines?.[i]?.name ||
      "从伏笔暗线页选择一条暗线迁移",
    keyPlots: [stage.conflict, stage.turningPoint, stage.readerQuestion].filter(
      Boolean,
    ),
    climax: stage.turningPoint || "本卷阶段性转折/高潮",
    endingHook: stage.readerQuestion || "留下下一卷追问",
    craftFocus: "把该卷拆成“目标—阻力—转折—兑现—新钩子”",
    newBookPlaceholder: "替换为你的新书人物、设定、矛盾和阶段目标",
  }));
  const fallbackActs = [
    "第一幕 · 开篇入局",
    "第二幕 · 目标成形",
    "第三幕 · 对抗升级",
    "第四幕 · 汇线爆发",
    "第五幕 · 回收与余波",
  ];
  const fiveAct = fallbackActs.map((act, i) => {
    const stage = stages[i] as any;
    const payoff = report.readerExperience?.[i];
    return {
      act,
      purpose: stage?.goal || stage?.summary || "完成该幕的结构推进",
      keyPlot: stage?.conflict || stage?.phase || "关键剧情待从原书阶段中提炼",
      climax: stage?.turningPoint || payoff?.payoff || "阶段高潮/转折点",
      mainLine: architecture?.mainLine || report.plot?.structure || "",
      hiddenLine:
        architecture?.hiddenLines?.[i]?.setup ||
        architecture?.hiddenLines?.[i]?.reveal ||
        "安排一条读者暂时看不懂、后续能回收的暗线",
      readerExpectation:
        payoff?.expectation || stage?.readerQuestion || "让读者追问下一步",
      payoff: payoff?.payoff || "阶段性兑现期待",
      chapters: stage?.chapters || "按你的篇幅重分配",
      writingTask: "写清本幕目标、阻力、转折、爽点兑现和下一钩子",
    };
  });
  const keyPlotBeats = volumes.flatMap((v) => v.keyPlots).filter(Boolean);
  const climaxLadder = volumes.map((v, i) => `第${i + 1}阶：${v.climax}`);
  return {
    originalBlueprint: {
      premise: architecture?.premise || report.summary || report.oneLine,
      fiveAct,
      volumes,
      keyPlotBeats,
      climaxLadder,
      mainLine: architecture?.mainLine || report.plot?.structure,
      hiddenLines: (architecture?.hiddenLines || []).map(
        (x) => `${x.name}：${x.setup} → ${x.reveal} → ${x.effect}`,
      ),
    },
    reusableTemplate: {
      title: "新书分卷五幕式大纲模板副本",
      premise:
        "把你的新书简介填在这里：主角是谁、想要什么、最大阻力是什么、失败代价是什么、核心爽点是什么。",
      fiveAct: fiveAct.map((x) => ({
        act: x.act,
        task: x.writingTask,
        mustHave: [x.purpose, x.readerExpectation, x.payoff].filter(Boolean),
        avoid: "只借结构功能，不复制原作人物、专名、设定和核心事件",
      })),
      volumes: volumes.map((v) => ({
        ...v,
        name: v.name.replace(/第?\d+卷|VOL\s*\d+/i, "新书卷名"),
        keyPlots: v.keyPlots.map((x) => `替换剧情功能：${x}`),
      })),
      characterTracks: (report.characterDesign || report.characters || [])
        .slice(0, 6)
        .map((c: any) => ({
          name: c.role || c.name || "人物功能位",
          function: c.core || c.role || "承担结构功能",
          entrance: c.entrance || "用动作/选择/反差出场",
          growth: c.development || c.arc || "通过选择和代价成长",
          turn: c.fear || c.conflict || "设计一次价值观转折",
          exit: c.exit || "阶段性收束或转入下一阶段",
          reusableSlot: "填入你的原创人物设定",
        })),
      threadMap: [
        {
          thread: "主线",
          type: "主线",
          setup: "开篇给目标和代价",
          development: "每卷升级阻力",
          payoff: "高潮处兑现核心矛盾",
          reusableQuestion: "你的主角最终必须解决什么问题？",
        },
        ...(architecture?.secondaryLines || []).slice(0, 2).map((x) => ({
          thread: x.name,
          type: "辅线",
          setup: x.purpose,
          development: x.intersections?.join(" → ") || "与主线多次交汇",
          payoff: "在高潮或结尾服务主线",
          reusableQuestion: "这条辅线如何改变主角或主题？",
        })),
        ...(architecture?.hiddenLines || []).slice(0, 2).map((x) => ({
          thread: x.name,
          type: "暗线",
          setup: x.setup,
          development: x.reveal,
          payoff: x.effect,
          reusableQuestion: "这条暗线前期如何伪装，后期如何让读者恍然大悟？",
        })),
      ],
      keyPlotBeats,
      climaxLadder,
      expectationPayoffRules: (report.readerExperience || [])
        .slice(0, 8)
        .map(
          (x) =>
            `${x.phase}：立期待「${x.expectation}」→ 延迟「${x.delay}」→ 加码「${x.escalation}」→ 兑现「${x.payoff}」`,
        ),
      fillInPrompt:
        "请根据我提供的新书简介，沿用这个模板的结构功能，生成原创分卷五幕式大纲。要求包含：每卷主线、暗线、关键剧情、高潮点、卷尾钩子、人物出场成长退场、期待感与爽感设计。禁止复制原作人物、专名、设定和核心事件。",
    },
  };
}
function outlineTemplateText(report: AnalysisReport) {
  const t = (report.outline || fallbackOutline(report)).reusableTemplate;
  if (!t) return "";
  return `# ${t.title || "新书大纲模板副本"}\n\n## 新书简介\n${t.premise || "在这里填入你的新书简介、题材、主角、核心卖点和禁忌。"}\n\n## 五幕式\n${(t.fiveAct || []).map((x, i) => `${i + 1}. ${x.act}\n- 阶段任务：${x.task}\n- 必须包含：${(x.mustHave || []).join("；")}\n- 避免：${x.avoid}`).join("\n\n")}\n\n## 分卷卷纲\n${(t.volumes || []).map((v, i) => `### 第${i + 1}卷：${v.name}\n- 结构作用：${v.role}\n- 章节范围：${v.chapters}\n- 主线推进：${v.mainLine}\n- 暗线埋设/揭示：${v.hiddenLine}\n- 关键剧情：${(v.keyPlots || []).join("；")}\n- 高潮点：${v.climax}\n- 卷尾钩子：${v.endingHook}\n- 本卷写作训练：${v.craftFocus}\n- 新书替换槽：${v.newBookPlaceholder}`).join("\n\n")}\n\n## 人物轨道\n${(t.characterTracks || []).map((x) => `- ${x.name}：${x.function}｜出场：${x.entrance}｜成长：${x.growth}｜转折：${x.turn}｜阶段退场：${x.exit}｜替换槽：${x.reusableSlot}`).join("\n")}\n\n## 主线/辅线/暗线\n${(t.threadMap || []).map((x) => `- ${x.thread}（${x.type}）：埋设=${x.setup}；发展=${x.development}；回收=${x.payoff}；新书提问=${x.reusableQuestion}`).join("\n")}\n\n## 关键剧情\n${(t.keyPlotBeats || []).map((x) => `- ${x}`).join("\n")}\n\n## 高潮阶梯\n${(t.climaxLadder || []).map((x) => `- ${x}`).join("\n")}\n\n## 期待感/爽感规则\n${(t.expectationPayoffRules || []).map((x) => `- ${x}`).join("\n")}\n\n## 给 AI 生成新大纲的提示词\n${t.fillInPrompt || "请根据我的新书简介，沿用这个模板的结构功能，但不要复制原作人物、设定、专名和核心事件，生成新的分卷五幕式大纲。"}`;
}
function OutlineView({ report }: { report: AnalysisReport }) {
  const outline = report.outline || fallbackOutline(report);
  const original = outline?.originalBlueprint;
  const template = outline?.reusableTemplate;
  const synthetic = !report.outline;
  const copyOriginal = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(original, null, 2));
      toast.success("原书大纲 JSON 已复制");
    } catch {
      toast.error("复制失败，请检查剪贴板权限。");
    }
  };
  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(outlineTemplateText(report));
      toast.success("新书大纲模板副本已复制");
    } catch {
      toast.error("复制失败，请检查剪贴板权限。");
    }
  };
  if (!original && !template)
    return (
      <div className="empty-library">
        <div className="empty-icon">
          <FileText size={30} />
        </div>
        <h3>当前报告还没有可生成大纲的数据</h3>
        <p>
          点“重新分析”后，会生成分卷、五幕式、关键剧情、高潮阶梯、主线和暗线，并附带可复制的新书模板。
        </p>
      </div>
    );
  return (
    <div className="teaching-stack outline-view">
      <section className="architecture-summary outline-hero">
        <div>
          <span>{synthetic ? "兼容大纲" : "大纲与模板"}</span>
          <h2>{template?.title || "拆书大纲与新书模板"}</h2>
          <p>
            {synthetic
              ? "这是根据当前旧报告里的全书布局、阶段施工图、人物线与期待爽感即时整理出的兼容大纲；重新分析后会得到更精确的专用大纲模块。"
              : original?.premise || template?.premise}
          </p>
        </div>
        <div className="outline-actions">
          <Button
            variant="outline"
            disabled={!original}
            onClick={() => void copyOriginal()}
          >
            <Copy size={16} />
            复制原书大纲
          </Button>
          <Button disabled={!template} onClick={() => void copyTemplate()}>
            <Copy size={16} />
            复制新书模板副本
          </Button>
        </div>
      </section>
      {original?.fiveAct?.length && (
        <section className="outline-section">
          <header>
            <b>五幕式结构</b>
            <span>每一幕都对应“作者要完成的叙事任务”</span>
          </header>
          {original.fiveAct.map((x, i) => (
            <article className="outline-act" key={i}>
              <strong>{String(i + 1).padStart(2, "0")}</strong>
              <div>
                <span>
                  {x.act} · {x.chapters}
                </span>
                <h3>{x.purpose}</h3>
                <p>{x.keyPlot}</p>
                <small>
                  主线：{x.mainLine}　暗线：{x.hiddenLine}
                </small>
                <small>
                  高潮/兑现：{x.climax}　期待：{x.readerExpectation}　爽点：
                  {x.payoff}
                </small>
                <em>写作任务：{x.writingTask}</em>
              </div>
            </article>
          ))}
        </section>
      )}
      {original?.volumes?.length && (
        <section className="outline-section">
          <header>
            <b>分卷卷纲</b>
            <span>每卷都要有主线推进、暗线变化和卷内高潮</span>
          </header>
          <div className="outline-volume-grid">
            {original.volumes.map((v, i) => (
              <article className="outline-volume" key={i}>
                <span>
                  VOL {String(i + 1).padStart(2, "0")} · {v.chapters}
                </span>
                <h3>{v.name}</h3>
                <p>{v.role}</p>
                <dl>
                  <dt>主线</dt>
                  <dd>{v.mainLine}</dd>
                  <dt>暗线</dt>
                  <dd>{v.hiddenLine}</dd>
                  <dt>关键剧情</dt>
                  <dd>{v.keyPlots?.join("；")}</dd>
                  <dt>高潮点</dt>
                  <dd>{v.climax}</dd>
                  <dt>卷尾钩子</dt>
                  <dd>{v.endingHook}</dd>
                  <dt>迁移训练</dt>
                  <dd>{v.craftFocus}</dd>
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="thread-grid">
        <article>
          <b>关键剧情骨架</b>
          {original?.keyPlotBeats?.map((x, i) => (
            <div key={i}>
              <h4>{String(i + 1).padStart(2, "0")}</h4>
              <p>{x}</p>
            </div>
          ))}
        </article>
        <article>
          <b>高潮阶梯</b>
          {original?.climaxLadder?.map((x, i) => (
            <div key={i}>
              <h4>{String(i + 1).padStart(2, "0")}</h4>
              <p>{x}</p>
            </div>
          ))}
        </article>
      </div>
      {template && (
        <section className="outline-section">
          <header>
            <b>新书模板预览</b>
            <span>复制后可填入你自己的简介，让 AI 生成全新的大纲</span>
          </header>
          <pre className="outline-template">{outlineTemplateText(report)}</pre>
        </section>
      )}
    </div>
  );
}
function ArchitectureView({ report }: { report: AnalysisReport }) {
  const a = report.storyArchitecture;
  if (!a) return <PlotView report={report} />;
  return (
    <div className="teaching-stack">
      <section className="architecture-summary">
        <div>
          <span>故事主线</span>
          <h2>{a.mainLine}</h2>
          <p>{a.premise}</p>
        </div>
      </section>
      <div className="thread-grid">
        <article>
          <b>辅线如何服务主线</b>
          {a.secondaryLines?.map((line, i) => (
            <div key={i}>
              <h4>{line.name}</h4>
              <p>{line.purpose}</p>
              <small>交汇点：{line.intersections?.join(" → ")}</small>
            </div>
          ))}
        </article>
        <article>
          <b>暗线如何埋藏与揭示</b>
          {a.hiddenLines?.map((line, i) => (
            <div key={i}>
              <h4>{line.name}</h4>
              <p>{line.setup}</p>
              <small>
                {line.reveal} · {line.effect}
              </small>
            </div>
          ))}
        </article>
      </div>
      <div className="teaching-grid">
        <TeachingBlock title="01 · 开篇" data={a.opening} />
        <TeachingBlock title="02 · 铺垫与推进" data={a.progression} />
        <TeachingBlock title="03 · 高潮" data={a.climax} />
        <TeachingBlock title="04 · 结尾" data={a.ending} />
      </div>
      <section className="blueprint">
        <header>
          <b>全书阶段施工图</b>
          <span>从作者意图反推每阶段任务</span>
        </header>
        {a.chapterBlueprint?.map((item, i) => (
          <article key={i}>
            <strong>{String(i + 1).padStart(2, "0")}</strong>
            <div>
              <h4>
                {item.phase} · {item.chapters}
              </h4>
              <p>{item.goal}</p>
              <small>
                冲突：{item.conflict}　转折：{item.turningPoint}　读者追问：
                {item.readerQuestion}
              </small>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
function ReaderExperienceView({ report }: { report: AnalysisReport }) {
  const items = report.readerExperience || [];
  return (
    <div className="teaching-stack">
      {items.length ? (
        <>
          <section className="architecture-summary">
            <span>读者体验</span>
            <h2>期待不是悬念一句话，爽感也不是突然开挂</h2>
            <p>
              看清作者如何先让读者渴望一个结果，再通过延迟与加码提高价值，最后兑现并留下下一个钩子。
            </p>
          </section>
          {items.map((x, i) => (
            <article className="payoff-lesson" key={i}>
              <header>
                <strong>{String(i + 1).padStart(2, "0")}</strong>
                <div>
                  <span>
                    {x.phase} · {x.payoffType}
                  </span>
                  <h3>{x.expectation}</h3>
                </div>
                <b>{Math.max(0, Math.min(100, x.intensity || 0))}</b>
              </header>
              <div className="payoff-chain">
                <div>
                  <span>立期待</span>
                  <p>{x.expectation}</p>
                </div>
                <i>→</i>
                <div>
                  <span>压着不给</span>
                  <p>{x.delay}</p>
                </div>
                <i>→</i>
                <div>
                  <span>加码</span>
                  <p>{x.escalation}</p>
                </div>
                <i>→</i>
                <div>
                  <span>爽点兑现</span>
                  <p>{x.payoff}</p>
                </div>
              </div>
              <p className="evidence-line">
                <b>原文依据</b>
                {x.evidence}
              </p>
              <div className="next-hook">
                <b>兑现后如何继续拉追读</b>
                <p>{x.nextHook}</p>
              </div>
              <div className="beginner-method">
                <Lightbulb size={16} />
                <div>
                  <b>新人可复用的步骤</b>
                  <ol>
                    {x.method?.map((step, j) => (
                      <li key={j}>{step}</li>
                    ))}
                  </ol>
                </div>
              </div>
              <p className="pitfall">
                <b>容易写崩</b>
                {x.pitfall}
              </p>
            </article>
          ))}
        </>
      ) : (
        <div className="empty-library">
          当前旧报告没有“期待·爽感”工程数据，重新进行教学型拆书后生成。
        </div>
      )}
    </div>
  );
}
function CharactersView({ report }: { report: AnalysisReport }) {
  if (report.characterDesign?.length)
    return (
      <div className="teaching-stack">
        {report.characterDesign.map((c, i) => (
          <article className="character-lesson" key={i}>
            <header>
              <span>{c.name?.slice(0, 1) || "?"}</span>
              <div>
                <h3>{c.name}</h3>
                <small>
                  {c.role} · {c.core}
                </small>
              </div>
            </header>
            <div className="character-map">
              <p>
                <b>欲望</b>
                {c.desire}
              </p>
              <p>
                <b>恐惧/缺口</b>
                {c.fear}
              </p>
              <p>
                <b>如何出场</b>
                {c.entrance}
              </p>
              <p>
                <b>如何成长</b>
                {c.development}
              </p>
              <p>
                <b>关系推动</b>
                {c.relationships}
              </p>
              <p>
                <b>如何退场/阶段收束</b>
                {c.exit}
              </p>
            </div>
            <p className="evidence-line">
              <b>塑造证据</b>
              {c.evidence}
            </p>
            <div className="technique-tags">
              {c.techniques?.map((x, j) => (
                <span key={j}>{x}</span>
              ))}
            </div>
            <div className="beginner-method">
              <Lightbulb size={16} />
              <div>
                <b>练习</b>
                <p>{c.exercise}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  return (
    <div className="insight-grid">
      {report.characters?.map((c, i) => (
        <article className="insight-card" key={i}>
          <div className="insight-card-head">
            <span>{c.name?.slice(0, 1) || "?"}</span>
            <div>
              <h3>{c.name}</h3>
              <small>{c.role}</small>
            </div>
          </div>
          <dl>
            <dt>欲望</dt>
            <dd>{c.desire}</dd>
            <dt>弧光</dt>
            <dd>{c.arc}</dd>
            <dt>关系</dt>
            <dd>
              {Array.isArray(c.relationships)
                ? c.relationships.join(" · ")
                : String(c.relationships || "")}
            </dd>
          </dl>
        </article>
      ))}
    </div>
  );
}
function ForeshadowingView({ report }: { report: AnalysisReport }) {
  return (
    <div className="teaching-stack">
      {report.foreshadowing?.length ? (
        report.foreshadowing.map((item, i) => (
          <article className="foreshadow-row" key={i}>
            <strong>{String(i + 1).padStart(2, "0")}</strong>
            <div>
              <span>埋设</span>
              <h3>{item.setup}</h3>
              <p>
                <b>回收</b>
                {item.payoff}
              </p>
              <p>
                <b>作用</b>
                {item.effect}
              </p>
            </div>
          </article>
        ))
      ) : (
        <div className="empty-library">
          当前旧报告没有结构化伏笔数据，重新进行“教学型拆书”后生成。
        </div>
      )}
    </div>
  );
}
function ScenesView({ report }: { report: AnalysisReport }) {
  return (
    <div className="teaching-stack">
      {report.sceneCraft?.length ? (
        report.sceneCraft.map((s, i) => (
          <article className="scene-lesson" key={i}>
            <div className="eyebrow">场景 {String(i + 1).padStart(2, "0")}</div>
            <h3>{s.scene}</h3>
            <div className="scene-grid">
              <p>
                <b>场景任务</b>
                {s.purpose}
              </p>
              <p>
                <b>如何进入</b>
                {s.entry}
              </p>
              <p>
                <b>感官与氛围</b>
                {s.sensory}
              </p>
              <p>
                <b>场内冲突</b>
                {s.conflict}
              </p>
              <p>
                <b>如何转场</b>
                {s.transition}
              </p>
              <p>
                <b>原文依据</b>
                {s.evidence}
              </p>
            </div>
            <div className="beginner-method">
              <Lightbulb size={16} />
              <div>
                <b>迁移到你的小说</b>
                <p>{s.transfer}</p>
              </div>
            </div>
          </article>
        ))
      ) : (
        <div className="empty-library">
          当前旧报告没有场景拆解，重新分析后生成。
        </div>
      )}
    </div>
  );
}
function LessonsView({ report }: { report: AnalysisReport }) {
  if (report.writingLessons?.length)
    return (
      <div className="teaching-stack">
        {report.writingLessons.map((lesson, i) => (
          <article className="writing-lesson" key={i}>
            <header>
              <strong>{String(i + 1).padStart(2, "0")}</strong>
              <div>
                <span>写作练习</span>
                <h3>{lesson.topic}</h3>
              </div>
            </header>
            <h4>{lesson.principle}</h4>
            <p>
              <b>原文怎样做</b>
              {lesson.evidence}
            </p>
            <div className="lesson-steps">
              <b>可执行步骤</b>
              <ol>
                {lesson.steps?.map((step, j) => (
                  <li key={j}>{step}</li>
                ))}
              </ol>
            </div>
            <p className="pitfall">
              <b>别这样写</b>
              {lesson.pitfall}
            </p>
            <div className="beginner-method">
              <Lightbulb size={16} />
              <div>
                <b>马上练习</b>
                <p>{lesson.exercise}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  return <CraftsView report={report} />;
}
function CraftsView({ report }: { report: AnalysisReport }) {
  return (
    <div className="detail-stack">
      {report.crafts?.map((c, i) => (
        <article className="method-card" key={i}>
          <span>{String(i + 1).padStart(2, "0")}</span>
          <div>
            <h3>{c.title}</h3>
            <p>
              <b>原文证据</b>
              {c.evidence}
            </p>
            <p>
              <b>手法原理</b>
              {c.method}
            </p>
            <div className="transfer">
              <Lightbulb size={16} />
              <span>{c.transfer}</span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export default App;
