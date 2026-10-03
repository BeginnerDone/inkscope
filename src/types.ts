export type ModelConfig = {
  apiKey: string;
  model: "deepseek-v4-flash" | "deepseek-v4-pro";
  baseUrl: string;
};

export type Dimension = { name: string; score: number; finding: string };
export type PlotStage = { name: string; summary: string; tension: number };
export type CharacterInsight = {
  name: string;
  role: string;
  desire: string;
  arc: string;
  relationships: string[];
};
export type CraftInsight = {
  title: string;
  evidence: string;
  method: string;
  transfer: string;
};
export type Foreshadowing = { setup: string; payoff: string; effect: string };
export type Idea = {
  title: string;
  premise: string;
  difference: string;
  risk: string;
  platform?: string;
  genre?: string;
  audience?: string;
  sellingPoint?: string;
  sourceAnchor?: string;
  convention?: string;
  ruleBreak?: string;
  differences?: Array<{
    axis: string;
    original: string;
    proposal: string;
    consequence: string;
  }>;
  opening?: Array<{
    chapter: string;
    event: string;
    reward: string;
    hook: string;
  }>;
  firstPayoff?: string;
  storyEngine?: string;
  escalation?: Array<{ stage: string; conflict: string; payoff: string }>;
  platformFit?: string;
  alternatePlatform?: string;
  validation?: string;
};
export type OutlineStage = {
  act: string;
  purpose: string;
  keyPlot: string;
  climax: string;
  mainLine: string;
  hiddenLine: string;
  readerExpectation: string;
  payoff: string;
  chapters: string;
  writingTask: string;
};
export type OutlineVolume = {
  name: string;
  role: string;
  chapters: string;
  mainLine: string;
  hiddenLine: string;
  keyPlots: string[];
  climax: string;
  endingHook: string;
  craftFocus: string;
  newBookPlaceholder: string;
};
export type ReusableOutlineTemplate = {
  title: string;
  premise: string;
  fiveAct: Array<{
    act: string;
    task: string;
    mustHave: string[];
    avoid: string;
  }>;
  volumes: OutlineVolume[];
  characterTracks: Array<{
    name: string;
    function: string;
    entrance: string;
    growth: string;
    turn: string;
    exit: string;
    reusableSlot: string;
  }>;
  threadMap: Array<{
    thread: string;
    type: string;
    setup: string;
    development: string;
    payoff: string;
    reusableQuestion: string;
  }>;
  keyPlotBeats: string[];
  climaxLadder: string[];
  expectationPayoffRules: string[];
  fillInPrompt: string;
};

export type DownloadReceipt = {
  sourceKey: string;
  bookUrl: string;
  totalChapters: number;
  downloadedChapters: number;
  failedChapters: number;
  checkedAt: string;
};
export type AnalysisPreparation = {
  book: BookSummary;
  canDownload: boolean;
  message: string;
};
export type ReadingCoverage = {
  pipelineVersion: number;
  method: string;
  contentStatus: string;
  totalCharacters: number;
  processedCharacters: number;
  totalSegments: number;
  processedSegments: number;
  downloadReceipt?: DownloadReceipt | null;
  segments: Array<{
    segment: number;
    characterStart: number;
    characterEnd: number;
    summary: string;
    verificationStatus?: "verified" | "partial";
    evidence: Array<{ quote: string; finding: string; characterStart: number; verified?: boolean }>;
  }>;
};
export type AnalysisReport = {
  coverage?: ReadingCoverage;
  title?: string;
  scope?: string;
  oneLine?: string;
  coreJudgment?: string;
  summary?: string;
  overallScore?: number;
  dimensions?: Dimension[];
  plot?: { structure?: string; stages?: PlotStage[] };
  characters?: CharacterInsight[];
  crafts?: CraftInsight[];
  foreshadowing?: Foreshadowing[];
  ideas?: Idea[];
  ideasVersion?: number;
  emotion?: Array<{ label: string; value: number }>;
  limitations?: string[];
  storyArchitecture?: {
    premise?: string;
    mainLine?: string;
    secondaryLines?: Array<{
      name: string;
      purpose: string;
      intersections: string[];
    }>;
    hiddenLines?: Array<{
      name: string;
      setup: string;
      reveal: string;
      effect: string;
    }>;
    opening?: TeachingSection;
    progression?: TeachingSection;
    climax?: TeachingSection;
    ending?: TeachingSection;
    chapterBlueprint?: Array<{
      phase: string;
      goal: string;
      chapters: string;
      conflict: string;
      turningPoint: string;
      readerQuestion: string;
    }>;
  };
  characterDesign?: Array<{
    name: string;
    role: string;
    core: string;
    desire: string;
    fear: string;
    entrance: string;
    development: string;
    relationships: string;
    exit: string;
    techniques: string[];
    evidence: string;
    exercise: string;
  }>;
  sceneCraft?: Array<{
    scene: string;
    purpose: string;
    entry: string;
    sensory: string;
    conflict: string;
    transition: string;
    evidence: string;
    transfer: string;
  }>;
  readerExperience?: Array<{
    phase: string;
    expectation: string;
    delay: string;
    escalation: string;
    payoff: string;
    payoffType: string;
    intensity: number;
    evidence: string;
    nextHook: string;
    method: string[];
    pitfall: string;
  }>;
  writingLessons?: Array<{
    topic: string;
    principle: string;
    evidence: string;
    steps: string[];
    pitfall: string;
    exercise: string;
  }>;
  outline?: {
    originalBlueprint?: {
      premise?: string;
      fiveAct?: OutlineStage[];
      volumes?: OutlineVolume[];
      keyPlotBeats?: string[];
      climaxLadder?: string[];
      mainLine?: string;
      hiddenLines?: string[];
    };
    reusableTemplate?: ReusableOutlineTemplate;
  };
};

export type TeachingSection = {
  design: string;
  execution: string[];
  evidence: string[];
  readerEffect: string;
  beginnerMethod: string[];
  pitfalls: string[];
};

export type ReadingProgress = {
  position: number;
  ratio: number;
  updatedAt: string;
};
export type ReadingHistoryItem = ReadingProgress & { title: string };
export type ReadingClip = {
  id: string;
  position: number;
  chapterTitle: string;
  quote: string;
  note: string;
  paragraph: number;
  createdAt: string;
  updatedAt: string;
};
export type NewReadingClip = {
  bookId: string;
  position: number;
  quote: string;
  note: string;
  paragraph: number;
};

export type BookSummary = {
  lastReadAt?: string | null;
  readingChapterPosition?: number | null;
  readingRatio?: number | null;
  contentStatus?: "local" | "unknown" | "partial" | "complete";
  downloadReceipt?: DownloadReceipt | null;
  id: string;
  title: string;
  sourceType: "text" | "file" | "link" | "legado";
  sourceUri: string;
  characterCount: number;
  createdAt: string;
  updatedAt: string;
  status: "ready" | "analyzing" | "completed" | "failed";
  stage: string;
  completed: number;
  total: number;
  error?: string | null;
  model: string;
  report?: AnalysisReport | null;
  jobStartedAt: string;
  jobUpdatedAt: string;
};

export type CreateBookInput = {
  downloadReceipt?: DownloadReceipt;
  title: string;
  sourceType: "text" | "file" | "link" | "legado";
  sourceUri?: string;
  content: string;
};

export type LegadoSource = {
  key: string;
  name: string;
  group: string;
  url: string;
  searchCompatible: boolean;
  importCompatible: boolean;
  reason: string;
  responseTime: number;
};

export type LegadoSourceStatus = {
  installed: boolean;
  repositoryUrl: string;
  total: number;
  searchable: number;
  importable: number;
  sources: LegadoSource[];
};

export type LegadoSearchResult = {
  sourceKey: string;
  sourceName: string;
  title: string;
  author: string;
  intro: string;
  coverUrl: string;
  /** Source-reported count; null when unavailable, not a measured full-text count. */
  wordCount?: number | null;
  bookUrl: string;
  importCompatible: boolean;
};

export type LegadoSearchResponse = {
  results: LegadoSearchResult[];
  searchedSources: number;
  failedSources: string[];
};

export type LegadoExtractedBook = {
  receipt: DownloadReceipt;
  title: string;
  content: string;
  sourceUri: string;
  sourceName: string;
  chapterCount: number;
  failedChapters: number;
};

export type ChapterSummary = {
  position: number;
  title: string;
  characterCount: number;
};
export type ChapterDetail = ChapterSummary & { content: string };
export type RemoteChapter = {
  position: number;
  title: string;
  chapterUrl: string;
};
export type RemoteChapterDetail = {
  title: string;
  content: string;
  characterCount: number;
};
