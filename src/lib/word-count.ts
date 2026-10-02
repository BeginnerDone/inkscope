const tenThousands = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

/** Count Unicode code points, including punctuation and whitespace, as Rust chars() does. */
export function countText(text: string): number {
  let count = 0;
  for (const _character of text) count += 1;
  return count;
}

export function formatWordCount(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count) || count < 0) return "字数未知";
  if (count > 0 && count < 100) return "不足 0.01 万字";
  return `${tenThousands.format(count / 10_000)} 万字`;
}

export function formatSourceWordCount(
  count: number | null | undefined,
): string {
  const formatted = formatWordCount(count);
  return formatted === "字数未知" ? formatted : `书源约 ${formatted}`;
}

export const sourceWordCountNote =
  "书源标注字数，可能不含标点；导入后按实际正文统计，包含标点和空白。";
