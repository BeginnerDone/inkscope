import type {
  AnalysisPreparation,
  BookSummary,
  ChapterDetail,
  ChapterSummary,
  CreateBookInput,
  LegadoExtractedBook,
  LegadoSearchResponse,
  LegadoSourceStatus,
  ModelConfig,
  RemoteChapter,
  RemoteChapterDetail,
  ReadingProgress,
  ReadingHistoryItem,
  ReadingClip,
  NewReadingClip,
} from "../types";

declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke: <T>(
          command: string,
          args?: Record<string, unknown>,
        ) => Promise<T>;
      };
      event?: {
        listen: <T>(
          name: string,
          handler: (event: { payload: T }) => void,
        ) => Promise<() => void>;
      };
    };
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauri = () => !!window.__TAURI__?.core;

export const fetchSpeechAudio = (template: string, text: string) =>
  invoke<{ mime: string; bytes: number[] }>("fetch_speech_audio", {
    template,
    text,
  });

function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const tauri = window.__TAURI__?.core;
  if (!tauri)
    return Promise.reject(
      new Error("请使用 Tauri 客户端运行（npm run tauri）"),
    );
  return tauri.invoke<T>(command, args);
}

export const listBooks = (query = "") =>
  invoke<BookSummary[]>("list_books", { query: query || null });
export const getBook = (id: string) => invoke<BookSummary>("get_book", { id });
export const createBook = (input: CreateBookInput) =>
  invoke<BookSummary>("create_book", { input });
export const deleteBook = (id: string) => invoke<void>("delete_book", { id });
export const testModel = (config: ModelConfig) =>
  invoke<boolean>("test_model", { config });
export const startAnalysis = (
  id: string,
  config: ModelConfig,
  allowPartial = false,
) => invoke<void>("start_analysis", { id, config, allowPartial });
const preparations = new Map<string, Promise<AnalysisPreparation>>();
export const prepareAnalysis = (id: string) => {
  const pending = preparations.get(id);
  if (pending) return pending;
  const request = invoke<AnalysisPreparation>("prepare_analysis", {
    id,
  }).finally(() => preparations.delete(id));
  preparations.set(id, request);
  return request;
};
export const getLegadoSourceStatus = () =>
  invoke<LegadoSourceStatus>("get_legado_source_status");
export const syncLegadoSources = (repositoryUrl?: string) =>
  invoke<LegadoSourceStatus>("sync_legado_sources", {
    repositoryUrl: repositoryUrl || null,
  });
export const searchLegadoBooks = (
  query: string,
  sourceKeys: string[],
  mode: "keyword" | "author" = "keyword",
) =>
  invoke<LegadoSearchResponse>("search_legado_books", {
    query,
    sourceKeys,
    mode,
  });
export const extractLegadoBook = (request: {
  sourceKey: string;
  bookUrl: string;
  title: string;
  maxChapters: number;
  progressId?: string;
}) => invoke<LegadoExtractedBook>("extract_legado_book", { request });
export type DownloadProgress = {
  progressId: string;
  completed: number;
  total: number;
  failed: number;
  phase: "catalog" | "downloading" | "finished";
};
export const listenDownloadProgress = (
  handler: (progress: DownloadProgress) => void,
) => {
  const listen = window.__TAURI__?.event?.listen;
  if (!listen) return Promise.resolve(() => {});
  return listen<DownloadProgress>("legado-download-progress", ({ payload }) =>
    handler(payload),
  );
};
export const listChapters = (id: string) =>
  invoke<ChapterSummary[]>("list_chapters", { id });
export const getChapter = (id: string, position: number) =>
  invoke<ChapterDetail>("get_chapter", { id, position });
export const previewLegadoToc = (request: {
  sourceKey: string;
  bookUrl: string;
}) => invoke<RemoteChapter[]>("preview_legado_toc", { request });
export const previewLegadoChapter = (
  sourceKey: string,
  chapterUrl: string,
  title: string,
) =>
  invoke<RemoteChapterDetail>("preview_legado_chapter", {
    sourceKey,
    chapterUrl,
    title,
  });
export const refreshLegadoBook = (id: string, progressId?: string) =>
  invoke<BookSummary>("refresh_legado_book", { id, progressId });
export const exportBook = (id: string, format: "txt" | "docx") =>
  invoke<string>("export_book", { id, format });

export const getReadingProgress = (id: string) =>
  invoke<ReadingProgress | null>("get_reading_progress", { id });
export const saveReadingProgress = (
  id: string,
  position: number,
  ratio: number,
) => invoke<void>("save_reading_progress", { id, position, ratio });
export const listReadingHistory = (id: string) =>
  invoke<ReadingHistoryItem[]>("list_reading_history", { id });
export const listReadingClips = (id: string) =>
  invoke<ReadingClip[]>("list_reading_clips", { id });
export const saveReadingClip = (input: NewReadingClip) =>
  invoke<ReadingClip>("save_reading_clip", { input });
export const updateReadingClip = (id: string, clipId: string, note: string) =>
  invoke<void>("update_reading_clip", { id, clipId, note });
export const deleteReadingClip = (id: string, clipId: string) =>
  invoke<void>("delete_reading_clip", { id, clipId });
