import { countText, formatWordCount } from "./lib/word-count";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Check,
  FileText,
  KeyRound,
  LoaderCircle,
  Search,
  UploadCloud,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { SourceSearch } from "./SourceSearch";
import { createBook } from "./lib/tauri";
import type { BookSummary } from "./types";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ImportMode = "source" | "file" | "text";
const modes = [
  { id: "source", label: "书源搜索", icon: Search },
  { id: "file", label: "本地文件", icon: UploadCloud },
  { id: "text", label: "粘贴正文", icon: FileText },
] as const;

export function ImportView({
  selected,
  modelReady,
  onSettings,
  onCreated,
  onRun,
}: {
  selected: BookSummary | null;
  modelReady: boolean;
  onSettings: () => void;
  onCreated: (book: BookSummary) => Promise<void>;
  onRun: (book: BookSummary) => Promise<void>;
}) {
  const [mode, setMode] = useState<ImportMode>("source");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const wordCount = useMemo(() => countText(content.trim()), [content]);
  const [fileName, setFileName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRequest = useRef(0);
  const readFile = async (file?: File) => {
    if (!file) return;
    const request = ++fileRequest.current;
    setError("");
    setReading(false);
    if (!/\.(txt|md)$/i.test(file.name)) {
      setError("请选择 TXT 或 Markdown 文件。");
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      if (request !== fileRequest.current) return;
      setFileName(file.name);
      setTitle(file.name.replace(/\.(txt|md)$/i, ""));
      setContent(text);
    } catch {
      if (request === fileRequest.current)
        setError("文件读取失败，请重新选择。");
    } finally {
      if (request === fileRequest.current) setReading(false);
    }
  };
  const valid =
    agreed && mode !== "source" && !!title.trim() && wordCount >= 80;
  const submit = async () => {
    if (!valid || busy || reading) return;
    setBusy(true);
    setError("");
    try {
      await onCreated(
        await createBook({
          title: title.trim(),
          sourceType: mode === "file" ? "file" : "text",
          sourceUri: fileName,
          content,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (selected)
    return (
      <div className="page import-page">
        <Empty className="ready-book">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpen />
            </EmptyMedia>
            <EmptyTitle>《{selected.title}》已加入书架</EmptyTitle>
            <EmptyDescription>
              共 {formatWordCount(selected.characterCount)}，可以开始拆书分析。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => (modelReady ? void onRun(selected) : onSettings())}
            >
              {modelReady ? <BrainCircuit size={16} /> : <KeyRound size={16} />}
              {modelReady ? "开始分析" : "配置分析模型"}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  return (
    <div className="page import-page">
      <header className="page-heading">
        <div>
          <h1>添加书籍</h1>
          <p>搜索在线书源，或导入已有的小说正文。</p>
        </div>
      </header>
      <Tabs
        className="import-modes"
        value={mode}
        onValueChange={(value) => {
          setMode(value as ImportMode);
          setError("");
        }}
      >
        <TabsList variant="line" className="import-mode-tabs" aria-label="导入方式">
          {modes.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} disabled={busy}>
              <Icon data-icon="inline-start" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="source">
          <SourceSearch
            agreed={agreed}
            setAgreed={setAgreed}
            onCreated={onCreated}
          />
        </TabsContent>
        <TabsContent value={mode === "source" ? "file" : mode}>
          <form
            className="import-body"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="form-heading">
              <h2>{mode === "file" ? "导入本地文件" : "粘贴小说正文"}</h2>
              <p>
                {mode === "file"
                  ? "支持 TXT、Markdown 格式，导入后即可阅读和分析。"
                  : "输入作品名与正文，系统会自动识别章节。"}
              </p>
            </div>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="book-title">作品名</FieldLabel>
                <Input
                  id="book-title"
                  value={title}
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="输入作品名"
                  required
                />
              </Field>
              {mode === "file" && (
                <>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    hidden
                    onChange={(e) => {
                      void readFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    disabled={busy || reading}
                    variant="outline"
                    className={cn("dropzone", dragging && "dragging")}
                    onClick={() => inputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      if (!busy) void readFile(e.dataTransfer.files[0]);
                    }}
                  >
                    <div className="empty-icon">
                      {reading ? (
                        <LoaderCircle size={24} className="spin" />
                      ) : fileName ? (
                        <Check size={24} />
                      ) : (
                        <UploadCloud size={24} />
                      )}
                    </div>
                    <strong>
                      {reading
                        ? "正在读取文件…"
                        : fileName || "将文件拖到此处，或点击选择"}
                    </strong>
                    <span>
                      {fileName
                        ? `${formatWordCount(wordCount)} · 点击更换文件`
                        : "TXT 或 Markdown"}
                    </span>
                  </Button>
                </>
              )}
              {mode === "text" && (
                <Field>
                  <FieldLabel htmlFor="book-content">小说正文</FieldLabel>
                  <Textarea
                    id="book-content"
                    className="min-h-64"
                    value={content}
                    disabled={busy}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="粘贴正文，至少 80 字（含标点）…"
                    required
                  />
                  <FieldDescription>
                    {formatWordCount(wordCount)} · 含标点，至少需要 80 字
                  </FieldDescription>
                </Field>
              )}
            </FieldGroup>
            {content.length > 0 && wordCount < 80 && (
              <p className="field-note">正文至少需要 80 字（含标点）。</p>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field orientation="horizontal" className="consent">
              <Checkbox
                id="import-consent"
                checked={agreed}
                disabled={busy}
                onCheckedChange={(value) => setAgreed(value === true)}
              />
              <FieldLabel htmlFor="import-consent">
                我确认对该内容拥有合法阅读和私人分析权限。
              </FieldLabel>
            </Field>
            <div className="form-footer">
              <span>书籍将保存在本机</span>
              <Button disabled={!valid || busy || reading}>
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <ArrowRight size={16} />
                )}{" "}
                {busy ? "正在导入…" : "加入书架"}
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
