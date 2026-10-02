import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listenDownloadProgress,
  prepareAnalysis,
  refreshLegadoBook,
} from "@/lib/tauri";
import type { DownloadProgress } from "@/lib/tauri";
import { Progress } from "@/components/ui/progress";
import { formatWordCount } from "@/lib/word-count";
import type { AnalysisPreparation, BookSummary } from "@/types";

export function AnalysisPreparationDialog({
  book,
  onClose,
  onStart,
  onUpdated,
}: {
  book: BookSummary;
  onClose: () => void;
  onStart: (book: BookSummary, allowPartial: boolean) => Promise<void>;
  onUpdated: (book: BookSummary) => Promise<void>;
}) {
  const [preparation, setPreparation] = useState<AnalysisPreparation | null>(
    null,
  );
  const [phase, setPhase] = useState("正在核对正文与目录…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const locked = useRef(false);
  useEffect(() => {
    let active = true;
    prepareAnalysis(book.id)
      .then((value) => {
        if (active) {
          setPreparation(value);
          setPhase("");
        }
      })
      .catch((error) => {
        if (active) {
          setError(String(error));
          setPhase("");
        }
      });
    return () => {
      active = false;
    };
  }, [book.id]);
  const run = async (download: boolean) => {
    if (!preparation || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      setPhase(
        download ? "正在下载完整正文，请保持应用开启…" : "正在准备逐段审读…",
      );
      let current = preparation.book;
      if (download) {
        const progressId = crypto.randomUUID();
        setDownloadProgress({
          progressId,
          completed: 0,
          total: 0,
          failed: 0,
          phase: "catalog",
        });
        const unlisten = await listenDownloadProgress((progress) => {
          if (progress.progressId === progressId) setDownloadProgress(progress);
        });
        try {
          current = await refreshLegadoBook(book.id, progressId);
        } finally {
          unlisten();
        }
      }
      setPreparation({ ...preparation, book: current });
      await onUpdated(current);
      await onStart(current, false);
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      locked.current = false;
      setBusy(false);
      setPhase("");
    }
  };
  const current = preparation?.book ?? book;
  const needsDownload =
    current.sourceType === "legado" && current.contentStatus !== "complete";
  const receipt = current.downloadReceipt;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked.current) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-xl"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>准备分析《{book.title}》</DialogTitle>
          <DialogDescription>
            先确认正文范围，再按顺序审读、核验原文和综合全书线索。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2 text-sm">
          <div className="rounded-lg border bg-muted/30 px-4 py-3">
            <p className="font-medium">
              {formatWordCount(current.characterCount)} ·{" "}
              {current.contentStatus === "complete"
                ? "已下载目录全部章节"
                : needsDownload
                  ? "完整性待确认"
                  : "本地已保存正文"}
            </p>
            {receipt && (
              <p className="mt-1 text-muted-foreground">
                已下载 {receipt.downloadedChapters} / {receipt.totalChapters} 章
                {receipt.failedChapters > 0
                  ? ` · ${receipt.failedChapters} 章失败`
                  : ""}
              </p>
            )}
            {preparation && (
              <p className="mt-2 leading-6 text-muted-foreground">
                {preparation.message}
              </p>
            )}
          </div>
          <p className="leading-6 text-muted-foreground">
            分析使用本地书库保存的正文，无需另行导出文件。逐段审读后生成综合报告；长篇作品耗时和模型用量会增加。
          </p>
          {needsDownload && preparation && !preparation.canDownload && (
            <p className="leading-6 text-muted-foreground">
              当前无法确认或下载全部章节，请修复书源后再分析。
            </p>
          )}
          {phase && (
            <p
              role="status"
              className="flex items-center gap-2 text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              {phase}
            </p>
          )}
          {busy && downloadProgress && (
            <div className="space-y-2" role="status">
              <p className="text-xs text-muted-foreground">
                {downloadProgress.total
                  ? `${downloadProgress.completed} / ${downloadProgress.total} 章 · ${Math.round((downloadProgress.completed / downloadProgress.total) * 100)}%${downloadProgress.failed ? ` · ${downloadProgress.failed} 章失败` : ""}`
                  : "正在读取完整目录…"}
              </p>
              <Progress
                value={
                  downloadProgress.total
                    ? (downloadProgress.completed / downloadProgress.total) *
                      100
                    : 0
                }
                aria-label="全书下载进度"
              />
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={
              busy ||
              !preparation ||
              (needsDownload && !preparation.canDownload)
            }
            onClick={() => void run(needsDownload)}
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {needsDownload ? "下载完整正文并分析" : "开始通读分析"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
