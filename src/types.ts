export type ModelConfig = {
  apiKey: string
  model: 'deepseek-v4-flash' | 'deepseek-v4-pro'
  baseUrl: string
}

export type Dimension = { name: string; score: number; finding: string }
export type PlotStage = { name: string; summary: string; tension: number }
export type CharacterInsight = { name: string; role: string; desire: string; arc: string; relationships: string[] }
export type CraftInsight = { title: string; evidence: string; method: string; transfer: string }
export type Foreshadowing = { setup: string; payoff: string; effect: string }
export type Idea = { title: string; premise: string; difference: string; risk: string }
export type OutlineStage = { act:string; purpose:string; keyPlot:string; climax:string; mainLine:string; hiddenLine:string; readerExpectation:string; payoff:string; chapters:string; writingTask:string }
export type OutlineVolume = { name:string; role:string; chapters:string; mainLine:string; hiddenLine:string; keyPlots:string[]; climax:string; endingHook:string; craftFocus:string; newBookPlaceholder:string }
export type ReusableOutlineTemplate = { title:string; premise:string; fiveAct:Array<{ act:string; task:string; mustHave:string[]; avoid:string }>; volumes:OutlineVolume[]; characterTracks:Array<{ name:string; function:string; entrance:string; growth:string; turn:string; exit:string; reusableSlot:string }>; threadMap:Array<{ thread:string; type:string; setup:string; development:string; payoff:string; reusableQuestion:string }>; keyPlotBeats:string[]; climaxLadder:string[]; expectationPayoffRules:string[]; fillInPrompt:string }

export type AnalysisReport = {
  title?: string
  scope?: string
  oneLine?: string
  coreJudgment?: string
  summary?: string
  overallScore?: number
  dimensions?: Dimension[]
  plot?: { structure?: string; stages?: PlotStage[] }
  characters?: CharacterInsight[]
  crafts?: CraftInsight[]
  foreshadowing?: Foreshadowing[]
  ideas?: Idea[]
  emotion?: Array<{ label: string; value: number }>
  limitations?: string[]
  storyArchitecture?: {
    premise?: string
    mainLine?: string
    secondaryLines?: Array<{ name:string; purpose:string; intersections:string[] }>
    hiddenLines?: Array<{ name:string; setup:string; reveal:string; effect:string }>
    opening?: TeachingSection
    progression?: TeachingSection
    climax?: TeachingSection
    ending?: TeachingSection
    chapterBlueprint?: Array<{ phase:string; goal:string; chapters:string; conflict:string; turningPoint:string; readerQuestion:string }>
  }
  characterDesign?: Array<{ name:string; role:string; core:string; desire:string; fear:string; entrance:string; development:string; relationships:string; exit:string; techniques:string[]; evidence:string; exercise:string }>
  sceneCraft?: Array<{ scene:string; purpose:string; entry:string; sensory:string; conflict:string; transition:string; evidence:string; transfer:string }>
  readerExperience?: Array<{ phase:string; expectation:string; delay:string; escalation:string; payoff:string; payoffType:string; intensity:number; evidence:string; nextHook:string; method:string[]; pitfall:string }>
  writingLessons?: Array<{ topic:string; principle:string; evidence:string; steps:string[]; pitfall:string; exercise:string }>
  outline?: {
    originalBlueprint?: {
      premise?: string
      fiveAct?: OutlineStage[]
      volumes?: OutlineVolume[]
      keyPlotBeats?: string[]
      climaxLadder?: string[]
      mainLine?: string
      hiddenLines?: string[]
    }
    reusableTemplate?: ReusableOutlineTemplate
  }
}

export type TeachingSection = { design:string; execution:string[]; evidence:string[]; readerEffect:string; beginnerMethod:string[]; pitfalls:string[] }

export type BookSummary = {
  id: string
  title: string
  sourceType: 'text' | 'file' | 'link' | 'legado'
  sourceUri: string
  characterCount: number
  createdAt: string
  updatedAt: string
  status: 'ready' | 'analyzing' | 'completed' | 'failed'
  stage: string
  completed: number
  total: number
  error?: string | null
  model: string
  report?: AnalysisReport | null
  jobStartedAt: string
  jobUpdatedAt: string
}

export type CreateBookInput = {
  title: string
  sourceType: 'text' | 'file' | 'link' | 'legado'
  sourceUri?: string
  content: string
}

export type LegadoSource = {
  key: string
  name: string
  group: string
  url: string
  searchCompatible: boolean
  importCompatible: boolean
  reason: string
  responseTime: number
}

export type LegadoSourceStatus = {
  installed: boolean
  repositoryUrl: string
  total: number
  searchable: number
  importable: number
  sources: LegadoSource[]
}

export type LegadoSearchResult = {
  sourceKey: string
  sourceName: string
  title: string
  author: string
  intro: string
  coverUrl: string
  bookUrl: string
  importCompatible: boolean
}

export type LegadoSearchResponse = {
  results: LegadoSearchResult[]
  searchedSources: number
  failedSources: string[]
}

export type LegadoExtractedBook = {
  title: string
  content: string
  sourceUri: string
  sourceName: string
  chapterCount: number
  failedChapters: number
}

export type ChapterSummary = { position:number; title:string; characterCount:number }
export type ChapterDetail = ChapterSummary & { content:string }
export type RemoteChapter = { position:number; title:string; chapterUrl:string }
export type RemoteChapterDetail = { title:string; content:string; characterCount:number }
