import type { ModelConfig } from "../types";

export type CreationDoc = {
  id: string;
  kind:
    | "brief"
    | "rules"
    | "characters"
    | "outline"
    | "facts"
    | "style"
    | "chapter"
    | "resource"
    | "source";
  title: string;
  content: string;
  goal: string;
  volumeId: string;
  details?: Record<string, string>;
};
export type CreationProject = {
  id: string;
  title: string;
  genre: string;
  audience: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  documents: CreationDoc[];
  volumes: { id: string; title: string }[];
  guidance: Record<string, string>;
};
export type CreationSummary = Pick<
  CreationProject,
  "id" | "title" | "genre" | "audience" | "revision" | "updatedAt"
> & { wordCount: number; chapterCount: number };
export type CreationSkill = {
  id: string;
  title: string;
  description: string;
  instructions: string;
  version: number;
};
export type CreationTask = {
  id: string;
  projectId: string;
  documentId: string;
  skill: string;
  instruction: string;
  revision: number;
  status: "running" | "ready" | "failed" | "accepted" | "dismissed";
  content: string;
  error: string;
  context: string;
  sourceContent: string;
  memory?: string;
  createdAt: string;
  model: string;
  workflowMode?: boolean;
  reviewId?: string | null;
  finalizationId?: string | null;
};
export type CreationVersion = {
  id: string;
  documentId: string;
  title: string;
  content: string;
  goal: string;
  reason: string;
  createdAt: string;
};

function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!window.__TAURI__?.core)
    return Promise.reject(new Error("请在 InkScope 桌面客户端中使用创作空间"));
  return window.__TAURI__.core.invoke<T>(command, args);
}
export const listCreations = () => invoke<CreationSummary[]>("list_creations");
export const getCreation = (id: string) =>
  invoke<CreationProject>("get_creation", { id });
export const createCreation = (input: {
  title: string;
  genre: string;
  audience: string;
  seed: string;
  content?: string;
  bookId?: string;
  importKind?: "prose" | "settings" | "reference";
  sourceName?: string;
}) => invoke<CreationProject>("create_creation", { input });
export const saveCreation = (project: CreationProject) =>
  invoke<CreationProject>("save_creation", { project });
export const creationSkills = () => invoke<CreationSkill[]>("creation_skills");
export const listCreationTasks = (id: string) =>
  invoke<CreationTask[]>("list_creation_tasks", { id });
export const generateCreation = (
  id: string,
  documentId: string,
  skill: string,
  instruction: string,
  config: ModelConfig,
  revision: number,
  workflow?: { workflowMode: boolean; reviewId?: string; finalizationId?: string },
) =>
  invoke<CreationTask>("generate_creation", {
    id,
    documentId,
    skill,
    instruction,
    config,
    revision,
    ...workflow,
  });
export const acceptCreationTask = (
  taskId: string,
  mode: "replace" | "append",
  revision: number,
) =>
  invoke<CreationProject>("accept_creation_task", { taskId, mode, revision });
export const dismissCreationTask = (taskId: string) =>
  invoke<void>("dismiss_creation_task", { taskId });
export const creationVersions = (id: string, documentId: string) =>
  invoke<CreationVersion[]>("creation_versions", { id, documentId });
export const restoreCreationVersion = (
  id: string,
  versionId: string,
  revision: number,
) =>
  invoke<CreationProject>("restore_creation_version", {
    id,
    versionId,
    revision,
  });
export const exportCreation = (id: string, format: "txt" | "docx") =>
  invoke<string>("export_creation", { id, format });

export const exportCreationDraft = (raw: string) =>
  invoke<string>("export_creation_draft", { raw });

export const deleteCreation = (id: string, revision: number) =>
  invoke<void>("delete_creation", { id, revision });

export type ChapterState = {
  review: { id: string; taskId: string | null; sourceContent: string; issues: string[]; createdAt: string } | null;
  activeFinalization: string | null;
  finalizations: { id: string; title: string; content: string; createdAt: string; revision: number }[];
  recordTaskIds: string[];
};
export const readCreationChapter = (id: string, documentId: string) => invoke<ChapterState>("read_creation_chapter", { id, documentId });
export const chapterAction = (input: { id: string; documentId: string; revision: number; action: "confirm_review" | "finalize" | "reopen" | "confirm_records"; taskId?: string; issues?: string[] }) => invoke<CreationProject>("creation_chapter_action", { input });
