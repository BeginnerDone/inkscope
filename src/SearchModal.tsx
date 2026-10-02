import { BookStatus } from "@/components/BookStatus";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { isTauri, listBooks } from "@/lib/tauri";
import type { BookSummary } from "@/types";
import { BookOpen, LoaderCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";

export function SearchModal({
  onClose,
  books,
  onOpen,
}: {
  onClose: () => void;
  books: BookSummary[];
  onOpen: (book: BookSummary) => void;
}) {
  const restoreFocus = useDialogFocus();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(books);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!query.trim()) {
      setResults(books);
      setLoading(false);
      setError("");
      return;
    }
    if (!isTauri()) {
      setResults([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const next = await listBooks(query);
        if (active) setResults(next);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, books]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl" onCloseAutoFocus={restoreFocus}>
        <DialogHeader>
          <DialogTitle>搜索书库</DialogTitle>
          <DialogDescription>查找已导入的书籍与分析内容。</DialogDescription>
        </DialogHeader>
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            aria-label="搜索书库内容"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索书名、人物、手法或灵感…"
          />
        </InputGroup>
        <div className="search-results" aria-busy={loading}>
          {loading ? (
            <div className="list-empty" role="status">
              <LoaderCircle className="spin" size={18} />
              正在搜索…
            </div>
          ) : (
            results.map((book) => (
              <Button
                variant="ghost"
                className="search-result"
                key={book.id}
                onClick={() => onOpen(book)}
              >
                <BookOpen data-icon="inline-start" />
                <div>
                  <b>{book.title}</b>
                  <span>
                    {book.report?.coreJudgment || book.stage || "已保存正文"}
                  </span>
                </div>
                <BookStatus status={book.status} />
              </Button>
            ))
          )}
          {!loading && !results.length && (
            <div className="list-empty">
              {query ? "没有找到匹配的书籍" : "书库中还没有书籍"}
            </div>
          )}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}
