import type { BookSummary, ChapterDetail, ChapterSummary, CreateBookInput, LegadoExtractedBook, LegadoSearchResponse, LegadoSourceStatus, ModelConfig, RemoteChapter, RemoteChapterDetail } from '../types'

declare global {
  interface Window {
    __TAURI__?: { core: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }
    __TAURI_INTERNALS__?: unknown
  }
}

export const isTauri = () => !!window.__TAURI__?.core

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = window.__TAURI__?.core
  if (!tauri) return Promise.reject(new Error('请使用 Tauri 客户端运行（npm run tauri）'))
  return tauri.invoke<T>(command, args)
}

export const listBooks = (query = '') => invoke<BookSummary[]>('list_books', { query: query || null })
export const getBook = (id: string) => invoke<BookSummary>('get_book', { id })
export const createBook = (input: CreateBookInput) => invoke<BookSummary>('create_book', { input })
export const deleteBook = (id: string) => invoke<void>('delete_book', { id })
export const testModel = (config: ModelConfig) => invoke<boolean>('test_model', { config })
export const startAnalysis = (id: string, config: ModelConfig) => invoke<void>('start_analysis', { id, config })
export const getLegadoSourceStatus = () => invoke<LegadoSourceStatus>('get_legado_source_status')
export const syncLegadoSources = (repositoryUrl?: string) => invoke<LegadoSourceStatus>('sync_legado_sources', { repositoryUrl: repositoryUrl || null })
export const searchLegadoBooks = (query: string, sourceKeys: string[]) => invoke<LegadoSearchResponse>('search_legado_books', { query, sourceKeys })
export const extractLegadoBook = (request: { sourceKey:string; bookUrl:string; title:string; maxChapters:number }) => invoke<LegadoExtractedBook>('extract_legado_book', { request })
export const listChapters = (id:string) => invoke<ChapterSummary[]>('list_chapters',{id})
export const getChapter = (id:string,position:number) => invoke<ChapterDetail>('get_chapter',{id,position})
export const previewLegadoToc = (request:{sourceKey:string;bookUrl:string}) => invoke<RemoteChapter[]>('preview_legado_toc',{request})
export const previewLegadoChapter = (sourceKey:string,chapterUrl:string,title:string) => invoke<RemoteChapterDetail>('preview_legado_chapter',{sourceKey,chapterUrl,title})
export const refreshLegadoBook = (id:string) => invoke<BookSummary>('refresh_legado_book',{id})
export const exportBook = (id:string,format:'txt'|'docx') => invoke<string>('export_book',{id,format})
