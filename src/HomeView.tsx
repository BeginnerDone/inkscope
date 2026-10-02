import { formatWordCount } from "./lib/word-count";
import { BookStatus } from "@/components/BookStatus";
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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import type { BookSummary } from "@/types";
import {
  BarChart3,
  BookOpen,
  BrainCircuit,
  FolderOpen,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";

const sourceLabels = {
  text: "粘贴正文",
  file: "本地文件",
  link: "链接导入",
  legado: "在线书源",
};

export function HomeView({
  books,
  loading,
  onNew,
  onRead,
  onAnalyze,
  onReport,
  onDelete,
}: {
  books: BookSummary[];
  loading: boolean;
  onNew: () => void;
  onRead: (book: BookSummary) => void;
  onAnalyze: (book: BookSummary) => void;
  onReport: (book: BookSummary) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<BookSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const visible = books.filter((book) =>
    book.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };
  return (
    <div className="page home-page">
      <header className="page-heading">
        <div>
          <h1>我的书架</h1>
          <p>阅读、拆解，积累属于你的写作素材。</p>
        </div>
        <Button onClick={onNew}>
          <Plus data-icon="inline-start" />
          添加书籍
        </Button>
      </header>
      <div className="library-toolbar">
        <div className="library-summary">
          <span>
            <b>{books.length}</b> 本书籍
          </span>
          <span>
            <b>{books.filter((book) => book.status === "completed").length}</b>{" "}
            份报告
          </span>
        </div>
        <InputGroup className="library-search">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="筛选书架"
            placeholder="搜索书架…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
      </div>
      {loading ? (
        <div className="project-grid" role="status" aria-label="正在读取书架">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : visible.length ? (
        <div className="project-grid">
          {visible.map((book) => (
            <Card key={book.id} className="book-card" size="sm">
              <CardHeader>
                <div className="book-card-top">
                  <div className="book-glyph" aria-hidden="true">
                    <BookOpen size={20} />
                  </div>
                  <BookStatus status={book.status} />
                </div>
                <CardTitle>
                  <Button
                    variant="link"
                    className="book-title-link h-auto justify-start p-0"
                    onClick={() => onRead(book)}
                  >
                    {book.title}
                  </Button>
                </CardTitle>
                <CardDescription>
                  {sourceLabels[book.sourceType]} ·{" "}
                  <span
                    title={`${book.characterCount.toLocaleString()} 字（含标点和空白）`}
                  >
                    {formatWordCount(book.characterCount)}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="book-summary">
                  {book.report?.coreJudgment ||
                    book.stage ||
                    "已保存正文，随时开始阅读。"}
                </p>
                {book.readingChapterPosition != null && (
                  <span className="book-reading-progress">
                    已读至第 {book.readingChapterPosition + 1} 章 · 本章 {Math.round((book.readingRatio ?? 0) * 100)}%
                  </span>
                )}
                <span className="book-date">
                  更新于 {new Date(book.updatedAt).toLocaleDateString()}
                </span>
              </CardContent>
              <CardFooter className="book-card-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRead(book)}
                >
                  <BookOpen data-icon="inline-start" />
                  {book.readingChapterPosition != null ? "继续阅读" : "阅读"}
                </Button>
                {book.report ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onReport(book)}
                  >
                    <BarChart3 data-icon="inline-start" />
                    报告
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onAnalyze(book)}
                    disabled={book.status === "analyzing"}
                  >
                    <BrainCircuit data-icon="inline-start" />
                    {book.status === "failed" ? "继续分析" : "分析"}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  aria-label={`删除${book.title}`}
                  onClick={(event) => {
                    deleteTrigger.current = event.currentTarget;
                    setDeleteError("");
                    setDeleteTarget(book);
                  }}
                >
                  <Trash2 />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Empty className="library-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>
              {query ? "没有找到这本书" : "从第一本书开始"}
            </EmptyTitle>
            <EmptyDescription>
              {query
                ? "换一个关键词，或清空筛选查看全部书籍。"
                : "搜索在线书源或导入本地文本，在这里阅读并探索故事的写法。"}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              onClick={query ? () => setQuery("") : onNew}
            >
              {query ? (
                "清空筛选"
              ) : (
                <>
                  <Plus data-icon="inline-start" />
                  添加第一本书
                </>
              )}
            </Button>
          </EmptyContent>
        </Empty>
      )}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (deleteTrigger.current?.isConnected)
              deleteTrigger.current.focus();
            else
              document
                .querySelector<HTMLInputElement>('[aria-label="筛选书架"]')
                ?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>删除《{deleteTarget?.title}》？</AlertDialogTitle>
            <AlertDialogDescription>
              这将永久删除该书的正文、分析缓存和报告，无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting && (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
              )}
              {deleting ? "正在删除…" : "删除书籍"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
