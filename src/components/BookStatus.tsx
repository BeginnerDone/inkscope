import { Badge } from "@/components/ui/badge";
import type { BookSummary } from "@/types";
import { LoaderCircle } from "lucide-react";

export function BookStatus({ status }: { status: BookSummary["status"] }) {
  const labels = {
    ready: "待分析",
    analyzing: "分析中",
    completed: "已完成",
    failed: "已中断",
  };
  return (
    <Badge variant={status === "failed" ? "destructive" : "secondary"}>
      {status === "analyzing" && (
        <LoaderCircle data-icon="inline-start" className="animate-spin" />
      )}
      {labels[status]}
    </Badge>
  );
}
