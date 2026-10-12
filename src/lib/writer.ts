import type { CreationDoc, CreationProject } from "./creation";
import { invoke } from "./tauri";
import type { ModelConfig } from "../types";
export const isTrash = (d: CreationDoc) => d.details?.category === "trash";
type WriterResponse = {
  text?: string;
  names?: string[];
  corrections?: { quote: string; replacement: string; reason: string }[];
  evidence?: { quote: string; reason: string }[];
};
export async function writerAI(action: string, text: string, instruction: string, config: ModelConfig, suffix = ""): Promise<WriterResponse> {
  const raw = await invoke<WriterResponse>("writer_assist", { action, text, instruction, config, suffix });
  if (!raw || typeof raw !== "object") throw new Error("AI 返回格式无效，请重试。正文未修改。");
  const result: WriterResponse = {};
  if (typeof raw.text === "string") result.text = raw.text;
  if (Array.isArray(raw.names)) result.names = raw.names.filter((v): v is string => typeof v === "string");
  if (Array.isArray(raw.corrections)) result.corrections = raw.corrections.filter(v => v && typeof v.quote === "string" && typeof v.replacement === "string" && typeof v.reason === "string");
  if (Array.isArray(raw.evidence)) result.evidence = raw.evidence.filter(v => v && typeof v.quote === "string" && typeof v.reason === "string");
  return result;
}
export function archive(p: CreationProject, ids: string[]): CreationProject {
  return {
    ...p,
    documents: p.documents.flatMap((d) =>
      ids.includes(d.id) && !["chapter", "resource"].includes(d.kind)
        ? [
            { ...d, content: "", goal: "" },
            {
              ...d,
              id: crypto.randomUUID(),
              kind: "resource" as const,
              volumeId: "",
              details: {
                ...d.details,
                category: "trash",
                originalKind: "canonical",
                canonicalId: d.id,
                originalCategory: d.details?.category || "",
                deletedAt: new Date().toISOString(),
              },
            },
          ]
        : [
            ids.includes(d.id)
              ? {
                  ...d,
                  kind: "resource",
                  volumeId: "",
                  details: {
                    ...d.details,
                    category: "trash",
                    originalKind: d.kind,
                    originalVolume: d.volumeId,
                    volumeTitle:
                      p.volumes.find((v) => v.id === d.volumeId)?.title || "",
                    originalCategory: d.details?.category || "",
                    deletedAt: new Date().toISOString(),
                  },
                }
              : d,
          ],
    ),
  };
}
export function restore(p: CreationProject, id: string): CreationProject {
  const d = p.documents.find((d) => d.id === id);
  if (!d) return p;
  if (d.details?.originalKind === "canonical") {
    const target = p.documents.find((x) => x.id === d.details?.canonicalId);
    if (target?.content.trim())
      throw new Error("当前资料已有新内容，请先清空或复制后再恢复，避免覆盖。");
    return {
      ...p,
      documents: p.documents
        .filter((x) => x.id !== id)
        .map((x) =>
          x.id === d.details?.canonicalId
            ? { ...x, content: d.content, goal: d.goal }
            : x,
        ),
    };
  }
  let volumes = p.volumes;
  if (
    d.details?.originalKind === "chapter" &&
    !volumes.some((v) => v.id === d.details?.originalVolume)
  )
    volumes = [
      ...volumes,
      {
        id: d.details?.originalVolume || crypto.randomUUID(),
        title: d.details?.volumeTitle || "恢复的分卷",
      },
    ];
  return {
    ...p,
    volumes,
    documents: p.documents.map((d) =>
      d.id === id
        ? {
            ...d,
            kind: (d.details?.originalKind ||
              "resource") as CreationDoc["kind"],
            volumeId:
              d.details?.originalKind === "chapter"
                ? d.details?.originalVolume || volumes.at(-1)!.id
                : "",
            details: {
              ...d.details,
              category: d.details?.originalCategory || "reference",
              deletedAt: "",
            },
          }
        : d,
    ),
  };
}
export function updateAnchors(
  documents: CreationDoc[],
  chapterId: string,
  content: string,
  previous?: string,
): CreationDoc[] {
  let prefix = 0,
    suffix = 0;
  if (previous !== undefined) {
    while (
      prefix < Math.min(previous.length, content.length) &&
      previous[prefix] === content[prefix]
    )
      prefix++;
    while (
      suffix < Math.min(previous.length, content.length) - prefix &&
      previous[previous.length - 1 - suffix] ===
        content[content.length - 1 - suffix]
    )
      suffix++;
  }
  const locate = (quote: string, prior: number) => {
    let predicted = prior;
    if (previous !== undefined && prior >= previous.length - suffix)
      predicted += content.length - previous.length;
    if (
      quote &&
      predicted >= 0 &&
      content.slice(predicted, predicted + quote.length) === quote
    )
      return {
        start: predicted,
        end: predicted + quote.length,
        anchorState: "已定位",
      };
    const start = quote ? content.indexOf(quote) : -1;
    const ambiguous = start >= 0 && content.indexOf(quote, start + 1) >= 0;
    return {
      start,
      end: start + quote.length,
      anchorState: start < 0 || ambiguous ? "需重新定位" : "已定位",
    };
  };
  return documents.map((d) => {
    if (d.details?.category !== "foreshadow") return d;
    let details = { ...d.details };
    if (details.chapterId === chapterId) {
      const anchor = locate(details.quote || "", Number(details.start || 0));
      details = {
        ...details,
        start: String(anchor.start),
        end: String(anchor.end),
        anchorState: anchor.anchorState,
      };
    }
    if (details.recoveryLinks) {
      try {
        const links = JSON.parse(details.recoveryLinks) as {
          chapterId: string;
          quote: string;
          start: number;
        }[];
        details.recoveryLinks = JSON.stringify(
          links.map((r) =>
            r.chapterId === chapterId
              ? { ...r, ...locate(r.quote, r.start) }
              : r,
          ),
        );
      } catch {
        /* Existing malformed metadata remains intact for manual repair. */
      }
    }
    return { ...d, details };
  });
}
