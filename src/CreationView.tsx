import { CreationWorkbench } from "./CreationWorkbench";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, LoaderCircle, PenLine, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

import { countText } from "./lib/word-count";

import { createCreation, deleteCreation, getCreation, listCreations, type CreationProject, type CreationSummary } from "./lib/creation";
import type { BookSummary, ModelConfig } from "./types";

export type CreationSeed = {
  title: string;
  genre: string;
  audience: string;
  seed: string;
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const date = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function CreationView({
  books,
  config,
  onSettings,
  seed,
  onSeedConsumed,
  onFocusChange,
}: {
  books: BookSummary[];
  config: ModelConfig;
  onSettings: () => void;
  seed: CreationSeed | null;
  onSeedConsumed: () => void;
  onFocusChange: (value: boolean) => void;
}) {
  const [projects, setProjects] = useState<CreationSummary[]>([]);
  const [project, setProject] = useState<CreationProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CreationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const remove = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true); setDeleteError("");
    try {
      await deleteCreation(deleteTarget.id, deleteTarget.revision);
      for (const key of ["draft", "conflict"]) {
        try { localStorage.removeItem(`inkscope-creation-${key}-${deleteTarget.id}`); } catch { /* Database deletion remains authoritative. */ }
      }
      setProjects((items) => items.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null); toast.success("作品及关联记录已删除");
    } catch (e) { setDeleteError(message(e)); void refresh(); }
    finally { setDeleting(false); }
  };
  const refresh = useCallback(async () => {
    try {
      setProjects(await listCreations());
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (seed) setCreating(true);
  }, [seed]);
  const open = async (id: string) => {
    try {
      setProject(await getCreation(id));
      setError("");
    } catch (e) {
      setError(message(e));
    }
  };
  const visible = projects.filter((p) =>
    `${p.title} ${p.genre}`.includes(query.trim()),
  );
  if (project)
    return (
      <>
        <CreationWorkbench
          key={project.id}
          initial={project}
          books={books}
          config={config}
          onSettings={onSettings}
          onFocusChange={onFocusChange}
          onBack={() => {
            setProject(null);
            onFocusChange(false);
            void refresh();
          }}
        />
        {seed && (
          <NewCreationDialog
            books={books}
            seed={seed}
            onClose={() => {
              setCreating(false);
              onSeedConsumed();
            }}
            onCreated={(next) => {
              onSeedConsumed();
              setCreating(false);
              setProject(next);
            }}
          />
        )}
      </>
    );
  return (
    <div className="page creation-list">
      <header className="page-heading">
        <div>
          <h1>创作空间</h1>
          <p>从一个想法开始，把故事写成自己的长篇。</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus data-icon="inline-start" />
          新建作品
        </Button>
      </header>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            <Button variant="ghost" size="sm" onClick={() => void refresh()}>
              重试
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="creation-list-toolbar">
        <Input
          aria-label="搜索创作作品"
          placeholder="搜索作品或题材…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span>{projects.length} 部作品 · 保存在本机</span>
      </div>
      {loading ? (
        <Skeleton className="h-40" />
      ) : !visible.length ? (
        <Empty className="creation-list-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PenLine />
            </EmptyMedia>
            <EmptyTitle>
              {query ? "没有找到作品" : "开始写你的第一部作品"}
            </EmptyTitle>
            <EmptyDescription>
              可以从灵感策划开始，也可以导入自己的 TXT、Markdown 稿件继续写作。
            </EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" onClick={() => setCreating(true)}>
            新建作品
          </Button>
        </Empty>
      ) : (
        <div className="creation-projects">
          {visible.map((p) => (
            <div className="creation-project-item" key={p.id}>
            <button
              className="creation-project-row"
              key={p.id}
              onClick={() => void open(p.id)}
            >
              <div className="creation-project-icon">
                <PenLine />
              </div>
              <div>
                <strong>{p.title}</strong>
                <p>
                  {p.genre || "题材待定"} · {p.chapterCount} 章 ·{" "}
                  {p.wordCount.toLocaleString()} 字
                </p>
              </div>
              <small>最近编辑 {date(p.updatedAt)}</small>
            </button>
            <Button variant="ghost" size="icon-sm" aria-label={`删除作品 ${p.title}`} onClick={() => { setDeleteError(""); setDeleteTarget(p); }}><Trash2 /></Button>
            </div>
          ))}
        </div>
      )}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除作品「{deleteTarget?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>将永久删除本作品的正文、分卷、大纲、资料、历史版本和 AI 记录，无法恢复。原阅读书架、阅读收藏和已导出的文件不受影响。需要留存时，请先进入作品导出。</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <Alert variant="destructive"><AlertDescription>{deleteError}</AlertDescription></Alert>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <Button variant="destructive" disabled={deleting} onClick={() => void remove()}>{deleting ? "正在删除…" : "确认删除作品"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="creation-intro">
        <h2>一个连贯的创作流程</h2>
        <p>故事准备 · 章节写作 · 资料库</p>
        <p>
          从一个想法开始，也可以直接导入稿件。需要时让 AI 协助，采用前先预览。
        </p>
      </div>
      {creating && (
        <NewCreationDialog
          books={books}
          seed={seed}
          onClose={() => {
            setCreating(false);
            onSeedConsumed();
          }}
          onCreated={(p) => {
            setCreating(false);
            onSeedConsumed();
            setProject(p);
          }}
        />
      )}
    </div>
  );
}

function NewCreationDialog({
  books,
  seed,
  onClose,
  onCreated,
}: {
  books: BookSummary[];
  seed: CreationSeed | null;
  onClose: () => void;
  onCreated: (p: CreationProject) => void;
}) {
  const [title, setTitle] = useState(seed?.title || "");
  const genre = seed?.genre || "";
  const audience = seed?.audience || "";
  const [idea, setIdea] = useState(seed?.seed || "");
  const [bookId, setBookId] = useState("none");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [importKind, setImportKind] = useState<"prose" | "settings" | "reference">("prose");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const create = async () => {
    if (!title.trim() || busy || reading) return;
    setBusy(true);
    setError("");
    try {
      onCreated(
        await createCreation({
          title,
          genre,
          audience,
          seed: idea,
          content: content || undefined,
          importKind,
          sourceName: fileName || undefined,
          bookId: bookId === "none" ? undefined : bookId,
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy && !reading) onClose();
      }}
    >
      <DialogContent className="creation-dialog">
        <DialogHeader>
          <DialogTitle>新建作品</DialogTitle>
          <DialogDescription>
            先给作品起个名字。故事想法与章节安排在工作区继续完善。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="creation-title">作品名称</FieldLabel>
            <Input
              id="creation-title"
              autoFocus
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="暂定书名也可以"
            />
          </Field>
          {seed && <Field>
            <FieldLabel htmlFor="creation-seed">故事灵感</FieldLabel>
            <Textarea
              id="creation-seed"
              rows={4}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="一个人物、一条规则，或一段想写的情节…"
            />
          </Field>}
          {content && <Field><FieldLabel>文件用途</FieldLabel>
            <Select value={importKind} onValueChange={(v) => setImportKind(v as typeof importKind)}><SelectTrigger aria-label="文件用途"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>
              <SelectItem value="prose">小说正文 · 按章节导入</SelectItem><SelectItem value="settings">设定与大纲 · 保存到资料</SelectItem><SelectItem value="reference">参考文档 · 保存到资料</SelectItem>
            </SelectGroup></SelectContent></Select>
            <FieldDescription>{importKind === "prose" ? "仅识别第×章等章节标题，普通 Markdown 标题不会变成章节。" : "保存为待确认资料，不计入正文字数；原始文件内容独立保留。"} 共 {countText(content).toLocaleString()} 字。</FieldDescription>
            <details><summary>查看导入原文</summary><pre className="creation-import-preview">{content.slice(0, 1600)}{content.length > 1600 ? "\n…" : ""}</pre></details>
          </Field>}
          <Field>
            <FieldLabel>导入已有内容（可选）</FieldLabel><details><summary>从我的书架复制稿件</summary>
            <Select
              value={bookId}
              onValueChange={(value) => {
                setBookId(value);
                if (value !== "none") {
                  setContent("");
                  setFileName("");
                }
              }}
            >
              <SelectTrigger aria-label="导入书架稿件">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">
                    从空白开始 / 导入本地文件
                  </SelectItem>
                  {books.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              选择自己的稿件，复制章节到创作项目；引用其他作品时，请使用片段素材入口。
            </FieldDescription>
            </details>
            {bookId === "none" && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.md"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setReading(true);
                    setError("");
                    try {
                      if (
                        !/\.(txt|md)$/i.test(file.name) ||
                        file.size > 50_000_000
                      )
                        throw new Error(
                          "请选择 50 MB 以内的 TXT 或 Markdown 稿件",
                        );
                      const text = await file.text();
                      setContent(text);
                      setFileName(file.name);
                      setImportKind(/\.md$/i.test(file.name) ? "settings" : "prose");
                      if (!title)
                        setTitle(file.name.replace(/\.(txt|md)$/i, ""));
                    } catch (err) {
                      setError(message(err));
                    } finally {
                      setReading(false);
                    }
                  }}
                />
                <Button
                  variant="outline"
                  disabled={reading}
                  onClick={() => fileRef.current?.click()}
                >
                  <FileText data-icon="inline-start" />
                  {reading ? "读取稿件…" : fileName || "选择 TXT / Markdown"}
                </Button>
              </>
            )}
          </Field>
        </FieldGroup>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy || reading}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            disabled={!title.trim() || busy || reading}
            onClick={() => void create()}
          >
            {busy && (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            )}
            创建作品
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// One serialized save queue; responses only update revision, never replace newer typing.
