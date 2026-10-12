import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  FolderOpen,
  Plus,
  Trash2,
  X,
  Sparkles,
  Maximize2,
  BookOpen,
  FileText,
  Layers3,
  Bookmark,
  Settings2,
  Ellipsis,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  readCreationChapter,
  chapterAction,
  type CreationDoc,
  type CreationProject,
} from "./lib/creation";
import type { ModelConfig } from "./types";
import { useProjectDraft } from "./lib/use-creation-draft";
import {
  archive,
  restore,
  isTrash,
  updateAnchors,
  writerAI,
} from "./lib/writer";
import { countText } from "./lib/word-count";
import { readStorage, writeStorage } from "./lib/storage";
import { toast } from "sonner";

type Panel =
  | "none"
  | "background"
  | "outline"
  | "foreshadow"
  | "names"
  | "polish"
  | "tools"
  | "trash";
type Range = { chapterId: string; start: number; end: number; quote: string };
const uid = () => crypto.randomUUID();
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function WriterWorkbench({
  initial,
  config,
  onBack,
  onFocusChange,
}: {
  initial: CreationProject;
  config: ModelConfig;
  onBack: () => void;
  onFocusChange: (v: boolean) => void;
}) {
  const draft = useProjectDraft(initial),
    p = draft.project;
  const chapters = p.volumes.flatMap((v) =>
    p.documents.filter((d) => d.kind === "chapter" && d.volumeId === v.id),
  );
  const [locked, setLocked] = useState(false),
    [chapterLoading, setChapterLoading] = useState(true);
  const [chapterId, setChapterId] = useState(chapters[0]?.id || "");
  const chapter = chapters.find((d) => d.id === chapterId);
  const [panel, setPanel] = useState<Panel>("none");
  const surface = useRef<HTMLDivElement>(null);
  const [resourceId, setResourceId] = useState("");
  const [focus, setFocus] = useState(false),
    [error, setError] = useState("");
  const [selection, setSelection] = useState<Range | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [markDialog, setMarkDialog] = useState(false),
    [markTitle, setMarkTitle] = useState("");
  const [selectedMark, setSelectedMark] = useState(""),
    [filter, setFilter] = useState("全部");
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "doc" | "volume";
    id: string;
  } | null>(null);
  const [deleteChapters, setDeleteChapters] = useState(false);
  const [volumeDescription, setVolumeDescription] = useState("");
  const [volumeGoal, setVolumeGoal] = useState("");
  const [rename, setRename] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [settings, setSettings] = useState(false);
  const [options, setOptions] = useState(() => {
    try {
      return JSON.parse(readStorage("inkscope-writer-v1") || "{}") as {
        complete?: boolean;
        correct?: boolean;
      };
    } catch {
      return {};
    }
  });
  const [suggestion, setSuggestion] = useState<{
    source: string;
    position: number;
    text: string;
  } | null>(null);
  const [corrections, setCorrections] = useState<
    { quote: string; replacement: string; reason: string }[]
  >([]);
  const autoInFlight = useRef(false);
  const composing = useRef(false),
    [compositionTick, setCompositionTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false),
    request = useRef(0);
  const [result, setResult] = useState<{
    action: string;
    source: string;
    text: string;
    chapterIds: string[];
    fullSource?: string;
    range?: Range | null;
  } | null>(null);
  const [toolChapters, setToolChapters] = useState<string[]>(chapters[0] ? [chapters[0].id] : []);
  const [names, setNames] = useState<string[]>([]),
    [gender, setGender] = useState("男性"),
    [surname, setSurname] = useState(""),
    [nameLength, setNameLength] = useState("3"),
    [personality, setPersonality] = useState("");
  const marks = p.documents.filter(
    (d) =>
      d.kind === "resource" &&
      d.details?.category === "foreshadow" &&
      !isTrash(d),
  );
  const mark = marks.find((d) => d.id === selectedMark);
  const trash = p.documents.filter(isTrash);
  const activeRef = useRef({ chapter, chapterId, selection });
  activeRef.current = { chapter, chapterId, selection };
  const total = chapters.reduce((n, d) => n + countText(d.content), 0);
  const update = (id: string, patch: Partial<CreationDoc>) =>
    draft.change((v) => ({
      ...v,
      documents: v.documents.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
  const detail = (d: CreationDoc, key: string, value: string) =>
    update(d.id, { details: { ...d.details, [key]: value } });
  const openChapter = (id: string) => {
    request.current++;
    setChapterId(id);
    setPanel("none");
    setSelection(null);
    setSuggestion(null);
    setCorrections([]);
    setResult(null);
  };
  const changeContent = (content: string) => {
    if (!chapter) return;
    request.current++;
    setSuggestion(null);
    setCorrections([]);
    setSelection(null);
    draft.change((v) => ({
      ...v,
      documents: updateAnchors(
        v.documents.map((d) => (d.id === chapter.id ? { ...d, content } : d)),
        chapter.id,
        content,
        chapter.content,
      ),
    }));
  };
  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const addChapter = (volumeId: string) => {
    const d: CreationDoc = {
      id: uid(),
      kind: "chapter",
      volumeId,
      title: `第${chapters.length + 1}章`,
      content: "",
      goal: "",
      details: {},
    };
    draft.change((v) => ({ ...v, documents: [...v.documents, d] }));
    openChapter(d.id);
  };
  const editVolume = (v: {id:string;title:string}) => {
    setRename(v);
    setVolumeDescription(p.guidance[`volume-description-${v.id}`] || "");
    setVolumeGoal(p.guidance[`volume-goal-${v.id}`] || "");
  };
  const addVolume = () => {
    const id = uid();
    draft.change((v) => ({
      ...v,
      volumes: [...v.volumes, { id, title: `第${v.volumes.length + 1}卷` }],
    }));
    setVolumeDescription(""); setVolumeGoal("");
    setRename({ id, title: `第${p.volumes.length + 1}卷` });
  };
  const addResource = (category: string) => {
    const d: CreationDoc = {
      id: uid(),
      kind: "resource",
      title: category === "rules" ? "新设定" : "新大纲",
      content: "",
      goal: "",
      volumeId: "",
      details: { category, status: "待确认" },
    };
    draft.change((v) => ({ ...v, documents: [...v.documents, d] }));
    setResourceId(d.id);
  };
  const capture = () => {
    const el = editor.current;
    if (!el || !chapter) return;
    setSelection(
      el.selectionStart !== el.selectionEnd
        ? {
            chapterId: chapter.id,
            start: el.selectionStart,
            end: el.selectionEnd,
            quote: chapter.content.slice(el.selectionStart, el.selectionEnd),
          }
        : null,
    );
  };
  const jump = (chapterId: string, quote: string, start: number) => {
    const target = chapters.find((d) => d.id === chapterId);
    if (!target) {
      setError("关联章节已删除，可先从回收站恢复。");
      return;
    }
    const pos =
      target.content.slice(start, start + quote.length) === quote
        ? start
        : target.content.indexOf(quote);
    if (!quote || pos < 0) {
      setError("关联原文已变化，请选中文字重新定位。");
      return;
    }
    openChapter(chapterId);
    setPanel("none");
    window.requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(pos, pos + quote.length);
      const lines = target.content.slice(0, pos).split("\n").length;
      if (editor.current)
        editor.current.scrollTop = Math.max(0, (lines - 3) * 32);
      setSelection({ chapterId, start: pos, end: pos + quote.length, quote });
    });
  };
  const linkMark = () => {
    if (!selection || !chapter) return;
    const d: CreationDoc = {
      id: uid(),
      kind: "resource",
      title: markTitle.trim() || selection.quote.slice(0, 30),
      content: selection.quote,
      goal: "",
      volumeId: "",
      details: {
        category: "foreshadow",
        status: "待回收",
        chapterId: chapter.id,
        quote: selection.quote,
        start: String(selection.start),
        end: String(selection.end),
        anchorState: "已定位",
        note: "",
      },
    };
    draft.change((v) => ({ ...v, documents: [...v.documents, d] }));
    setSelectedMark(d.id);
    setPanel("foreshadow");
    setMarkDialog(false);
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await run(async () => {
      const affected = chapters.filter(d => deleteTarget.kind === "doc" ? d.id === deleteTarget.id : d.volumeId === deleteTarget.id);
      for (const d of affected) {
        const state = await readCreationChapter(p.id, d.id);
        if (state.activeFinalization) throw new Error("包含已定稿章节，请先创建修订版再删除或移动。");
      }
      if (deleteTarget.kind === "doc") {
        draft.change((v) => archive(v, [deleteTarget.id]));
        if (chapterId === deleteTarget.id)
          openChapter(chapters.find((d) => d.id !== deleteTarget.id)?.id || "");
      } else {
        const volume = p.volumes.find((v) => v.id === deleteTarget.id)!;
        const ids = chapters
          .filter((d) => d.volumeId === volume.id)
          .map((d) => d.id);
        let dest = p.volumes.find((v) => v.id !== volume.id);
        if (!dest) dest = { id: uid(), title: "未分卷" };
        const target = dest;
        draft.change((v) => {
          let next = deleteChapters
            ? archive(v, ids)
            : {
                ...v,
                documents: v.documents.map((d) =>
                  ids.includes(d.id) ? { ...d, volumeId: target.id } : d,
                ),
              };
          const entry: CreationDoc = {
            id: uid(),
            kind: "resource",
            title: volume.title,
            content: JSON.stringify(volume),
            goal: "",
            volumeId: "",
            details: {
              category: "trash",
              originalKind: "volume",
              deletedAt: new Date().toISOString(),
            },
          };
          return {
            ...next,
            volumes: [
              ...v.volumes.filter((v) => v.id !== volume.id),
              ...(!v.volumes.some((v) => v.id === target.id) ? [target] : []),
            ],
            documents: [...next.documents, entry],
          };
        });
        if (deleteChapters && ids.includes(chapterId))
          openChapter(chapters.find((d) => !ids.includes(d.id))?.id || "");
      }
      await draft.flush();
      setDeleteTarget(null);
    });
  };
  const restoreItem = (d: CreationDoc) => {
    draft.change((v) => {
      if (d.details?.originalKind === "volume") {
        const vol = JSON.parse(d.content);
        return {
          ...v,
          volumes: v.volumes.some((x) => x.id === vol.id)
            ? v.volumes
            : [...v.volumes, vol],
          documents: v.documents.filter((x) => x.id !== d.id),
        };
      }
      return restore(v, d.id);
    });
  };
  const setOption = (key: "complete" | "correct", value: boolean) => {
    const next = { ...options, [key]: value };
    setOptions(next);
    request.current++;
    setSuggestion(null);
    setCorrections([]);
    void writeStorage("inkscope-writer-v1", JSON.stringify(next)).catch((e) =>
      setError(errorText(e)),
    );
  };
  useEffect(
    () => () => {
      request.current++;
      onFocusChange(false);
    },
    [onFocusChange],
  );
  useEffect(() => {
    let active = true;
    setChapterLoading(true);
    setLocked(false);
    if (!chapterId) {
      setChapterLoading(false);
      return;
    }
    void readCreationChapter(p.id, chapterId)
      .then((state) => {
        if (active) {
          setLocked(!!state.activeFinalization);
          setChapterLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(errorText(e));
          setLocked(true);
          setChapterLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [p.id, chapterId]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFocus(false);
        onFocusChange(false);
        setSuggestion(null);
        setSelection(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void draft.flush().catch((e) => setError(errorText(e)));
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  });
  useEffect(() => {
    if (
      composing.current ||
      locked ||
      chapterLoading ||
      !chapter ||
      (!options.complete && !options.correct) ||
      !chapter.content.trim() ||
      !config.apiKey
    )
      return;
    const token = ++request.current,
      source = chapter.content,
      id = chapter.id;
    const timer = window.setTimeout(async () => {
      const pos = editor.current?.selectionStart ?? source.length;
      if (autoInFlight.current) return;
      autoInFlight.current = true;
      try {
        if (options.complete) {
          const response = await writerAI(
            "complete",
            source.slice(Math.max(0, pos - 6000), pos),
            "",
            config,
            source.slice(pos, pos + 2000),
          );
          if (
            request.current === token &&
            activeRef.current.chapterId === id &&
            response.text
          )
            setSuggestion({ source, position: pos, text: response.text });
        }
        if (options.correct && request.current === token) {
          const response = await writerAI(
            "correct",
            source.slice(Math.max(0, pos - 2000), pos + 1000),
            "",
            config,
          );
          if (request.current === token && activeRef.current.chapterId === id)
            setCorrections(
              (response.corrections || []).filter(
                (c) =>
                  c.quote &&
                  source.includes(c.quote) &&
                  source.indexOf(c.quote) === source.lastIndexOf(c.quote) &&
                  c.quote !== c.replacement,
              ),
            );
        }
      } catch (e) {
        if (request.current === token) setError(errorText(e));
      } finally {
        autoInFlight.current = false;
      }
    }, 1800);
    return () => {
      window.clearTimeout(timer);
      request.current++;
    };
  }, [
    chapter?.content,
    chapterId,
    options.complete,
    options.correct,
    config,
    compositionTick,
    locked,
    chapterLoading,
  ]);
  const acceptCompletion = () => {
    if (chapter && suggestion?.source === chapter.content) {
      const pos = suggestion.position,
        text = suggestion.text;
      changeContent(
        chapter.content.slice(0, pos) + text + chapter.content.slice(pos),
      );
      window.requestAnimationFrame(() =>
        editor.current?.setSelectionRange(pos + text.length, pos + text.length),
      );
    }
  };
  const aiTool = (action: string) =>
    void run(async () => {
      const ids =
        action === "polish"
          ? [chapterId]
          : toolChapters.length
            ? toolChapters
            : [chapterId];
      const docs = chapters.filter((d) => ids.includes(d.id));
      const range = selection,
        fullSource = chapter?.content;
      const source =
        action === "polish" && range
          ? range.quote
          : action === "polish"
            ? docs.map((d) => d.content).join("\n")
            : docs.map((d) => `【${d.title}】\n${d.content}`).join("\n\n");
      const response = await writerAI(
        action,
        source,
        action === "review"
          ? "依据内置章节诊断方法审核，给出可执行修改建议。"
          : "保留作者文风，只返回润色后的正文。",
        config,
      );
      setResult({
        action,
        source,
        text: response.text || "",
        chapterIds: ids,
        range,
        fullSource,
      });
    });
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = surface.current?.querySelector(panel === "none" || focus ? ".writer-main" : ".writer-panel");
    const animation = target?.animate([{ opacity: .45, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 240, easing: "cubic-bezier(.22,1,.36,1)" });
    return () => animation?.cancel();
  }, [chapterId, panel, focus]);
  const canonical = (kind: string) => p.documents.find((d) => d.kind === kind);
  const resources = (category: string) =>
    p.documents.filter(
      (d) => d.kind === "resource" && d.details?.category === category,
    );
  const materialDocs = [canonical(panel === "outline" ? "outline" : "rules"), ...(panel === "background" ? [canonical("characters")] : []), ...resources(panel === "outline" ? "outline" : "rules"), ...(panel === "background" ? [...resources("characters"), ...resources("reference")] : [])].filter((d): d is CreationDoc => !!d);
  const activeMaterial = materialDocs.find(d => d.id === resourceId) || materialDocs[0];
  return (
    <div ref={surface} className={`writer-workspace${focus ? " writer-focus" : ""}`}>
      {!focus && (
        <header className="writer-header">
          <div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="返回作品列表"
              onClick={() =>
                void run(async () => {
                  await draft.flush();
                  onBack();
                })
              }
            >
              <ArrowLeft />
            </Button>
            <strong>{p.title}</strong>
            <span className="writer-save-state"><i />{draft.state}</span>
          </div>
          <div>
            <Button variant="ghost" size="sm" onClick={() => {setResourceId("");setPanel("background");}}>设定</Button>
            <Button variant="ghost" size="sm" onClick={() => {setResourceId("");setPanel("outline");}}>大纲</Button>
            <Button variant="ghost" size="sm" onClick={() => setPanel("foreshadow")}>伏笔 <span>{marks.length}</span></Button>
            <Button variant="ghost" size="sm" onClick={() => setSettings(true)}>
              <Settings2 />写作辅助
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPanel("names")}
            >
              <Ellipsis />工具
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="专注写作"
              onClick={() => {
                setFocus(true);
                onFocusChange(true);
              }}
            >
              <Maximize2 />
            </Button>
          </div>
        </header>
      )}
      {(error || draft.error) && panel === "none" && (
        <Alert variant="destructive">
          <AlertDescription>
            <span>{error || draft.error}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void run(async () => {
                  if (draft.error) await draft.flush();
                  setError("");
                })
              }
            >
              {draft.error ? "重新保存" : "关闭提示"}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div
        className="writer-layout"
      >
        {!focus && (
          <nav className="writer-directory" aria-label="写作目录">


            <header>
              <strong>分卷与章节</strong>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="新建分卷"
                onClick={addVolume}
              >
                <Plus />
              </Button>
            </header>
            <div className="writer-tree">
              {p.volumes.map((v) => (
                <section key={v.id}>
                  <div className="writer-volume">
                    <button onClick={() => editVolume(v)}><FolderOpen aria-hidden="true" /><span>{v.title}</span></button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`向${v.title}新建章节`}
                      onClick={() => addChapter(v.id)}
                    >
                      <Plus />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除分卷${v.title}`}
                      onClick={() => {
                        setDeleteChapters(false);
                        setDeleteTarget({ kind: "volume", id: v.id });
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {chapters
                    .filter((d) => d.volumeId === v.id)
                    .map((d) => (
                      <div
                        key={d.id}
                        className={`writer-chapter-link${d.id === chapterId ? " is-active" : ""}`}
                      >
                        <button onClick={() => openChapter(d.id)}>
                          <span>{d.title}</span>
                          <small>
                            {countText(d.content).toLocaleString()} 字
                          </small>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除章节${d.title}`}
                          onClick={() =>
                            setDeleteTarget({ kind: "doc", id: d.id })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                </section>
              ))}
            </div>

          </nav>
        )}
        <main className="writer-main">
          {chapter ? (
            <>
              <div className="writer-manuscript-label"><Button variant="ghost" size="sm" onClick={()=>{const v=p.volumes.find(v=>v.id===chapter.volumeId);if(v)editVolume(v);}}>{p.volumes.find(v=>v.id===chapter.volumeId)?.title} · 卷设置</Button><span>{countText(chapter.content).toLocaleString()} 字</span></div>
              {p.guidance[`volume-goal-${chapter.volumeId}`] && <div className="writer-volume-goal">本卷目标：{p.guidance[`volume-goal-${chapter.volumeId}`]}</div>}
              <Input
                className="writer-title"
                aria-label="章节标题"
                value={chapter.title}
                readOnly={locked || chapterLoading}
                onChange={(e) => update(chapter.id, { title: e.target.value })}
              />
              {locked && (
                <div className="writer-locked">
                  <span>本章已定稿，旧定稿保留。</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void run(async () => {
                        const current = await draft.flush();
                        const next = await chapterAction({
                          id: p.id,
                          documentId: chapterId,
                          revision: current.revision,
                          action: "reopen",
                        });
                        draft.replace(next);
                        setLocked(false);
                      })
                    }
                  >
                    创建修订版
                  </Button>
                </div>
              )}
              <details className="writer-chapter-plan">
                <summary>本章章纲{chapter.goal ? " · 已填写" : ""}</summary>
                <Textarea
                  aria-label="本章章纲"
                  readOnly={locked || chapterLoading}
                  value={chapter.goal}
                  onChange={(e) => update(chapter.id, { goal: e.target.value })}
                  placeholder="记录本章事件、人物选择和结尾变化…"
                />
              </details>
              <div className="writer-editor-wrap">
                <Textarea
                  ref={editor}
                  className="writer-editor"
                  aria-label="写作正文"
                  readOnly={locked || chapterLoading}
                  onCompositionStart={() => {
                    composing.current = true;
                    request.current++;
                    setSuggestion(null);
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                    setCompositionTick((v) => v + 1);
                  }}
                  value={chapter.content}
                  placeholder="从这里开始写作…"
                  onChange={(e) => changeContent(e.target.value)}
                  onSelect={capture}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Tab" &&
                      suggestion &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      acceptCompletion();
                    }
                    if (
                      [
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                        "Home",
                        "End",
                      ].includes(e.key)
                    ) {
                      request.current++;
                      setSuggestion(null);
                    }
                  }}
                  onPointerDown={() => {
                    request.current++;
                    setSuggestion(null);
                  }}
                />
                {selection && (
                  <div className="writer-selection-tools">
                    <span>{countText(selection.quote)} 字</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setMarkTitle("");
                        setMarkDialog(true);
                      }}
                    >
                      标记伏笔
                    </Button>
                    {mark && (
                      <>
                        <span>关联至「{mark.title}」</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            detail(
                              mark,
                              "recoveryLinks",
                              JSON.stringify([
                                ...JSON.parse(
                                  mark.details?.recoveryLinks || "[]",
                                ),
                                selection,
                              ]),
                            );
                            toast.success("已关联回收原文，请确认回收状态");
                          }}
                        >
                          关联回收位置
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            update(mark.id, {
                              details: {
                                ...mark.details,
                                chapterId: selection.chapterId,
                                quote: selection.quote,
                                start: String(selection.start),
                                end: String(selection.end),
                                anchorState: "已定位",
                              },
                            })
                          }
                        >
                          重新定位
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {suggestion && (
                  <div className="writer-completion">
                    <span>{suggestion.text}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={acceptCompletion}
                    >
                      Tab 接受
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="取消补全"
                      onClick={() => setSuggestion(null)}
                    >
                      <X />
                    </Button>
                  </div>
                )}
                {corrections.length > 0 && (
                  <div className="writer-corrections">
                    {corrections.map((c, i) => (
                      <div key={i}>
                        <span>
                          {c.quote} → {c.replacement} · {c.reason}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (chapter.content.includes(c.quote))
                              changeContent(
                                chapter.content.replace(c.quote, c.replacement),
                              );
                          }}
                        >
                          采用
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="writer-empty">
              <BookOpen />
              <h2>开始写下一章</h2>
              <Button onClick={() => addChapter(p.volumes[0]?.id || "")}>
                新建章节
              </Button>
            </div>
          )}
          <footer className="writer-status">
            <span>
              全书 {total.toLocaleString()} 字 · 本章{" "}
              {countText(chapter?.content || "").toLocaleString()} 字
              {selection && ` · 已选 ${countText(selection.quote)} 字`}
            </span>
            <span>
              {options.correct ? "纠错已开启" : "纠错关闭"} ·{" "}
              {options.complete ? "补全已开启" : "补全关闭"}
              {focus && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFocus(false);
                    onFocusChange(false);
                  }}
                >
                  退出专注 · Esc
                </Button>
              )}
            </span>
          </footer>
        </main>
        {!focus && panel !== "none" && (
          <Dialog open onOpenChange={v => { if (!v) {setPanel("none");setSelection(null);const el=editor.current;if(el)el.setSelectionRange(el.selectionEnd,el.selectionEnd);} }}>
          <DialogContent className={`writer-manager-dialog writer-manager-${panel}`}>
            <DialogHeader>
              <DialogTitle>
                {
                  {
                    background: "设定背景",
                    outline: "作品大纲",
                    foreshadow: "伏笔集合",
                    names: "写作工具",
                    tools: "写作工具",
                    polish: "写作工具",
                    trash: "写作工具",
                  }[panel]
                }
              </DialogTitle>
              <DialogDescription>{["names","tools","polish","trash"].includes(panel) ? "选择一个工具，专注完成当前操作。" : panel === "foreshadow" ? "管理埋设与回收，保留原文位置和证据。" : "按条目整理作品资料，自动保存。"}</DialogDescription>
            </DialogHeader>
            {["names","tools","polish","trash"].includes(panel) && <Tabs value={panel} onValueChange={v=>setPanel(v as Panel)} className="writer-tool-tabs"><TabsList variant="line"><TabsTrigger value="names">人物取名</TabsTrigger><TabsTrigger value="tools">章节审核</TabsTrigger><TabsTrigger value="polish">文字润色</TabsTrigger><TabsTrigger value="trash">回收站 · {trash.length}</TabsTrigger></TabsList></Tabs>}
            {(error || draft.error) && <Alert variant="destructive"><AlertDescription>{error || draft.error}<Button variant="ghost" size="sm" onClick={()=>setError("")}>关闭提示</Button></AlertDescription></Alert>}
            <div className="writer-panel-content">
              {(panel === "background" || panel === "outline") && (
                <FieldGroup>
                  <div className="writer-material-index" aria-label="资料目录">
                    <span className="writer-section-label">{panel === "outline" ? "大纲目录" : "设定条目"} · {materialDocs.length}</span>
                    {materialDocs.map(d => <Button key={d.id} variant="ghost" aria-pressed={d.id === activeMaterial?.id} onClick={() => setResourceId(d.id)}>{d.title}</Button>)}
                  <Button
                    variant="outline"
                    onClick={() =>
                      addResource(panel === "outline" ? "outline" : "rules")
                    }
                  >
                    <Plus />
                    新增条目
                  </Button>
                  </div>
                  {[activeMaterial].filter((d): d is CreationDoc => !!d)
                    .map((d) => (
                      <Field key={d.id}>
                        <div className="writer-field-heading">
                          <Input
                            aria-label={`资料标题${d.id}`}
                            value={d.title}
                            onChange={(e) =>
                              update(d.id, { title: e.target.value })
                            }
                          />
                          {
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${d.kind === "resource" ? "删除资料" : "清空资料"}${d.title}`}
                              onClick={() =>
                                setDeleteTarget({ kind: "doc", id: d.id })
                              }
                            >
                              <Trash2 />
                            </Button>
                          }
                        </div>
                        <Textarea
                          aria-label={`资料内容${d.id}`}
                          rows={8}
                          value={d.content}
                          onChange={(e) =>
                            update(d.id, { content: e.target.value })
                          }
                        />
                      </Field>
                    ))}

                </FieldGroup>
              )}
              {panel === "foreshadow" && (
                <div className="writer-foreshadow-layout"><section className="writer-foreshadow-index">
                  <p className="text-muted-foreground">
                    {marks.length} 条 ·{" "}
                    {marks.filter((d) => d.details?.status === "已回收").length}{" "}
                    已回收 ·{" "}
                    {
                      marks.filter((d) => d.details?.status === "部分回收")
                        .length
                    }{" "}
                    部分回收
                  </p>
                  <Select value={filter} onValueChange={setFilter}>
                    <SelectTrigger aria-label="伏笔筛选">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {["全部", "待回收", "部分回收", "已回收", "放弃"].map(
                          (v) => (
                            <SelectItem key={v} value={v}>
                              {v}
                            </SelectItem>
                          ),
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <div className="writer-mark-list">
                    {marks
                      .filter(
                        (d) =>
                          filter === "全部" || d.details?.status === filter,
                      )
                      .map((d) => (
                        <Button
                          key={d.id}
                          variant={
                            d.id === selectedMark ? "secondary" : "ghost"
                          }
                          onClick={() => setSelectedMark(d.id)}
                        >
                          {d.title}
                          <small>{d.details?.status || "待回收"}</small>
                        </Button>
                      ))}
                  </div>
                  {!marks.length && (
                    <p>选中正文中的一段文字，点击「标记伏笔」。</p>
                  )}
                  </section><section className="writer-foreshadow-detail">{mark ? (
                    <FieldGroup>
                      <Field>
                        <FieldLabel>伏笔名称</FieldLabel>
                        <Input
                          aria-label="伏笔名称"
                          value={mark.title}
                          onChange={(e) =>
                            update(mark.id, { title: e.target.value })
                          }
                        />
                      </Field>
                      <FieldLabel>埋设原文</FieldLabel><blockquote>
                        {mark.details?.quote || mark.content}
                      </blockquote>
                      <Button
                        variant="outline"
                        onClick={() =>
                          jump(
                            mark.details?.chapterId || "",
                            mark.details?.quote || "",
                            Number(mark.details?.start || 0),
                          )
                        }
                      >
                        返回埋设位置
                      </Button>
                      {mark.details?.anchorState === "需重新定位" && (
                        <p>原文已变化，请选中正文后重新定位。</p>
                      )}
                      <Field>
                        <FieldLabel>回收状态</FieldLabel>
                        <Select
                          value={
                            ["待回收", "部分回收", "已回收", "放弃"].includes(
                              mark.details?.status || "",
                            )
                              ? mark.details!.status
                              : "待回收"
                          }
                          onValueChange={(v) => detail(mark, "status", v)}
                        >
                          <SelectTrigger aria-label="回收状态">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {["待回收", "部分回收", "已回收", "放弃"].map(
                                (v) => (
                                  <SelectItem key={v} value={v}>
                                    {v}
                                  </SelectItem>
                                ),
                              )}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field>
                        <FieldLabel>备注</FieldLabel>
                        <Textarea
                          aria-label="伏笔备注"
                          value={mark.details?.note || ""}
                          onChange={(e) => detail(mark, "note", e.target.value)}
                        />
                      </Field>
                      <div className="writer-recovery-heading"><FieldLabel>回收记录</FieldLabel><Button variant="outline" size="sm" onClick={()=>{setPanel("none");toast.info("在正文中选中回收片段，点击「关联回收位置」。");}}>选择回收原文</Button></div>
                      {(
                        JSON.parse(
                          mark.details?.recoveryLinks || "[]",
                        ) as Range[]
                      ).map((r, i) => (
                        <div className="writer-recovery-link" key={i}>
                          <Button
                            variant="ghost"
                            onClick={() => jump(r.chapterId, r.quote, r.start)}
                          >
                            回收位置 {i + 1} · {r.quote.slice(0, 20)}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              detail(
                                mark,
                                "recoveryLinks",
                                JSON.stringify(
                                  JSON.parse(
                                    mark.details?.recoveryLinks || "[]",
                                  ).filter((_: unknown, j: number) => j !== i),
                                ),
                              )
                            }
                          >
                            移除链接
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        disabled={busy || !chapter?.content}
                        onClick={() =>
                          void run(async () => {
                            const source = chapter!.content,
                              id = chapter!.id;
                            const response = await writerAI(
                              "foreshadow",
                              source,
                              `伏笔：${mark.details?.quote || mark.content}`,
                              config,
                            );
                            const evidence = (response.evidence || []).filter(
                              (e) => e.quote && source.includes(e.quote),
                            );
                            if (
                              activeRef.current.chapter?.content !== source ||
                              activeRef.current.chapterId !== id
                            )
                              return;
                            setResult({
                              action: "foreshadow",
                              source,
                              text: evidence.length
                                ? evidence
                                    .map((e) => `${e.quote}\n${e.reason}`)
                                    .join("\n\n")
                                : "当前章没有找到明确回收证据。",
                              chapterIds: [id],
                            });
                          })
                        }
                      >
                        AI 检查当前章的回收证据
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setDeleteTarget({ kind: "doc", id: mark.id })
                        }
                      >
                        删除此伏笔
                      </Button>
                    </FieldGroup>
                  ) : <div className="writer-detail-empty"><Bookmark /><p>选择一条伏笔，查看原文与回收记录。</p></div>}
                </section></div>
              )}
              {panel === "names" && (
                <div className="writer-name-tool"><FieldGroup className="writer-name-controls">
                  <Field>
                    <FieldLabel>性别</FieldLabel>
                    <ToggleGroup type="single" variant="outline" value={gender} onValueChange={v=>v && setGender(v)} aria-label="姓名性别">{["男性","女性","不限"].map(v=><ToggleGroupItem key={v} value={v}>{v}</ToggleGroupItem>)}</ToggleGroup>

                  </Field>
                  <Field>
                    <FieldLabel>姓氏（可选）</FieldLabel>
                    <Input
                      aria-label="指定姓氏"
                      value={surname}
                      onChange={(e) => setSurname(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>姓名总字数</FieldLabel>
                    <Select value={nameLength} onValueChange={setNameLength}>
                      <SelectTrigger aria-label="姓名字数">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {["2", "3", "4"].map((v) => (
                            <SelectItem key={v} value={v}>
                              {v} 字
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>性格、时代与风格</FieldLabel>
                    <Textarea
                      aria-label="取名提示词"
                      value={personality}
                      onChange={(e) => setPersonality(e.target.value)}
                    />
                  </Field>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const response = await writerAI(
                          "names",
                          "",
                          `${gender}，姓氏：${surname || "不限"}，姓名总字数${nameLength}字。${personality}`,
                          config,
                        );
                        setNames(
                          [...new Set(response.names || [])]
                            .filter(
                              (n) =>
                                countText(n) === Number(nameLength) &&
                                (!surname || n.startsWith(surname)),
                            )
                            .slice(0, 10),
                        );
                      })
                    }
                  >
                    {busy ? "生成中…" : "生成十个名字"}
                  </Button>
                </FieldGroup><div className="writer-name-results"><div className="writer-name-heading"><strong>候选姓名</strong><span>{names.length ? `${names.length} 个 · 点击复制或保存` : "填写条件后生成十个候选"}</span></div><div className="writer-name-grid">
                  {names.map((name) => (
                    <div className="writer-field-heading" key={name}>
                      <strong>{name}</strong>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(name)
                            .then(() => toast.success("已复制"))
                        }
                      >
                        复制
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const d: CreationDoc = {
                            id: uid(),
                            kind: "resource",
                            title: name,
                            content: personality,
                            goal: "",
                            volumeId: "",
                            details: {
                              category: "characters",
                              status: "待确认",
                            },
                          };
                          draft.change((v) => ({
                            ...v,
                            documents: [...v.documents, d],
                          }));
                          toast.success("已保存为人物资料");
                        }}
                      >
                        存为人物
                      </Button>
                    </div>
                  ))}
                </div>{!names.length && <div className="writer-name-empty"><Sparkles /><p>为下一个人物找到合适的名字</p></div>}</div></div>
              )}
              {(panel === "tools" || panel === "polish") && (
                <div className="writer-review-tool">
                  <div className="writer-tool-intro"><h3>{panel === "tools" ? "章节审核" : "文字润色"}</h3><p>{panel === "tools" ? "选择需要审核的章节，获得结构、情节和表达建议。" : "保留你的文风，先预览修改，再决定是否采用。"}</p></div>
                  {panel === "tools" ? <><div className="writer-review-chapters">{chapters.map(d => <label className="writer-check" key={d.id}><Checkbox checked={toolChapters.includes(d.id)} onCheckedChange={v=>setToolChapters(ids=>v === true ? [...ids,d.id] : ids.filter(id=>id!==d.id))}/><span>{d.title}</span><small>{countText(d.content).toLocaleString()} 字</small></label>)}</div><Button disabled={busy || !toolChapters.length} onClick={()=>aiTool("review")}>{busy ? "审核中…" : "审核所选章节"}</Button></> : <><div className="writer-polish-preview"><strong>{chapter?.title || "尚未选择章节"}</strong><p>{selection ? selection.quote : chapter?.content || "返回正文，写下一段文字后再润色。"}</p></div><Button disabled={busy || !chapter?.content} onClick={()=>aiTool("polish")}>{busy ? "润色中…" : selection ? "润色选中文字" : "润色当前章"}</Button></>}
                </div>
              )}
              {panel === "trash" && (
                <>
                  {!trash.length && <p>暂无删除内容。</p>}
                  {trash.map((d) => (
                    <div className="writer-trash-item" key={d.id}>
                      <span>
                        {d.title}
                        <small>
                          {d.details?.originalKind === "volume"
                            ? "分卷"
                            : d.details?.originalKind === "chapter"
                              ? "章节"
                              : "资料或伏笔"}
                        </small>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          try {
                            restoreItem(d);
                          } catch (e) {
                            setError(errorText(e));
                          }
                        }}
                      >
                        恢复
                      </Button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </DialogContent>
          </Dialog>
        )}
      </div>
      <Dialog open={markDialog} onOpenChange={setMarkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>标记伏笔</DialogTitle>
            <DialogDescription>
              保留选中的原文及章节位置，后续可关联回收文字。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="mark-title">伏笔名称</FieldLabel>
              <Input
                id="mark-title"
                value={markTitle}
                onChange={(e) => setMarkTitle(e.target.value)}
              />
            </Field>
            <blockquote>{selection?.quote}</blockquote>
          </FieldGroup>
          <DialogFooter>
            <Button onClick={linkMark} disabled={!selection}>
              保存伏笔
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              删除{deleteTarget?.kind === "volume" ? "分卷" : "条目"}
            </DialogTitle>
            <DialogDescription>
              内容移入回收站，可恢复。关联伏笔不会一并删除，来源或回收位置会显示章节不可用。
            </DialogDescription>
          </DialogHeader>
          {deleteTarget?.kind === "volume" && (
            <label className="writer-check">
              <Checkbox
                checked={deleteChapters}
                onCheckedChange={(v) => setDeleteChapters(v === true)}
              />
              同时删除卷内章节；不勾选则移至其他分卷
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!rename} onOpenChange={(v) => !v && setRename(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>分卷设置</DialogTitle>
            <DialogDescription>记录卷的简介与目标，帮助安排后续章节。</DialogDescription>
          </DialogHeader>
          <FieldGroup><Field><FieldLabel>分卷名称</FieldLabel><Input
            aria-label="分卷名称"
            value={rename?.title || ""}
            onChange={(e) =>
              setRename((v) => (v ? { ...v, title: e.target.value } : v))
            }
          />
          </Field><Field><FieldLabel>卷描述</FieldLabel><Textarea aria-label="卷描述" value={volumeDescription} maxLength={6000} onChange={e=>setVolumeDescription(e.target.value)} placeholder="这一卷讲述什么？主要人物、冲突和范围…" rows={3}/></Field><Field><FieldLabel>本卷应完成的目标</FieldLabel><Textarea aria-label="本卷目标" value={volumeGoal} maxLength={6000} onChange={e=>setVolumeGoal(e.target.value)} placeholder="卷末应发生的变化、需要兑现的情节…" rows={3}/></Field></FieldGroup>
          <DialogFooter>
            <Button
              disabled={!rename?.title.trim()}
              onClick={() => {
                draft.change((v) => ({
                  ...v,
                  guidance: {...v.guidance, [`volume-description-${rename?.id}`]:volumeDescription, [`volume-goal-${rename?.id}`]:volumeGoal},
                  volumes: v.volumes.map((x) =>
                    x.id === rename?.id ? { ...x, title: rename.title } : x,
                  ),
                }));
                setRename(null);
              }}
            >
              保存名称
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>写作辅助</DialogTitle>
            <DialogDescription>
              开启后，停笔时会将附近正文发送给已配置的
              DeepSeek。建议由你确认，不自动修改正文。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <label className="writer-check">
              <Checkbox
                checked={!!options.correct}
                onCheckedChange={(v) => setOption("correct", v === true)}
              />
              实时文字纠错
            </label>
            <label className="writer-check">
              <Checkbox
                checked={!!options.complete}
                onCheckedChange={(v) => setOption("complete", v === true)}
              />
              FIM 补全 · Tab 接受，Esc 取消
            </label>
          </FieldGroup>
          <DialogFooter>
            <Button onClick={() => setSettings(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!result} onOpenChange={(v) => !v && setResult(null)}>
        <DialogContent className="writer-result-dialog">
          <DialogHeader>
            <DialogTitle>
              {result?.action === "polish"
                ? "润色对照"
                : result?.action === "foreshadow"
                  ? "疑似回收证据"
                  : "章节审核"}
            </DialogTitle>
            <DialogDescription>
              AI 建议仅供核对，不会自动更改正文或回收状态。
            </DialogDescription>
          </DialogHeader>
          {result?.action === "polish" ? (
            <div className="writer-compare">
              <pre>{result.source}</pre>
              <pre>{result.text}</pre>
            </div>
          ) : (
            <pre className="writer-result">{result?.text}</pre>
          )}
          <DialogFooter>
            {result?.action === "polish" && (
              <Button
                onClick={() => {
                  if (!chapter || result.chapterIds[0] !== chapter.id) return;
                  if (locked || chapter.content !== result.fullSource) {
                    setError("正文已改变或已定稿，请重新润色。");
                    return;
                  }
                  const range = result.range;
                  const source = range?.quote || chapter.content;
                  if (source !== result.source) {
                    setError("正文已改变，请重新润色。");
                    return;
                  }
                  changeContent(
                    range
                      ? chapter.content.slice(0, range.start) +
                          result.text +
                          chapter.content.slice(range.end)
                      : result.text,
                  );
                  setResult(null);
                }}
              >
                采用润色
              </Button>
            )}
            <Button variant="outline" onClick={() => setResult(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
