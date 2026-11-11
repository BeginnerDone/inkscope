import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { readStorage, writeStorage } from "./storage";

// One preference per project, shared by manual writing and AI creation.
export function useVolumeExpansion(projectId: string, activeVolumeId?: string) {
  const key = `inkscope-volume-tree-${projectId}`;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(readStorage(key) || "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
      return Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "boolean")) as Record<string, boolean>;
    } catch { return {}; }
  });
  const current = useRef(expanded);
  const initialActive = useRef(activeVolumeId);
  const setOpen = useCallback((id: string, open: boolean) => {
    if (current.current[id] === open) return;
    const next = { ...current.current, [id]: open };
    current.current = next;
    setExpanded(next);
    void writeStorage(key, JSON.stringify(next)).catch(() => toast.error("未能保存分卷折叠状态，本次操作仍然有效"));
  }, [key]);
  useEffect(() => {
    if (activeVolumeId !== initialActive.current) {
      initialActive.current = activeVolumeId;
      if (activeVolumeId) setOpen(activeVolumeId, true);
    }
  }, [activeVolumeId, setOpen]);
  return { isOpen: (id: string) => expanded[id] ?? id === activeVolumeId, setOpen };
}
