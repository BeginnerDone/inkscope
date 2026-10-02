export type ReaderTheme = "white" | "paper" | "mist" | "sage" | "night";
export type ReaderPrefs = {
  theme: ReaderTheme;
  fontSize: number;
  lineHeight: number;
  paragraphGap: number;
  columnWidth: number;
  serif: boolean;
};

const storageKey = "inkscope-reader-v1";
export const defaultReaderPrefs: ReaderPrefs = {
  theme: "white",
  fontSize: 17,
  lineHeight: 1.82,
  paragraphGap: 0.72,
  columnWidth: 740,
  serif: false,
};
const themes = new Set<ReaderTheme>([
  "white",
  "paper",
  "mist",
  "sage",
  "night",
]);
export function readReaderPrefs(): ReaderPrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return {
      theme: themes.has(stored.theme) ? stored.theme : defaultReaderPrefs.theme,
      fontSize: Number.isFinite(stored.fontSize)
        ? Math.max(14, Math.min(24, stored.fontSize))
        : defaultReaderPrefs.fontSize,
      lineHeight: Number.isFinite(stored.lineHeight)
        ? Math.max(1.55, Math.min(2.1, stored.lineHeight))
        : defaultReaderPrefs.lineHeight,
      paragraphGap: Number.isFinite(stored.paragraphGap)
        ? Math.max(0.35, Math.min(1.25, stored.paragraphGap))
        : defaultReaderPrefs.paragraphGap,
      columnWidth: Number.isFinite(stored.columnWidth)
        ? Math.max(600, Math.min(900, stored.columnWidth))
        : defaultReaderPrefs.columnWidth,
      serif: stored.serif === true,
    };
  } catch {
    return defaultReaderPrefs;
  }
}
export function saveReaderPrefs(prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(prefs));
  } catch {
    /* Private storage can be unavailable. */
  }
}
export function readerParagraphs(content: string): string[] {
  return content
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}
export type QuoteRange = { paragraph: number; start: number; end: number };
export function findQuoteRanges(
  paragraphs: string[],
  quote: string,
  preferredParagraph = 0,
): QuoteRange[] {
  const positions: Array<{ paragraph: number; start: number; end: number }> =
    [];
  const characters: string[] = [];
  paragraphs.forEach((paragraph, index) => {
    let offset = 0;
    for (const character of paragraph) {
      if (!/\s/u.test(character)) {
        characters.push(character);
        positions.push({
          paragraph: index,
          start: offset,
          end: offset + character.length,
        });
      }
      offset += character.length;
    }
  });
  const needle = Array.from(quote)
    .filter((character) => !/\s/u.test(character))
    .join("");
  if (!needle) return [];
  const text = characters.join("");
  const preferredIndex = positions.findIndex(
    (item) => item.paragraph >= preferredParagraph,
  );
  let match = text.indexOf(
    needle,
    preferredIndex < 0
      ? 0
      : characters.slice(0, preferredIndex).join("").length,
  );
  if (match < 0) match = text.indexOf(needle);
  if (match < 0) return [];
  const first = Array.from(text.slice(0, match)).length;
  const count = Array.from(needle).length;
  const selected = positions.slice(first, first + count);
  const ranges: QuoteRange[] = [];
  for (const item of selected) {
    const last = ranges[ranges.length - 1];
    if (last?.paragraph === item.paragraph) last.end = item.end;
    else ranges.push({ ...item });
  }
  return ranges;
}
export function formatExactWords(count: number): string {
  return `${Math.max(0, count).toLocaleString("zh-CN")} 字`;
}
export function approximateBookProgress(
  chapters: Array<{ characterCount: number; position: number }>,
  position: number,
  ratio: number,
): number {
  const total = chapters.reduce(
    (sum, item) => sum + Math.max(0, item.characterCount),
    0,
  );
  if (!total) return 0;
  const read = chapters.reduce(
    (sum, item) =>
      sum +
      (item.position < position
        ? Math.max(0, item.characterCount)
        : item.position === position
          ? Math.max(0, item.characterCount) * Math.max(0, Math.min(1, ratio))
          : 0),
    0,
  );
  return Math.round((read / total) * 100);
}
