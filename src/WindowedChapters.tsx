import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CreationDoc } from "./lib/creation";

const rowHeight = 34;
const overscan = 6;

/** Keep a long volume in the shared directory scroll area without mounting every row. */
export function WindowedChapters({ chapters, selectedId, children }: {
  chapters: CreationDoc[];
  selectedId: string;
  children: (chapter: CreationDoc) => ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 32 });
  const pendingFocus = useRef<number | null>(null);
  const measureRange = useRef<(() => void) | null>(null);
  const virtual = chapters.length > 80;
  const selectedIndex = chapters.findIndex(d => d.id === selectedId);

  useLayoutEffect(() => {
    if (!virtual || !list.current) return;
    const node = list.current;
    const scroll = node.closest<HTMLElement>(".writer-tree, .creation-navigation-tree")!;
    let frame = 0;
    const measure = () => {
      const offset = scroll.getBoundingClientRect().top + scroll.clientTop - node.getBoundingClientRect().top;
      const start = Math.min(chapters.length, Math.max(0, Math.floor(offset / rowHeight) - overscan));
      const end = Math.min(chapters.length, Math.max(start, Math.ceil((offset + scroll.clientHeight) / rowHeight) + overscan));
      setRange(old => old.start === start && old.end === end ? old : { start, end });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measureRange.current = measure;
    measure();
    scroll.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    observer.observe(node);
    return () => { measureRange.current = null; cancelAnimationFrame(frame); observer.disconnect(); scroll.removeEventListener("scroll", schedule); };
  }, [virtual, chapters.length]);

  // Folding an earlier volume changes this list's position without resizing it.
  useLayoutEffect(() => { measureRange.current?.(); });

  useLayoutEffect(() => {
    if (!virtual || selectedIndex < 0 || !list.current) return;
    const node = list.current;
    const scroll = node.closest<HTMLElement>(".writer-tree, .creation-navigation-tree")!;
    const top = node.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientTop + selectedIndex * rowHeight;
    if (top < 0) scroll.scrollTop += top;
    else if (top + rowHeight > scroll.clientHeight) scroll.scrollTop += top + rowHeight - scroll.clientHeight;
  }, [virtual, selectedIndex]);

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const button = list.current?.querySelector<HTMLElement>(`[data-chapter-index="${pendingFocus.current}"] button`);
    if (button) { button.focus({ preventScroll: true }); pendingFocus.current = null; }
  }, [range]);

  const start = virtual ? range.start : 0;
  const end = virtual ? range.end : chapters.length;
  return <div ref={list} className="windowed-chapters" style={virtual ? { height: chapters.length * rowHeight, position: "relative" } : undefined}
    onKeyDown={event => {
      if (!virtual || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-chapter-index]");
      if (!row) return;
      event.preventDefault();
      const index = Number(row.dataset.chapterIndex);
      const target = event.key === "Home" ? 0 : event.key === "End" ? chapters.length - 1 : Math.max(0, Math.min(chapters.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      const scroll = list.current!.closest<HTMLElement>(".writer-tree, .creation-navigation-tree")!;
      pendingFocus.current = target;
      const top = list.current!.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientTop + target * rowHeight;
      if (top < 0) scroll.scrollTop += top;
      else if (top + rowHeight > scroll.clientHeight) scroll.scrollTop += top + rowHeight - scroll.clientHeight;
      const button = list.current?.querySelector<HTMLElement>(`[data-chapter-index="${target}"] button`);
      if (button) { button.focus({ preventScroll: true }); pendingFocus.current = null; }
    }}>
    {chapters.slice(start, end).map((doc, offset) => <div key={doc.id} data-chapter-index={start + offset} style={virtual ? { position: "absolute", top: (start + offset) * rowHeight, width: "100%", height: rowHeight } : undefined}>{children(doc)}</div>)}
  </div>;
}
