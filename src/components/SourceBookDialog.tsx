import {
  formatWordCount,
  formatSourceWordCount,
  sourceWordCountNote,
} from "../lib/word-count";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  createBook,
  extractLegadoBook,
  listenDownloadProgress,
  previewLegadoChapter,
  previewLegadoToc,
} from "../lib/tauri";
import type { DownloadProgress } from "../lib/tauri";
import type {
  BookSummary,
  LegadoSearchResult,
  RemoteChapter,
  RemoteChapterDetail,
} from "../types";
import { useDialogFocus } from "../hooks/use-dialog-focus";
import { BookCover } from "./BookCover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function SourceBookDialog({
  book,
  agreed,
  setAgreed,
  onCreated,
  onClose,
}: {
  book: LegadoSearchResult;
  agreed: boolean;
  setAgreed: (value: boolean) => void;
  onCreated: (book: BookSummary) => Promise<void>;
  onClose: () => void;
}) {
  const restoreFocus = useDialogFocus();
  const live = useRef(true);
  const locked = useRef(false);
  const article = useRef<HTMLElement>(null);
  const [chapters, setChapters] = useState<RemoteChapter[]>([]);
  const [chapter, setChapter] = useState<RemoteChapterDetail | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const [savingBook, setSavingBook] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<"toc" | "chapter" | "download" | "">("");
  const [error, setError] = useState("");
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    article.current?.scrollTo(0, 0);
  }, [chapter, preview]);
  const run = async (
    kind: "toc" | "chapter" | "download",
    task: () => Promise<void>,
  ) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(kind);
    setError("");
    try {
      await task();
    } catch (e) {
      if (live.current) setError(message(e));
    } finally {
      locked.current = false;
      if (live.current) setBusy("");
    }
  };
  const loadToc = () => {
    setPreview(true);
    if (chapters.length) return;
    void run("toc", async () => {
      const value = await previewLegadoToc({
        sourceKey: book.sourceKey,
        bookUrl: book.bookUrl,
      });
      if (live.current) setChapters(value);
    });
  };
  const loadChapter = (item: RemoteChapter) =>
    void run("chapter", async () => {
      const value = await previewLegadoChapter(
        book.sourceKey,
        item.chapterUrl,
        item.title,
      );
      if (live.current) {
        setChapter(value);
        setPosition(item.position);
      }
    });
  const importBook = () => {
    if (!agreed || !book.importCompatible) return;
    void run("download", async () => {
      const progressId = crypto.randomUUID();
      setDownloadProgress({
        progressId,
        completed: 0,
        total: 0,
        failed: 0,
        phase: "catalog",
      });
      const unlisten = await listenDownloadProgress((progress) => {
        if (live.current && progress.progressId === progressId)
          setDownloadProgress(progress);
      });
      try {
        const extracted = await extractLegadoBook({
          sourceKey: book.sourceKey,
          bookUrl: book.bookUrl,
          title: book.title,
          maxChapters: 0,
          progressId,
        });
        if (
          extracted.receipt.downloadedChapters !==
            extracted.receipt.totalChapters ||
          extracted.receipt.failedChapters
        ) {
          throw new Error(
            `${extracted.receipt.failedChapters} 章下载失败，书籍未加入书架。请重试或更换书源。`,
          );
        }
        setSavingBook(true);
        const created = await createBook({
          title: extracted.title,
          sourceType: "legado",
          sourceUri: `${extracted.sourceName} · ${extracted.sourceUri}`,
          content: extracted.content,
          downloadReceipt: extracted.receipt,
        });
        await onCreated(created);
      } finally {
        unlisten();
        if (live.current) setSavingBook(false);
      }
    });
  };
  const index = chapters.findIndex((item) => item.position === position);
  const visible = chapters.filter((item) =>
    item.title.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && busy !== "download") onClose();
      }}
    >
      <DialogContent
        className="book-preview-dialog"
        showCloseButton={false}
        onCloseAutoFocus={restoreFocus}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (busy === "download") e.preventDefault();
        }}
      >
        <DialogHeader className="book-preview-header">
          <BookCover title={book.title} url={book.coverUrl} />
          <div>
            <DialogTitle>{book.title}</DialogTitle>
            <DialogDescription>
              {book.author || "作者未知"} · {book.sourceName} ·{" "}
              <span title={sourceWordCountNote}>
                {formatSourceWordCount(book.wordCount)}
              </span>
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="关闭预览"
            disabled={busy === "download"}
            onClick={onClose}
          >
            <X />
          </Button>
        </DialogHeader>
        <div className="book-preview-nav">
          <div>
            <Button
              variant={preview ? "ghost" : "secondary"}
              size="sm"
              aria-pressed={!preview}
              onClick={() => setPreview(false)}
            >
              作品简介
            </Button>
            <Button
              variant={preview ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={preview}
              disabled={!book.importCompatible || !!busy}
              onClick={loadToc}
            >
              <BookOpen data-icon="inline-start" />
              预览目录
            </Button>
          </div>
          <span>
            {chapters.length
              ? `${chapters.length.toLocaleString()} 章 · 在线预览`
              : "预览后再决定是否导入"}
          </span>
        </div>
        {error && (
          <Alert variant="destructive" className="book-preview-error">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div
          className={
            preview ? "book-preview-body reading" : "book-preview-body"
          }
        >
          {preview && (
            <aside className="book-preview-toc">
              <InputGroup>
                <InputGroupInput
                  aria-label="筛选章节"
                  placeholder="筛选章节…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </InputGroup>
              <nav aria-label="在线目录">
                {visible.map((item) => (
                  <Button
                    key={item.position}
                    variant={position === item.position ? "secondary" : "ghost"}
                    disabled={!!busy}
                    aria-current={
                      position === item.position ? "true" : undefined
                    }
                    onClick={() => loadChapter(item)}
                  >
                    <span>{item.position + 1}</span>
                    {item.title}
                  </Button>
                ))}
                {!visible.length && (
                  <p>
                    {busy === "toc"
                      ? "正在读取目录…"
                      : chapters.length
                        ? "没有匹配章节"
                        : "尚未加载目录"}
                  </p>
                )}
              </nav>
              {!chapters.length && busy !== "toc" && (
                <Button variant="outline" onClick={loadToc}>
                  重新读取目录
                </Button>
              )}
            </aside>
          )}
          <article
            ref={article}
            className="book-preview-prose"
            aria-busy={busy === "toc" || busy === "chapter"}
          >
            {!preview ? (
              <>
                <span className="field-note">作品简介</span>
                <p className="book-synopsis">
                  {book.intro ||
                    "这个书源暂未提供简介，可以通过目录预览了解作品。"}
                </p>
                {!book.importCompatible && (
                  <Alert>
                    <AlertCircle />
                    <AlertDescription>
                      此书源仅支持搜索，请选择标有「可导入」的其他书源。
                    </AlertDescription>
                  </Alert>
                )}
                {book.importCompatible && (
                  <Button variant="outline" onClick={loadToc} disabled={!!busy}>
                    <BookOpen data-icon="inline-start" />
                    查看目录与试读
                  </Button>
                )}
              </>
            ) : busy === "toc" || busy === "chapter" ? (
              <div className="source-result-empty" role="status">
                <LoaderCircle className="spin" />
                <b>{busy === "toc" ? "正在读取目录…" : "正在读取章节…"}</b>
              </div>
            ) : chapter ? (
              <>
                <h3>{chapter.title}</h3>
                <span className="field-note">
                  {formatWordCount(chapter.characterCount)} · 在线试读
                </span>
                <div className="preview-chapter-text">
                  {chapter.content.split("\n").map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
                <div className="preview-chapter-actions">
                  <Button
                    variant="outline"
                    disabled={index <= 0 || !!busy}
                    onClick={() => loadChapter(chapters[index - 1])}
                  >
                    <ChevronLeft data-icon="inline-start" />
                    上一章
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      index < 0 || index >= chapters.length - 1 || !!busy
                    }
                    onClick={() => loadChapter(chapters[index + 1])}
                  >
                    下一章
                    <ChevronRight data-icon="inline-end" />
                  </Button>
                </div>
              </>
            ) : (
              <div className="source-result-empty">
                <BookOpen />
                <b>选择章节开始试读</b>
                <span>预览不会将正文加入书架。</span>
              </div>
            )}
          </article>
        </div>
        {busy === "download" && (
          <div className="book-download-progress" role="status">
            <div>
              <strong>
                {savingBook
                  ? "正在保存到本地书架"
                  : downloadProgress?.total
                    ? "正在下载全书正文"
                    : "正在读取完整目录"}
              </strong>
              <span>
                {downloadProgress?.total
                  ? `${downloadProgress.completed} / ${downloadProgress.total} 章 · ${Math.round((downloadProgress.completed / downloadProgress.total) * 100)}%${downloadProgress.failed ? ` · ${downloadProgress.failed} 章失败` : ""}`
                  : "目录读取完成后显示章节进度"}
              </span>
            </div>
            <Progress
              value={
                downloadProgress?.total
                  ? (downloadProgress.completed / downloadProgress.total) * 100
                  : 0
              }
              aria-label="全书下载进度"
            />
          </div>
        )}
        <footer className="book-preview-footer">
          <Field orientation="horizontal" className="consent compact">
            <Checkbox
              id="source-consent"
              checked={agreed}
              disabled={!!busy}
              onCheckedChange={(value) => setAgreed(value === true)}
            />
            <FieldLabel htmlFor="source-consent">
              我拥有合法阅读与私人分析权限
            </FieldLabel>
          </Field>
          <div className="book-import-actions">
            <span className="field-note">加入时下载目录全部章节</span>
            <Button
              disabled={!book.importCompatible || !agreed || !!busy}
              onClick={importBook}
            >
              {busy === "download" ? (
                <LoaderCircle className="spin" data-icon="inline-start" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              {busy === "download" ? "正在下载…" : "加入书架"}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
