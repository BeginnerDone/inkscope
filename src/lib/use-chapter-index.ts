import { useMemo, useRef } from "react";
import type { CreationDoc, CreationProject } from "./creation";
import { countText } from "./word-count";

// A title edit or panel toggle must not recount millions of unchanged characters.
export function useChapterIndex(project: CreationProject) {
  const cache = useRef(new Map<string, { content: string; count: number }>());
  return useMemo(() => {
    const byVolume = new Map<string, CreationDoc[]>();
    const counts = new Map<string, number>();
    const next = new Map<string, { content: string; count: number }>();
    let total = 0;
    for (const doc of project.documents) {
      if (doc.kind !== "chapter") continue;
      const previous = cache.current.get(doc.id);
      const entry = previous?.content === doc.content
        ? previous
        : { content: doc.content, count: countText(doc.content) };
      next.set(doc.id, entry);
      counts.set(doc.id, entry.count);
      const group = byVolume.get(doc.volumeId) || [];
      if (!byVolume.has(doc.volumeId)) byVolume.set(doc.volumeId, group);
      group.push(doc);
    }
    const chapters = project.volumes.flatMap(v => byVolume.get(v.id) || []);
    for (const doc of chapters) total += counts.get(doc.id) || 0;
    cache.current = next;
    return { chapters, byVolume, counts, total };
  }, [project.documents, project.volumes]);
}
