import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { saveCreation, type CreationProject } from "./creation";
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
export function useProjectDraft(initial: CreationProject) {
  const [project, setProject] = useState(initial);
  const [state, setState] = useState("已保存");
  const [error, setError] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [backupError, setBackupError] = useState("");
  const current = useRef(initial);
  const saved = useRef(initial);
  const saving = useRef<Promise<CreationProject> | null>(null);
  const mounted = useRef(true);
  const contentKey = (p: CreationProject) =>
    JSON.stringify({
      title: p.title,
      genre: p.genre,
      audience: p.audience,
      documents: p.documents,
      volumes: p.volumes,
      guidance: p.guidance,
    });
  const dirty = () => current.current !== saved.current;
  const backupTimer = useRef<number | null>(null);
  const backupNow = (p: CreationProject) => {
    try {
      localStorage.setItem(
        `inkscope-creation-draft-${p.id}`,
        JSON.stringify(p),
      );
      if (mounted.current) setBackupError("");
    } catch {
      if (mounted.current)
        setBackupError(
          "本机恢复副本暂不可用，数据库自动保存仍会继续。请及时保存或导出当前草稿。",
        );
    }
  };
  const backup = (p: CreationProject) => {
    if (backupTimer.current !== null) window.clearTimeout(backupTimer.current);
    backupTimer.current = window.setTimeout(() => {
      backupTimer.current = null;
      backupNow(p);
    }, 250);
  };
  const replace = (p: CreationProject) => {
    current.current = p;
    saved.current = p;
    backup(p);
    setProject(p);
    setState("已保存");
    setError("");
  };
  const change = (update: (p: CreationProject) => CreationProject) => {
    const p = update(current.current);
    current.current = p;
    backup(p);
    setProject(p);
    setState("待保存");
  };
  const flush = async (): Promise<CreationProject> => {
    if (saving.current) {
      await saving.current;
      return flush();
    }
    if (!dirty()) return current.current;
    const snapshot = current.current;
    if (mounted.current) setState("保存中…");
    const request = saveCreation(snapshot);
    saving.current = request;
    try {
      const result = await request;
      saved.current = result;
      current.current =
        current.current === snapshot
          ? result
          : {
              ...current.current,
              revision: result.revision,
              updatedAt: result.updatedAt,
            };
      backup(current.current);
      if (mounted.current) {
        setProject(current.current);
        setError("");
        setState(dirty() ? "待保存" : "已保存");
      }
    } catch (e) {
      if (mounted.current) {
        setError(message(e));
        setState("保存失败 · 草稿仍保留");
      }
      throw e;
    } finally {
      saving.current = null;
    }
    if (dirty()) return flush();
    return current.current;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    mounted.current = true;
    try {
      if (localStorage.getItem(`inkscope-creation-conflict-${initial.id}`))
        setRecoveryError(
          "发现旧版未保存草稿，已单独保留。请导出恢复草稿再决定如何合并。",
        );
      const raw = localStorage.getItem(`inkscope-creation-draft-${initial.id}`);
      if (raw) {
        const draft = JSON.parse(raw) as CreationProject;
        if (
          draft.id === initial.id &&
          contentKey(draft) !== contentKey(initial)
        ) {
          if (draft.revision === initial.revision) {
            current.current = draft;
            setProject(draft);
            setState("已恢复未保存草稿");
            toast.info("已恢复上次未保存的草稿");
          } else {
            localStorage.setItem(
              `inkscope-creation-conflict-${initial.id}`,
              raw,
            );
            setRecoveryError(
              "发现旧版未保存草稿，已单独保留。请导出恢复草稿再决定如何合并。",
            );
          }
        }
      }
    } catch {
      /* Ignore invalid recovery data, keep database source. */
    }
    const timer = window.setInterval(() => {
      if (dirty() && !saving.current) void flushRef.current().catch(() => {});
    }, 900);
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty()) {
        backupNow(current.current);
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      if (backupTimer.current !== null) {
        window.clearTimeout(backupTimer.current);
        backupTimer.current = null;
        backupNow(current.current);
      }
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", unload);
    };
  }, [initial]);
  return {
    project,
    state,
    error: error || recoveryError || backupError,
    change,
    flush,
    replace,
    dirty,
  };
}
