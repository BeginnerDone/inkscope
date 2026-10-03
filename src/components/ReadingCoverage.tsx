import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatWordCount } from "@/lib/word-count";
import type { ReadingCoverage as Coverage } from "@/types";

export function ReadingCoverage({ coverage }: { coverage?: Coverage }) {
  const [page, setPage] = useState(0);
  if (!coverage)
    return (
      <p className="mb-4 rounded-lg border bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground">
        此报告由旧版流程生成，尚无逐段正文核验记录。重新分析后可查看覆盖范围与原文依据。
      </p>
    );
  const segments = coverage.segments ?? [];
  const partialCount = segments.filter((segment) => segment.verificationStatus === "partial").length;
  const pages = Math.ceil(segments.length / 8);
  return (
    <details className="mb-4 rounded-lg border bg-muted/20 text-sm">
      <summary className="cursor-pointer px-4 py-3 focus-visible:outline-ring">
        正文审读记录 · {coverage.processedSegments} / {coverage.totalSegments}{" "}
        段 · {formatWordCount(coverage.processedCharacters)}
        <span className="ml-2 text-xs text-muted-foreground">
          {partialCount > 0 ? `${partialCount} 段引用待复核 · ` : ""}查看范围与原文依据
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t px-4 py-3">
        <p className="text-xs leading-5 text-muted-foreground">
          {coverage.contentStatus === "complete"
            ? "范围：下载时书源目录的全部已保存正文，不代表作品已完结。"
            : "范围：本地已保存正文，全本完整性未确认。"}{" "}
          每段全文提交模型，并核对前、中、后三处引文；未核对成功的引文仅显示原文定位摘录，不作为已核验依据，相关模型判断待复核。综合报告使用审读记录。覆盖记录不等于保证模型理解无遗漏。
        </p>
        {segments.slice(page * 8, page * 8 + 8).map((segment) => (
          <details key={segment.segment} className="border-t pt-3">
            <summary className="cursor-pointer text-xs">
              片段 {segment.segment} · 第{" "}
              {segment.characterStart.toLocaleString()}—
              {segment.characterEnd.toLocaleString()} 字
              {segment.verificationStatus === "partial" ? " · 引用待复核" : ""}
            </summary>
            <p className="mt-2 text-sm leading-6">{segment.summary}</p>
            <div className="mt-2 flex flex-col gap-2">
              {segment.evidence.map((item, index) => (
                <blockquote
                  key={index}
                  className="border-l-2 pl-3 text-xs leading-5 text-muted-foreground"
                >
                  <p>“{item.quote}”</p>
                  <p>
                    第 {item.characterStart.toLocaleString()} 字起 ·{" "}
                    {item.verified === false ? "待复核 · " : "已核验 · "}{item.finding}
                  </p>
                </blockquote>
              ))}
            </div>
          </details>
        ))}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-3">
            <Button
              size="sm"
              variant="ghost"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className="text-xs text-muted-foreground">
              {page + 1} / {pages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={page + 1 >= pages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
