import { formatSourceWordCount, sourceWordCountNote } from "./lib/word-count";
import {
  AlertCircle,
  ChevronRight,
  LoaderCircle,
  Network,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  getLegadoSourceStatus,
  isTauri,
  searchLegadoBooks,
  syncLegadoSources,
} from "./lib/tauri";
import type {
  BookSummary,
  LegadoSearchResult,
  LegadoSourceStatus,
} from "./types";
import { BookCover } from "./components/BookCover";
import { defaultSources, SourcePicker } from "./components/SourcePicker";
import { SourceBookDialog } from "./components/SourceBookDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function SourceSearch({
  agreed,
  setAgreed,
  onCreated,
}: {
  agreed: boolean;
  setAgreed: (value: boolean) => void;
  onCreated: (book: BookSummary) => Promise<void>;
}) {
  const [status, setStatus] = useState<LegadoSourceStatus | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"keyword" | "author">("keyword");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [results, setResults] = useState<LegadoSearchResult[]>([]);
  const [searched, setSearched] = useState<{
    query: string;
    mode: string;
    count: number;
  } | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [chosen, setChosen] = useState<LegadoSearchResult | null>(null);
  const [onlyImportable, setOnlyImportable] = useState(false);
  const [busy, setBusy] = useState<"load" | "sync" | "search" | "">("load");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    let active = true;
    if (!isTauri()) {
      setBusy("");
      return;
    }
    void (async () => {
      try {
        let next = await getLegadoSourceStatus();
        if (next.installed && next.repositoryUrl.includes("71e56d4f"))
          next = await syncLegadoSources();
        if (active) {
          setStatus(next);
          setSelectedSources(defaultSources(next.sources));
        }
      } catch (e) {
        if (active) setError(errorText(e));
      } finally {
        if (active) setBusy("");
      }
    })();
    return () => {
      active = false;
      live.current = false;
    };
  }, []);

  const sync = async () => {
    if (busy || locked.current) return;
    locked.current = true;
    setBusy("sync");
    setError("");
    try {
      const next = await syncLegadoSources();
      if (!live.current) return;
      setStatus(next);
      // Retain explicit choices, including an intentionally empty selection.
      setSelectedSources((keys) =>
        status?.installed
          ? keys.filter((key) =>
              next.sources.some(
                (source) => source.key === key && source.searchCompatible,
              ),
            )
          : defaultSources(next.sources),
      );
    } catch (e) {
      if (live.current) setError(errorText(e));
    } finally {
      locked.current = false;
      if (live.current) setBusy("");
    }
  };
  const search = async () => {
    if (!query.trim() || !selectedSources.length || busy || locked.current)
      return;
    locked.current = true;
    setBusy("search");
    setError("");
    setChosen(null);
    setResults([]);
    setFailed([]);
    setSearched(null);
    const keyword = query.trim();
    try {
      const response = await searchLegadoBooks(keyword, selectedSources, mode);
      if (!live.current) return;
      setResults(response.results);
      setFailed(response.failedSources);
      setSearched({ query: keyword, mode, count: response.searchedSources });
    } catch (e) {
      if (live.current) setError(errorText(e));
    } finally {
      locked.current = false;
      if (live.current) setBusy("");
    }
  };
  const visibleResults = onlyImportable
    ? results.filter((result) => result.importCompatible)
    : results;

  if (busy === "load")
    return (
      <div className="loading-state" role="status">
        <LoaderCircle className="spin" size={20} />
        正在读取书源…
      </div>
    );
  if (!status?.installed)
    return (
      <Empty className="source-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Network />
          </EmptyMedia>
          <EmptyTitle>连接你的书源</EmptyTitle>
          <EmptyDescription>
            同步 Legado 书源后，即可搜索书名或作者、预览章节并加入书架。
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button disabled={!!busy || !isTauri()} onClick={() => void sync()}>
            <RefreshCw data-icon="inline-start" />
            {busy === "sync" ? "正在同步…" : "同步书源"}
          </Button>
          <span className="field-note">
            {isTauri()
              ? "使用 aoaostar / Legado 书源集合"
              : "请在桌面客户端中连接书源"}
          </span>
          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </EmptyContent>
      </Empty>
    );

  return (
    <div className="source-workspace">
      <div className="source-search-panel">
        <form
          className="source-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Select
            value={mode}
            disabled={!!busy}
            onValueChange={(value) => setMode(value as "keyword" | "author")}
          >
            <SelectTrigger aria-label="搜索方式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="keyword">书名 / 关键词</SelectItem>
                <SelectItem value="author">作者</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="搜索小说"
              placeholder={
                mode === "author"
                  ? "输入作者名，查找作品…"
                  : "输入书名或关键词…"
              }
              value={query}
              disabled={!!busy}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
          <Button disabled={!query.trim() || !selectedSources.length || !!busy}>
            {busy === "search" ? (
              <LoaderCircle className="spin" data-icon="inline-start" />
            ) : (
              <Search data-icon="inline-start" />
            )}
            搜索
          </Button>
        </form>
        <div className="source-scope-bar">
          <div>
            <SourcePicker
              sources={status.sources}
              selected={selectedSources}
              onChange={setSelectedSources}
              disabled={!!busy}
            />
            <span className="field-note">
              {status.searchable.toLocaleString()} 个可搜索 · 单次最多 60 个
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={!!busy}
            onClick={() => void sync()}
          >
            <RefreshCw
              data-icon="inline-start"
              className={busy === "sync" ? "spin" : ""}
            />
            {busy === "sync" ? "同步中…" : "同步书源"}
          </Button>
        </div>
        {mode === "author" && (
          <p className="source-search-hint">
            按书源返回的作者字段匹配；部分书源只支持书名检索，或未提供作者信息。
          </p>
        )}
        {!selectedSources.length && (
          <p className="source-search-hint">
            请先在「书源范围」中选择至少一个书源。
          </p>
        )}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <section
        className="source-results-panel"
        aria-label="搜索结果"
        aria-busy={busy === "search"}
      >
        <header className="source-results-header">
          <div>
            <b>搜索结果</b>
            <span role="status">
              {searched
                ? `「${searched.query}」· ${visibleResults.length} 项 · 已搜索 ${searched.count} 个书源`
                : "选择作品，查看简介与试读"}
            </span>
          </div>
          <Label className="source-result-filter">
            <Checkbox
              checked={onlyImportable}
              onCheckedChange={(value) => setOnlyImportable(value === true)}
            />
            仅看可导入
          </Label>
        </header>
        {busy === "search" ? (
          <div className="source-result-empty" role="status">
            <LoaderCircle className="spin" size={25} />
            <b>正在搜索 {selectedSources.length} 个书源</b>
            <span>各书源响应速度不同，选中较多时可能需要等待几分钟。</span>
          </div>
        ) : !visibleResults.length ? (
          <Empty className="source-result-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
              <EmptyTitle>
                {searched ? "没有找到匹配的作品" : "查找一本想读的书"}
              </EmptyTitle>
              <EmptyDescription>
                {searched
                  ? onlyImportable && results.length
                    ? "当前结果不支持导入，可取消「仅看可导入」查看。"
                    : searched.mode === "author"
                      ? "试试作者全名，或切换其他书源。部分书源不支持作者检索。"
                      : "试试更简短的书名，或调整搜索书源。"
                  : "搜索书名或作者，点击结果即可预览并加入书架。"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="source-book-list">
            {visibleResults.map((result) => (
              <Button
                key={`${result.sourceKey}-${result.bookUrl}`}
                variant="ghost"
                className="source-book-row"
                onClick={() => setChosen(result)}
                aria-haspopup="dialog"
              >
                <BookCover title={result.title} url={result.coverUrl} />
                <span className="source-book-text">
                  <span className="source-book-title">{result.title}</span>
                  <span className="source-book-author">
                    {result.author || "作者未知"}
                    <span>·</span>
                    {result.sourceName}
                    <span>·</span>
                    <span title={sourceWordCountNote}>
                      {formatSourceWordCount(result.wordCount)}
                    </span>
                  </span>
                  {result.intro && (
                    <span className="source-book-intro">{result.intro}</span>
                  )}
                </span>
                <span className="source-book-action">
                  <Badge variant="secondary">
                    {result.importCompatible ? "可导入" : "仅搜索"}
                  </Badge>
                  <ChevronRight size={16} />
                </span>
              </Button>
            ))}
          </div>
        )}
        {!!failed.length && (
          <details className="source-failures">
            <summary>{failed.length} 个书源搜索失败 · 查看原因</summary>
            {failed.map((item, i) => (
              <p key={i}>{item}</p>
            ))}
          </details>
        )}
      </section>
      {chosen && (
        <SourceBookDialog
          book={chosen}
          agreed={agreed}
          setAgreed={setAgreed}
          onCreated={onCreated}
          onClose={() => setChosen(null)}
        />
      )}
    </div>
  );
}
