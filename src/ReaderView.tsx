import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  BookmarkPlus,
  BrainCircuit,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Focus,
  History,
  LibraryBig,
  List,
  LoaderCircle,
  Minus,
  Monitor,
  Plus,
  Pause,
  Play,
  Search,
  Settings2,
  Smartphone,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useReaderSpeech } from "@/lib/use-reader-speech";
import { cn } from "@/lib/utils";
import { builtInSpeechEngines } from "@/lib/speech-engines";
import {
  deleteReadingClip,
  exportBook,
  getChapter,
  getReadingProgress,
  listChapters,
  listReadingClips,
  listReadingHistory,
  saveReadingClip,
  saveReadingProgress,
  updateReadingClip,
} from "@/lib/tauri";
import {
  approximateBookProgress,
  defaultReaderPrefs,
  findQuoteRanges,
  formatExactWords,
  readReaderPrefs,
  readerParagraphs,
  saveReaderPrefs,
  type ReaderPrefs,
  type ReaderTheme,
} from "@/lib/reader";
import type {
  BookSummary,
  ChapterDetail,
  ChapterSummary,
  ReadingClip,
  ReadingHistoryItem,
} from "@/types";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const themeOptions: Array<{
  value: ReaderTheme;
  label: string;
  description: string;
}> = [
  { value: "white", label: "纯白", description: "清爽明亮" },
  { value: "paper", label: "纸张", description: "温暖柔和" },
  { value: "mist", label: "雾灰", description: "减少眩光" },
  { value: "sage", label: "护眼", description: "柔和浅绿" },
  { value: "night", label: "夜读", description: "深色低亮" },
];

type SelectionDraft = { quote: string; paragraph: number };
type NoteDraft = SelectionDraft & { clipId?: string };

export function ReaderView({
  book,
  onAnalyze,
  onReport,
  onProgress,
  focusMode,
  onFocusChange,
  onPhoneModeChange,
}: {
  book: BookSummary;
  onAnalyze: () => void;
  onReport: () => void;
  onProgress: () => Promise<void>;
  focusMode: boolean;
  onFocusChange: (focus: boolean) => void;
  onPhoneModeChange: (phone: boolean) => void;
}) {
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [history, setHistory] = useState<ReadingHistoryItem[]>([]);
  const [clips, setClips] = useState<ReadingClip[]>([]);
  const [query, setQuery] = useState("");
  const [sideTab, setSideTab] = useState("chapters");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<"txt" | "docx" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [speechOpen, setSpeechOpen] = useState(false);
  const [prefs, setPrefs] = useState<ReaderPrefs>(readReaderPrefs);
  const phoneMode = prefs.phoneMode;
  const [selectedText, setSelectedText] = useState<SelectionDraft | null>(null);
  const [activeClip, setActiveClip] = useState<ReadingClip | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [note, setNote] = useState("");
  const [savingClip, setSavingClip] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReadingClip | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [ratio, setRatio] = useState(0);
  const contentRef = useRef<HTMLElement | null>(null);
  const proseRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<{ position: number; ratio: number } | null>(null);
  const progressTimer = useRef<number | undefined>(undefined);
  const restoreTimer = useRef<number | undefined>(undefined);
  const requestRef = useRef(0);
  const restoringRef = useRef(false);
  const pendingParagraphRef = useRef<number | null>(null);
  const chapterCacheRef = useRef(new Map<number, ChapterDetail>());
  const layoutAnchorRef = useRef<{ paragraph: number; offset: number } | null>(
    null,
  );
  const callbacksRef = useRef({ onProgress, onFocusChange });
  callbacksRef.current = { onProgress, onFocusChange };

  const changePhoneMode = useCallback((phone: boolean) => {
    layoutAnchorRef.current = null;
    const content = contentRef.current;
    if (content && content.scrollTop > 0) {
      const top = content.getBoundingClientRect().top;
      const paragraph = Array.from(
        proseRef.current?.querySelectorAll<HTMLElement>("[data-paragraph]") ??
          [],
      ).find((item) => item.getBoundingClientRect().bottom > top);
      if (paragraph && paragraph.getBoundingClientRect().top <= top) {
        const rect = paragraph.getBoundingClientRect();
        layoutAnchorRef.current = {
          paragraph: Number(paragraph.dataset.paragraph),
          offset: (top - rect.top) / rect.height,
        };
      }
    }
    setNavigationOpen(false);
    setSelectedText(null);
    window.getSelection()?.removeAllRanges();
    setPrefs((current) => ({ ...current, phoneMode: phone }));
  }, []);

  useEffect(() => {
    onPhoneModeChange(phoneMode);
  }, [phoneMode, onPhoneModeChange]);

  useEffect(() => {
    saveReaderPrefs(prefs);
    const content = contentRef.current;
    if (content && progressRef.current) {
      const current = { ...progressRef.current };
      let restoreFrame: number | undefined;
      const frame = requestAnimationFrame(() => {
        restoreFrame = requestAnimationFrame(() => {
          if (progressRef.current?.position !== current.position) return;
          const anchor = layoutAnchorRef.current;
          const paragraph =
            anchor &&
            proseRef.current?.querySelector<HTMLElement>(
              `[data-paragraph="${anchor.paragraph}"]`,
            );
          let target;
          if (paragraph && anchor) {
            const rect = paragraph.getBoundingClientRect();
            target =
              content.scrollTop +
              rect.top -
              content.getBoundingClientRect().top +
              anchor.offset * rect.height;
          } else {
            target =
              current.ratio *
              Math.max(0, content.scrollHeight - content.clientHeight);
          }
          content.scrollTo({ top: target, behavior: "instant" });
          const maximum = Math.max(
            0,
            content.scrollHeight - content.clientHeight,
          );
          const next = maximum
            ? Math.max(0, Math.min(1, content.scrollTop / maximum))
            : 1;
          progressRef.current = { position: current.position, ratio: next };
          setRatio(next);
          layoutAnchorRef.current = null;
        });
      });
      return () => {
        cancelAnimationFrame(frame);
        if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
      };
    }
  }, [prefs]);
  useEffect(() => {
    if (focusMode) setActiveClip(null);
  }, [focusMode]);
  const persistCurrent = useCallback(async () => {
    window.clearTimeout(progressTimer.current);
    const current = progressRef.current;
    if (!current) return;
    await saveReadingProgress(book.id, current.position, current.ratio);
  }, [book.id]);
  const loadChapter = useCallback(
    async (
      position: number,
      atRatio = 0,
      previousSave: Promise<void> = Promise.resolve(),
      clip: ReadingClip | null = null,
    ) => {
      const request = ++requestRef.current;
      window.clearTimeout(restoreTimer.current);
      setBusy(true);
      setError("");
      setSelectedText(null);
      setActiveClip(clip);
      try {
        let detail = chapterCacheRef.current.get(position);
        if (!detail) {
          detail = await getChapter(book.id, position);
          chapterCacheRef.current.set(position, detail);
          if (chapterCacheRef.current.size > 12) {
            const oldest = chapterCacheRef.current.keys().next().value;
            if (oldest !== undefined) chapterCacheRef.current.delete(oldest);
          }
        }
        if (request !== requestRef.current) return;
        setChapter(detail);
        const safeRatio = Math.max(0, Math.min(1, atRatio));
        setRatio(safeRatio);
        progressRef.current = { position, ratio: safeRatio };
        restoringRef.current = true;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (request !== requestRef.current) return;
            const content = contentRef.current;
            if (content)
              content.scrollTop =
                safeRatio *
                Math.max(0, content.scrollHeight - content.clientHeight);
            const paragraph = pendingParagraphRef.current;
            if (paragraph !== null) {
              (
                proseRef.current?.querySelector(".reader-active-clip") ??
                proseRef.current?.querySelector(
                  `[data-paragraph="${paragraph}"]`,
                )
              )?.scrollIntoView({ block: "center" });
              pendingParagraphRef.current = null;
              if (content) {
                const maximum = Math.max(
                  0,
                  content.scrollHeight - content.clientHeight,
                );
                const next = maximum ? content.scrollTop / maximum : 1;
                progressRef.current = { position, ratio: next };
                setRatio(next);
                void saveReadingProgress(book.id, position, next).catch(
                  () => {},
                );
              }
            }
            restoreTimer.current = window.setTimeout(() => {
              restoringRef.current = false;
            }, 250);
          }),
        );
        setBusy(false);
        void (async () => {
          await previousSave;
          if (request !== requestRef.current) return;
          const current = progressRef.current;
          await saveReadingProgress(
            book.id,
            position,
            current?.position === position ? current.ratio : safeRatio,
          );
          if (request !== requestRef.current) return;
          setHistory(await listReadingHistory(book.id));
          await callbacksRef.current.onProgress();
        })().catch((error) => {
          if (request === requestRef.current) setError(errorText(error));
        });
      } catch (error) {
        if (request === requestRef.current) setError(errorText(error));
      } finally {
        if (request === requestRef.current) setBusy(false);
      }
    },
    [book.id],
  );
  const openChapter = useCallback(
    async (position: number, atRatio = 0, clip: ReadingClip | null = null) => {
      setNavigationOpen(false);
      const previousSave = persistCurrent();
      await loadChapter(position, atRatio, previousSave, clip);
    },
    [persistCurrent, loadChapter],
  );
  const speech = useReaderSpeech(chapter, chapters, openChapter);
  useEffect(() => {
    let active = true;
    void Promise.all([
      listChapters(book.id),
      getReadingProgress(book.id),
      listReadingHistory(book.id),
      listReadingClips(book.id),
    ])
      .then(async ([items, progress, recent, saved]) => {
        if (!active) return;
        setChapters(items);
        setHistory(recent);
        setClips(saved);
        const target =
          progress && items.some((item) => item.position === progress.position)
            ? progress.position
            : items[0]?.position;
        if (target === undefined) {
          setBusy(false);
          return;
        }
        await loadChapter(
          target,
          progress?.position === target ? progress.ratio : 0,
        );
      })
      .catch((error) => {
        if (active) {
          setError(errorText(error));
          setBusy(false);
        }
      });
    return () => {
      active = false;
      requestRef.current++;
      window.clearTimeout(restoreTimer.current);
      void persistCurrent()
        .then(() => callbacksRef.current.onProgress())
        .catch(() => {});
    };
  }, [book.id, loadChapter, persistCurrent]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input,textarea,[contenteditable]");
      if (
        event.key === "Escape" &&
        (focusMode || phoneMode) &&
        !document.querySelector('[role="dialog"],[role="alertdialog"]')
      ) {
        event.preventDefault();
        if (phoneMode) changePhoneMode(false);
        else callbacksRef.current.onFocusChange(false);
      }
      if (
        (event.key === "f" || event.key === "F") &&
        !editing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !phoneMode &&
        !document.querySelector('[role="dialog"],[role="alertdialog"]')
      ) {
        event.preventDefault();
        callbacksRef.current.onFocusChange(!focusMode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, phoneMode, changePhoneMode]);

  const onScroll = () => {
    const content = contentRef.current;
    if (!content || !chapter || restoringRef.current) return;
    const maximum = Math.max(0, content.scrollHeight - content.clientHeight);
    const next = maximum
      ? Math.max(0, Math.min(1, content.scrollTop / maximum))
      : 1;
    setRatio(next);
    progressRef.current = { position: chapter.position, ratio: next };
    window.clearTimeout(progressTimer.current);
    progressTimer.current = window.setTimeout(() => {
      void persistCurrent()
        .then(() => callbacksRef.current.onProgress())
        .catch((error) => setError(errorText(error)));
    }, 850);
  };
  const captureSelection = () => {
    const selection = window.getSelection();
    const prose = proseRef.current;
    if (
      !selection ||
      selection.isCollapsed ||
      !prose ||
      !selection.rangeCount
    ) {
      setSelectedText(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (
      !prose.contains(range.startContainer) ||
      !prose.contains(range.endContainer)
    ) {
      setSelectedText(null);
      return;
    }
    const quote = selection.toString().trim();
    const length = Array.from(quote).length;
    if (!length || length > 3000) {
      setSelectedText(null);
      if (length > 3000) toast.error("一次最多收藏 3000 字");
      return;
    }
    const start =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const paragraph = Number(
      start?.closest("[data-paragraph]")?.getAttribute("data-paragraph") ?? 0,
    );
    setSelectedText({ quote, paragraph });
  };
  const openNote = (draft: NoteDraft, noteValue = "") => {
    setNoteDraft(draft);
    setNote(noteValue);
    setSelectedText(null);
    window.getSelection()?.removeAllRanges();
  };
  const saveNote = async () => {
    if (!noteDraft || !chapter || savingClip) return;
    setSavingClip(true);
    try {
      if (noteDraft.clipId)
        await updateReadingClip(book.id, noteDraft.clipId, note);
      else
        await saveReadingClip({
          bookId: book.id,
          position: chapter.position,
          quote: noteDraft.quote,
          note,
          paragraph: noteDraft.paragraph,
        });
      setClips(await listReadingClips(book.id));
      setNoteDraft(null);
      setSideTab("clips");
      toast.success("已收藏到片段灵感集");
    } catch (error) {
      setError(errorText(error));
      toast.error(errorText(error));
    } finally {
      setSavingClip(false);
    }
  };
  const deleteClip = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteReadingClip(book.id, deleteTarget.id);
      setClips(await listReadingClips(book.id));
      if (activeClip?.id === deleteTarget.id) setActiveClip(null);
      setDeleteTarget(null);
      toast.success("已删除收藏片段");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setDeleting(false);
    }
  };
  const jumpToClip = async (clip: ReadingClip) => {
    try {
      const detail = await getChapter(book.id, clip.position);
      const normalize = (text: string) => text.replace(/\s/g, "");
      if (
        detail.title !== clip.chapterTitle ||
        !normalize(detail.content).includes(normalize(clip.quote))
      ) {
        setError("该片段的原章节已更新，收藏与备注仍保留在灵感集中。");
        return;
      }
      pendingParagraphRef.current = clip.paragraph;
      await openChapter(clip.position, 0, clip);
    } catch (error) {
      setError(errorText(error));
    }
  };
  const doExport = async (format: "txt" | "docx") => {
    setExporting(format);
    setError("");
    try {
      const path = await exportBook(book.id, format);
      toast.success(`已导出到 ${path}`);
      setExportOpen(false);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setExporting(null);
    }
  };
  const visible = useMemo(
    () =>
      chapters.filter((item) =>
        item.title.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [chapters, query],
  );
  const currentIndex = chapters.findIndex(
    (item) => item.position === chapter?.position,
  );
  const paragraphs = useMemo(
    () => readerParagraphs(chapter?.content || ""),
    [chapter?.content],
  );
  useEffect(() => {
    if (speech.paragraph === null) return;
    proseRef.current
      ?.querySelector(`[data-paragraph="${speech.paragraph}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [speech.paragraph]);
  const highlightRanges = useMemo(
    () =>
      activeClip && activeClip.position === chapter?.position
        ? findQuoteRanges(paragraphs, activeClip.quote, activeClip.paragraph)
        : [],
    [activeClip, chapter?.position, paragraphs],
  );
  const progress = chapter
    ? approximateBookProgress(chapters, chapter.position, ratio)
    : 0;
  const readerStyle = {
    "--reader-font-size": `${prefs.fontSize}px`,
    "--reader-line-height": prefs.lineHeight,
    "--reader-paragraph-gap": `${prefs.paragraphGap}em`,
    "--reader-column-width": `${prefs.columnWidth}px`,
  } as CSSProperties;
  const changePrefs = (part: Partial<ReaderPrefs>) =>
    setPrefs((current) => ({ ...current, ...part }));

  const navigation = (
    <aside className="chapter-sidebar">
      <Tabs
        value={sideTab}
        onValueChange={(value) => {
          setSideTab(value);
          if (value !== "clips") setActiveClip(null);
          if (value === "history") {
            void persistCurrent()
              .then(() => listReadingHistory(book.id))
              .then(setHistory)
              .catch((error) => setError(errorText(error)));
          }
        }}
        className="reader-side-tabs"
      >
        <TabsList
          variant="line"
          aria-label="阅读侧栏"
          className="reader-side-tablist"
        >
          <TabsTrigger value="chapters">目录</TabsTrigger>
          <TabsTrigger value="history">记录</TabsTrigger>
          <TabsTrigger value="clips">
            灵感集{clips.length ? ` ${clips.length}` : ""}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chapters" className="reader-side-panel">
          <InputGroup className="chapter-search">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="搜索章节"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索章节…"
            />
          </InputGroup>
          <div className="chapter-count">
            {visible.length} 章 · 选择章节继续阅读
          </div>
          <div className="chapter-list">
            {!visible.length && !busy && (
              <p className="list-empty">没有匹配的章节</p>
            )}
            {visible.map((item) => (
              <Button
                variant={
                  chapter?.position === item.position ? "secondary" : "ghost"
                }
                disabled={busy}
                aria-current={
                  chapter?.position === item.position ? "page" : undefined
                }
                key={item.position}
                onClick={() => void openChapter(item.position)}
              >
                <span>{String(item.position + 1).padStart(3, "0")}</span>
                <div>
                  <b>{item.title}</b>
                  <small>{formatExactWords(item.characterCount)}</small>
                </div>
              </Button>
            ))}
          </div>
        </TabsContent>
        <TabsContent
          value="history"
          className="reader-side-panel reader-side-scroll"
        >
          <div className="reader-side-hint">
            <History size={15} /> 最近读过的章节与位置
          </div>
          {!history.length && (
            <p className="reader-side-empty">
              开始阅读后，这里会保存你的阅读记录。
            </p>
          )}
          {history.map((item) => (
            <Button
              key={item.position}
              variant="ghost"
              className="reader-history-item"
              onClick={() => void openChapter(item.position, item.ratio)}
            >
              <span>{item.title}</span>
              <small>
                本章 {Math.round(item.ratio * 100)}% ·{" "}
                {new Date(item.updatedAt).toLocaleString("zh-CN")}
              </small>
            </Button>
          ))}
        </TabsContent>
        <TabsContent
          value="clips"
          className="reader-side-panel reader-side-scroll"
        >
          <div className="reader-side-hint">
            <LibraryBig size={15} /> 划选正文，收藏为写作素材
          </div>
          {activeClip && (
            <Button
              size="sm"
              variant="ghost"
              className="reader-clear-clip"
              onClick={() => setActiveClip(null)}
            >
              退出片段定位
            </Button>
          )}
          {!clips.length && (
            <p className="reader-side-empty">
              在正文中划选一段文字，即可收藏并添加备注。
            </p>
          )}
          {clips.map((clip) => (
            <div className="reader-clip" key={clip.id}>
              <button
                type="button"
                className="reader-clip-main"
                onClick={() => void jumpToClip(clip)}
              >
                <small>{clip.chapterTitle}</small>
                <span>“{clip.quote}”</span>
                {clip.note && <em>{clip.note}</em>}
              </button>
              <div className="reader-clip-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    openNote(
                      {
                        quote: clip.quote,
                        paragraph: clip.paragraph,
                        clipId: clip.id,
                      },
                      clip.note,
                    )
                  }
                >
                  编辑备注
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`删除收藏：${clip.quote.slice(0, 12)}`}
                  onClick={() => setDeleteTarget(clip)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </aside>
  );

  return (
    <div
      className={cn(
        "reader-page",
        focusMode && "reader-page--focus",
        phoneMode && "reader-page--phone",
      )}
      data-reader-layout={phoneMode ? "phone" : "desktop"}
      data-reader-theme={prefs.theme}
      data-reader-font={prefs.serif ? "serif" : "sans"}
      style={readerStyle}
    >
      {!focusMode && !phoneMode && (
        <header className="reader-header">
          <div className="reader-identity">
            <div className="eyebrow">
              <BookOpen size={14} /> 阅读 · {chapters.length} 章
            </div>
            <h1>{book.title}</h1>
            <p>
              {formatExactWords(book.characterCount)} ·{" "}
              {book.sourceUri || "本地导入"}
            </p>
            {book.sourceType === "legado" &&
              book.downloadReceipt &&
              book.contentStatus !== "complete" && (
                <small>
                  已保存 {book.downloadReceipt.downloadedChapters} /{" "}
                  {book.downloadReceipt.totalChapters} 章，分析前需下载完整正文
                </small>
              )}
          </div>
          <div className="reader-actions">
            <Button
              size="sm"
              variant="ghost"
              disabled={!chapter}
              onClick={() => setSpeechOpen(true)}
            >
              <Volume2 />
              朗读
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!chapters.length}
              onClick={() => setExportOpen(true)}
            >
              <FileText />
              导出
            </Button>
            {book.report && (
              <Button size="sm" variant="ghost" onClick={onReport}>
                <BarChart3 />
                分析报告
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={book.status === "analyzing" || !chapters.length}
              onClick={onAnalyze}
            >
              <BrainCircuit />
              {book.status === "analyzing"
                ? "分析中"
                : book.status === "failed"
                  ? "继续分析"
                  : "开始分析"}
            </Button>
            <span className="reader-action-divider" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 />
              阅读设置
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => changePhoneMode(true)}
            >
              <Smartphone data-icon="inline-start" />
              手机模式
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onFocusChange(true);
                toast("已进入阅读模式，按 Esc 或 F 退出");
              }}
            >
              <Focus />
              阅读模式
            </Button>
          </div>
        </header>
      )}
      {focusMode && !phoneMode && (
        <Button
          className="reader-focus-exit"
          size="sm"
          variant="ghost"
          onClick={() => onFocusChange(false)}
          aria-label="退出阅读模式"
        >
          退出阅读模式 <span>Esc</span>
        </Button>
      )}
      {phoneMode && (
        <header className="reader-phone-toolbar">
          <div>
            <Smartphone size={16} />
            <span>手机模式</span>
            <small>窄屏阅读 · 位置自动保存</small>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => changePhoneMode(false)}
          >
            <Monitor data-icon="inline-start" />
            退出手机模式<span className="reader-phone-shortcut">Esc</span>
          </Button>
        </header>
      )}
      <div
        className={cn(
          phoneMode && "reader-phone-stage",
          !phoneMode && "reader-stage",
        )}
      >
        <div className="reader-shell">
          {phoneMode && (
            <header className="reader-phone-header">
              <div className="reader-phone-speaker" aria-hidden="true">
                <i />
                <i />
              </div>
              <div className="reader-phone-heading">
                <span title={book.title}>{book.title}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="朗读"
                  disabled={!chapter}
                  onClick={() => setSpeechOpen(true)}
                >
                  <Volume2 />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="阅读设置"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings2 />
                </Button>
              </div>
            </header>
          )}
          {!focusMode && !phoneMode && navigation}
          <article
            className="reader-content"
            ref={contentRef}
            tabIndex={-1}
            onScroll={onScroll}
          >
            {busy && !chapter ? (
              <div className="reader-loading">
                <LoaderCircle className="spin" />
                读取章节…
              </div>
            ) : chapter ? (
              <div className="reader-paper">
                <div className="chapter-heading">
                  <span>
                    {String(chapter.position + 1).padStart(3, "0")} /{" "}
                    {chapters.length}
                  </span>
                  <h2>{chapter.title}</h2>
                  <small>
                    {formatExactWords(chapter.characterCount)} · 本章已读{" "}
                    {Math.round(ratio * 100)}%
                  </small>
                </div>
                <div
                  className="chapter-prose"
                  ref={proseRef}
                  tabIndex={0}
                  aria-label="章节正文，划选文字后可收藏片段"
                  onMouseUp={captureSelection}
                  onKeyUp={captureSelection}
                >
                  {paragraphs.map((line, index) => {
                    const ranges = highlightRanges.filter(
                      (range) => range.paragraph === index,
                    );
                    const parts: ReactNode[] = [];
                    let cursor = 0;
                    for (const range of ranges) {
                      parts.push(line.slice(cursor, range.start));
                      parts.push(
                        <mark
                          className="reader-active-clip"
                          key={`${range.start}-${range.end}`}
                        >
                          {line.slice(range.start, range.end)}
                        </mark>,
                      );
                      cursor = range.end;
                    }
                    parts.push(line.slice(cursor));
                    return (
                      <p
                        key={index}
                        data-paragraph={index}
                        className={
                          speech.paragraph === index
                            ? "reader-speaking"
                            : undefined
                        }
                      >
                        {parts}
                      </p>
                    );
                  })}
                </div>
                {!phoneMode && (
                  <footer className="reader-pagination">
                    <Button
                      variant="outline"
                      disabled={busy || currentIndex <= 0}
                      onClick={() =>
                        void openChapter(chapters[currentIndex - 1].position)
                      }
                    >
                      <ChevronLeft />
                      上一章
                    </Button>
                    <span>
                      {currentIndex + 1} / {chapters.length}
                    </span>
                    <Button
                      variant="outline"
                      disabled={
                        busy ||
                        currentIndex < 0 ||
                        currentIndex >= chapters.length - 1
                      }
                      onClick={() =>
                        void openChapter(chapters[currentIndex + 1].position)
                      }
                    >
                      下一章
                      <ChevronRight />
                    </Button>
                  </footer>
                )}
              </div>
            ) : (
              <div className="reader-loading">没有可阅读章节</div>
            )}
            {error && (
              <Alert variant="destructive" className="reader-error">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </article>
          {phoneMode && (
            <footer className="reader-phone-footer">
              <div
                className="reader-phone-progress"
                aria-label={`阅读进度：全书约 ${progress}%`}
              >
                <span>
                  {chapter
                    ? `${currentIndex + 1} / ${chapters.length} 章`
                    : "加载章节"}
                </span>
                {activeClip ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActiveClip(null)}
                  >
                    <X data-icon="inline-start" />
                    退出片段定位
                  </Button>
                ) : (
                  <span>全书约 {progress}%</span>
                )}
                <div className="reader-progress-track">
                  <i style={{ width: `${progress}%` }} />
                </div>
              </div>
              <nav
                className="reader-phone-navigation"
                aria-label="手机阅读操作"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || currentIndex <= 0}
                  onClick={() =>
                    void openChapter(chapters[currentIndex - 1].position)
                  }
                >
                  <ChevronLeft data-icon="inline-start" />
                  上一章
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setNavigationOpen(true)}
                >
                  <List data-icon="inline-start" />
                  目录
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    busy ||
                    currentIndex < 0 ||
                    currentIndex >= chapters.length - 1
                  }
                  onClick={() =>
                    void openChapter(chapters[currentIndex + 1].position)
                  }
                >
                  下一章
                  <ChevronRight data-icon="inline-end" />
                </Button>
              </nav>
              <div className="reader-phone-home" aria-hidden="true" />
            </footer>
          )}
        </div>
      </div>
      {!phoneMode && (
        <div className="reader-status">
          <span>
            {chapter
              ? `${chapter.title} · 全书约 ${progress}%`
              : "阅读位置会自动保存"}
          </span>
          <span>
            {focusMode ? "F / Esc 退出阅读模式" : "阅读位置已自动保存"}
          </span>
          <div className="reader-progress-track">
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      <Dialog
        open={navigationOpen && phoneMode}
        onOpenChange={setNavigationOpen}
      >
        <DialogContent
          className="reader-navigation-dialog sm:max-w-md"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle>阅读导航</DialogTitle>
            <DialogDescription>
              {book.title} · 目录、阅读记录与片段灵感集
            </DialogDescription>
          </DialogHeader>
          {navigation}
        </DialogContent>
      </Dialog>
      {speech.playing && (
        <div className="reader-speech-bar" role="status">
          <Volume2 size={15} />
          <span>朗读中 · 第 {(speech.paragraph ?? 0) + 1} 段</span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={speech.paused ? "继续朗读" : "暂停朗读"}
            onClick={speech.pauseOrResume}
          >
            {speech.paused ? <Play /> : <Pause />}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="停止朗读"
            onClick={speech.stop}
          >
            <Square />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="朗读设置"
            onClick={() => setSpeechOpen(true)}
          >
            <Settings2 />
          </Button>
        </div>
      )}
      <Dialog open={speechOpen} onOpenChange={setSpeechOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>朗读</DialogTitle>
            <DialogDescription>
              从本章开头开始；朗读中可从当前段重读，并自动接读下一章。
            </DialogDescription>
          </DialogHeader>
          <div className="reader-speech-settings">
            <label htmlFor="speech-engine">朗读方式</label>
            <Select
              value={speech.prefs.engine}
              onValueChange={(value) => {
                speech.stop();
                speech.setPrefs((current) => ({
                  ...current,
                  engine: value as "system" | "online",
                }));
              }}
            >
              <SelectTrigger id="speech-engine">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">系统语音 · 无需网络配置</SelectItem>
                <SelectItem value="online">在线朗读 · 内置声音</SelectItem>
              </SelectContent>
            </Select>
            {speech.prefs.engine === "system" ? (
              <>
                <label htmlFor="speech-voice">声音</label>
                <Select
                  value={speech.prefs.voice || "default"}
                  onValueChange={(voice) =>
                    speech.setPrefs((current) => ({
                      ...current,
                      voice: voice === "default" ? "" : voice,
                    }))
                  }
                >
                  <SelectTrigger id="speech-voice">
                    <SelectValue placeholder="系统默认声音" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">系统默认声音</SelectItem>
                    {speech.voices.map((voice) => (
                      <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} · {voice.lang}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : (
              <>
                <label htmlFor="speech-preset">在线声音</label>
                <Select
                  value={speech.prefs.presetId}
                  onValueChange={(presetId) => {
                    speech.stop();
                    speech.setPrefs((current) => ({ ...current, presetId }));
                  }}
                >
                  <SelectTrigger id="speech-preset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {builtInSpeechEngines.map((engine) => (
                      <SelectItem key={engine.id} value={engine.id}>
                        {engine.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">自定义地址 · 高级</SelectItem>
                  </SelectContent>
                </Select>
                {speech.prefs.presetId === "custom" && (
                  <>
                    <label htmlFor="speech-template">自定义引擎地址</label>
                    <Input
                      id="speech-template"
                      value={speech.prefs.template}
                      onChange={(event) =>
                        speech.setPrefs((current) => ({
                          ...current,
                          template: event.target.value,
                        }))
                      }
                      placeholder="https://example.com/tts?text={{speakText}}"
                      spellCheck={false}
                    />
                  </>
                )}
                <p className="reader-speech-hint">
                  内置声音来自 Legado
                  在线朗读引擎集合，已用短文本验证。在线朗读会将当前文字片段发送给声音服务；自定义地址仅支持无需登录的
                  HTTPS 音频接口。
                </p>
              </>
            )}
            <label htmlFor="speech-rate">
              语速 · {speech.prefs.rate.toFixed(1)} 倍
            </label>
            <input
              id="speech-rate"
              type="range"
              min="0.6"
              max="1.8"
              step="0.1"
              value={speech.prefs.rate}
              onChange={(event) =>
                speech.setPrefs((current) => ({
                  ...current,
                  rate: Number(event.target.value),
                }))
              }
            />
            <label className="reader-speech-check">
              <Checkbox
                checked={speech.prefs.autoNext}
                onCheckedChange={(checked) =>
                  speech.setPrefs((current) => ({
                    ...current,
                    autoNext: checked === true,
                  }))
                }
              />
              读完自动接下一章
            </label>
          </div>
          <DialogFooter>
            {speech.playing && (
              <Button variant="outline" onClick={speech.stop}>
                <Square />
                停止
              </Button>
            )}
            <Button
              onClick={() => {
                speech.start(speech.paragraph ?? 0);
                setSpeechOpen(false);
              }}
              disabled={!chapter}
            >
              <Play />
              {speech.playing ? "从当前段重读" : "开始朗读"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {selectedText && chapter && (
        <div className="reader-selection-action">
          <span>
            已选择 {formatExactWords(Array.from(selectedText.quote).length)}
          </span>
          <Button size="sm" onClick={() => openNote(selectedText)}>
            <BookmarkPlus />
            收藏片段
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="取消选区"
            onClick={() => {
              setSelectedText(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <X />
          </Button>
        </div>
      )}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>阅读设置</DialogTitle>
            <DialogDescription>
              选择舒适的纸面、字号和行距；设置只保存在这台设备。
            </DialogDescription>
          </DialogHeader>
          <div className="reader-settings">
            <div>
              <label>背景</label>
              <div className="reader-theme-options">
                {themeOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={
                      prefs.theme === option.value ? "secondary" : "outline"
                    }
                    aria-pressed={prefs.theme === option.value}
                    data-theme-option={option.value}
                    onClick={() => changePrefs({ theme: option.value })}
                  >
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </Button>
                ))}
              </div>
            </div>
            <div className="reader-setting-row">
              <label>字号</label>
              <div>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="缩小字号"
                  disabled={prefs.fontSize <= 14}
                  onClick={() => changePrefs({ fontSize: prefs.fontSize - 1 })}
                >
                  <Minus />
                </Button>
                <output>{prefs.fontSize} px</output>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="放大字号"
                  disabled={prefs.fontSize >= 24}
                  onClick={() => changePrefs({ fontSize: prefs.fontSize + 1 })}
                >
                  <Plus />
                </Button>
              </div>
            </div>
            <div className="reader-setting-row">
              <label>行距</label>
              <div>
                {[
                  { label: "紧凑", value: 1.65 },
                  { label: "标准", value: 1.82 },
                  { label: "舒展", value: 2 },
                ].map((option) => (
                  <Button
                    key={option.value}
                    size="sm"
                    variant={
                      Math.abs(prefs.lineHeight - option.value) < 0.01
                        ? "secondary"
                        : "ghost"
                    }
                    aria-pressed={
                      Math.abs(prefs.lineHeight - option.value) < 0.01
                    }
                    onClick={() => changePrefs({ lineHeight: option.value })}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="reader-setting-row">
              <label>段距</label>
              <div>
                {[
                  { label: "紧凑", value: 0.4 },
                  { label: "标准", value: 0.72 },
                  { label: "舒展", value: 1.1 },
                ].map((option) => (
                  <Button
                    key={option.value}
                    size="sm"
                    variant={
                      Math.abs(prefs.paragraphGap - option.value) < 0.01
                        ? "secondary"
                        : "ghost"
                    }
                    aria-pressed={
                      Math.abs(prefs.paragraphGap - option.value) < 0.01
                    }
                    onClick={() => changePrefs({ paragraphGap: option.value })}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="reader-setting-row">
              <label>字体</label>
              <div>
                <Button
                  size="sm"
                  variant={!prefs.serif ? "secondary" : "ghost"}
                  aria-pressed={!prefs.serif}
                  onClick={() => changePrefs({ serif: false })}
                >
                  系统字体
                </Button>
                <Button
                  size="sm"
                  variant={prefs.serif ? "secondary" : "ghost"}
                  aria-pressed={prefs.serif}
                  onClick={() => changePrefs({ serif: true })}
                >
                  宋体
                </Button>
              </div>
            </div>
            {!phoneMode && (
              <div className="reader-setting-row">
                <label>页宽</label>
                <div>
                  {[
                    { label: "收窄", value: 640 },
                    { label: "标准", value: 740 },
                    { label: "加宽", value: 860 },
                  ].map((option) => (
                    <Button
                      key={option.value}
                      size="sm"
                      variant={
                        prefs.columnWidth === option.value
                          ? "secondary"
                          : "ghost"
                      }
                      aria-pressed={prefs.columnWidth === option.value}
                      onClick={() => changePrefs({ columnWidth: option.value })}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPrefs(defaultReaderPrefs)}
            >
              恢复默认
            </Button>
            <Button onClick={() => setSettingsOpen(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导出《{book.title}》</DialogTitle>
            <DialogDescription>
              将已保存章节导出到系统下载目录。
            </DialogDescription>
          </DialogHeader>
          <div className="reader-export-options">
            <Button
              variant="outline"
              disabled={!!exporting}
              onClick={() => void doExport("txt")}
            >
              {exporting === "txt" ? (
                <LoaderCircle className="spin" />
              ) : (
                <FileText />
              )}
              导出 TXT
            </Button>
            <Button
              variant="outline"
              disabled={!!exporting}
              onClick={() => void doExport("docx")}
            >
              {exporting === "docx" ? (
                <LoaderCircle className="spin" />
              ) : (
                <FileText />
              )}
              导出 Word
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!noteDraft}
        onOpenChange={(open) => {
          if (!open && !savingClip) setNoteDraft(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {noteDraft?.clipId ? "编辑片段备注" : "收藏片段"}
            </DialogTitle>
            <DialogDescription>
              收藏到《{book.title}》的片段灵感集，仅保存在本地。
            </DialogDescription>
          </DialogHeader>
          <blockquote className="reader-note-quote">
            {noteDraft?.quote}
          </blockquote>
          <div className="reader-note-editor">
            <label htmlFor="reader-note">备注（可选）</label>
            <Textarea
              id="reader-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              placeholder="这一段哪里打动你？想借鉴什么写法？"
            />
            <small>{Array.from(note).length} / 2000 字</small>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={savingClip}
              onClick={() => setNoteDraft(null)}
            >
              取消
            </Button>
            <Button disabled={savingClip} onClick={() => void saveNote()}>
              {savingClip && <LoaderCircle className="spin" />}
              <Check />
              {noteDraft?.clipId ? "保存备注" : "收藏片段"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条片段收藏？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除所选片段和备注，正文不会改变。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void deleteClip()}
            >
              {deleting && <LoaderCircle className="spin" />}删除收藏
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
