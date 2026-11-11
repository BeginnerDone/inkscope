import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Plus, Pause, Play, X, NotebookPen, CircleAlert, CheckCircle2, RotateCcw } from "lucide-react";
import { ideaToCreationSeed } from "./lib/idea-creation";
import { Progress } from "@/components/ui/progress";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@/components/ui/select";
import type { IdeaJob } from "./lib/tauri";
import { Button } from "@/components/ui/button";
import type { CreationSeed } from "./CreationView";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEffect, useRef, useState } from "react";
import type { AnalysisReport, Idea } from "./types";

export function IdeasView({
  report,
  onCreation,
  onAppend,
  appending,
  job,
  onControl,
}: {
  report: AnalysisReport;
  onCreation: (seed: CreationSeed) => void;
  onAppend: (platform: "起点" | "番茄") => Promise<void>;
  appending: boolean;
  job: IdeaJob | null;
  onControl: (action: "pause" | "resume" | "cancel") => Promise<void>;
}) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (job?.status !== "running") return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);
  const [appendError, setAppendError] = useState("");
  const appendLock = useRef(false);
  const [mode, setMode] = useState<"起点" | "番茄">("起点");
  const [controlling, setControlling] = useState(false);
  const [platform, setPlatform] = useState("全部");
  const ideas = report.ideas || [];
  const current = report.ideasVersion === 2;
  const visible =
    platform === "全部"
      ? ideas
      : ideas.filter((idea) => idea.platform === platform);
  const append = async () => {
    if (appending || appendLock.current) return;
    appendLock.current = true;
    setAppendError("");
    try { await onAppend(mode); }
    catch (error) { setAppendError(error instanceof Error ? error.message : String(error)); }
    finally { appendLock.current = false; }
  };
  const control = async (action: "pause" | "resume" | "cancel") => {
    setControlling(true); setAppendError("");
    try { await onControl(action); } catch (e) { setAppendError(e instanceof Error ? e.message : String(e)); }
    finally { setControlling(false); }
  };
  return (
    <div className="teaching-stack ideas-view">
      <section className="architecture-summary">
        <h2>原创灵感与平台选题</h2>
        <p>
          从原作的情绪价值出发，用新的目标、规则与对抗，做出能开篇、能兑现、能持续写下去的故事。
        </p>
        <p className="ideas-note">
          {current
            ? "平台定位是选题假设。先比较卖点，再用前三章试读验证追读意愿。"
            : "这是旧版灵感。可直接追加新版方案，保留已有内容；也可重新分析整本书。"}
        </p>
      </section>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3" data-testid="ideas-toolbar">
        <ToggleGroup type="single" variant="outline" size="sm" value={platform}
          onValueChange={value => { if (value) setPlatform(value); }} aria-label="灵感平台筛选">
          {["全部", "起点", "番茄"].map(label => <ToggleGroupItem key={label} value={label}>{label} · {label === "全部" ? ideas.length : ideas.filter(idea => idea.platform === label).length}</ToggleGroupItem>)}
        </ToggleGroup>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={mode} disabled={appending} onValueChange={v => setMode(v as "起点" | "番茄")}>
            <SelectTrigger size="sm" aria-label="灵感生成平台" className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="起点">起点模式</SelectItem><SelectItem value="番茄">番茄模式</SelectItem></SelectGroup></SelectContent>
          </Select>
          <Button size="sm" disabled={appending} onClick={() => void append()}><Plus data-icon="inline-start" />添加 1 个灵感</Button>
        </div>
      </div>
      {job?.status === "failed" ? <Alert variant="destructive" data-testid="idea-job-failed">
        <CircleAlert />
        <AlertTitle>这次灵感未能保存 · {job.platform}模式</AlertTitle>
        <AlertDescription>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p>{job.completed >= 1 ? "构思已完成，审稿或保存未通过检查。原有灵感保留。" : "生成未完成，原有灵感保留。"}</p>
              <details><summary className="cursor-pointer">查看失败原因</summary><p className="mt-2 break-words whitespace-pre-wrap">{job.message}{job.message.startsWith("审稿连续未通过") ? "。这条旧任务未记录具体失败项，重试后会显示缺少的字段或重复项。" : ""}</p></details>
            </div>
            <Button variant="outline" size="sm" disabled={controlling || appending} onClick={() => void control("resume")}><RotateCcw data-icon="inline-start" />{job.completed >= 1 ? "重试审稿" : "重试生成"}</Button>
          </div>
        </AlertDescription>
      </Alert> : job && ["running", "paused"].includes(job.status) ? <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 px-4 py-3" role="status">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm font-medium">{job.platform}模式 · {job.status === "paused" ? "已暂停" : job.completed === 0 ? "正在构思" : job.completed === 1 ? "正在审稿" : "正在保存"}<span className="ml-2 font-normal text-muted-foreground">{job.completed}/3 阶段完成</span></p>
            <p className="text-xs text-muted-foreground">{job.status === "running" ? `${job.message} · 此阶段已等待 ${Math.max(0, Math.floor((clock - Date.parse(job.updatedAt)) / 1000))} 秒` : "已完成的阶段已保存，继续时从未完成阶段重试。"}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={controlling || (job.status === "running" && job.completed >= 2)} onClick={() => void control(job.status === "paused" ? "resume" : "pause")}>
              {job.status === "paused" ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}{job.status === "paused" ? "继续生成" : "暂停"}
            </Button>
            <Button variant="ghost" size="sm" disabled={controlling || (job.status === "running" && job.completed >= 2)} onClick={() => void control("cancel")}><X data-icon="inline-start" />取消生成</Button>
          </div>
        </div>
        <Progress value={job.completed / 3 * 100} aria-label="灵感生成阶段进度" />
      </div> : job && <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">{job.status === "completed" ? <CheckCircle2 className="size-4" /> : <X className="size-4" />}{job.message}</p>}
      {appendError && <Alert variant="destructive"><AlertDescription>{appendError}</AlertDescription></Alert>}
      {!visible.length && (
        <Empty>
          <EmptyHeader>
            <EmptyDescription>
              {ideas.length
                ? "当前平台暂无方案。"
                : "当前报告还没有原创灵感，可以点击上方按钮生成。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {visible.map((idea, index) => (
        <IdeaCard
          key={`${idea.platform}-${idea.title}-${index}`}
          idea={idea}
          onCreation={onCreation}
          index={index}
        />
      ))}
    </div>
  );
}

function IdeaCard({
  idea,
  index,
  onCreation,
}: {
  idea: Idea;
  index: number;
  onCreation: (seed: CreationSeed) => void;
}) {
  return (
    <article className="idea-proposal">
      <header>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3" data-testid="idea-card-heading">
          <div className="min-w-0 flex-1">
            <span className="eyebrow">方案 {String(index + 1).padStart(2, "0")} {idea.platform && `· ${idea.platform}`} {idea.genre && `· ${idea.genre}`}</span>
            <h3>{idea.title}</h3>
          </div>
          <Button variant="outline" size="sm" onClick={() => onCreation(ideaToCreationSeed(idea))}><NotebookPen data-icon="inline-start" />以此创建作品</Button>
        </div>
        {idea.sellingPoint && (
          <p className="idea-selling-point">{idea.sellingPoint}</p>
        )}
      </header>
      <p className="idea-premise">{idea.premise}</p>
      <div className="idea-facts">
        <Fact label="写给谁看" value={idea.audience} />
        <Fact label="从原作借到什么" value={idea.sourceAnchor} />
        <Fact label="打破哪条惯例" value={idea.convention} />
        <Fact label="新规则怎样改变剧情" value={idea.ruleBreak} />
      </div>
      <section>
        <h4>与原作的实质差异</h4>
        <p>{idea.difference}</p>
        {Array.isArray(idea.differences) &&
          idea.differences.map((item, i) => (
            <div className="idea-comparison" key={i}>
              <b>{item.axis}</b>
              <p>
                <span>原作</span>
                {item.original}
              </p>
              <p>
                <span>新作</span>
                {item.proposal}
              </p>
              <p>
                <span>剧情后果</span>
                {item.consequence}
              </p>
            </div>
          ))}
      </section>
      {Array.isArray(idea.opening) && (
        <section>
          <h4>前三章，把卖点写成事件</h4>
          <div className="idea-beats">
            {idea.opening.map((item, i) => (
              <div key={i}>
                <b>{item.chapter}</b>
                <p>{item.event}</p>
                <p>
                  <strong>进展与代价</strong>
                  {item.reward}
                </p>
                <p>
                  <strong>章尾追问</strong>
                  {item.hook}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
      <Fact label="第一次让读者爽在哪里" value={idea.firstPayoff} />
      {idea.storyEngine ||
      idea.platformFit ||
      idea.alternatePlatform ||
      idea.validation ||
      idea.escalation?.length ? (
        <details>
          <summary>长篇展开与平台适配</summary>
          <Fact label="新鲜感之后，靠什么持续推进" value={idea.storyEngine} />
          {Array.isArray(idea.escalation) && (
            <div className="idea-beats">
              {idea.escalation.map((item, i) => (
                <div key={i}>
                  <b>{item.stage}</b>
                  <p>{item.conflict}</p>
                  <p>
                    <strong>兑现与下一目标</strong>
                    {item.payoff}
                  </p>
                </div>
              ))}
            </div>
          )}
          <Fact label="主投平台的适配理由" value={idea.platformFit} />
          <Fact
            label="换到另一平台，要实改什么"
            value={idea.alternatePlatform}
          />
          <Fact label="怎样验证读者愿不愿追" value={idea.validation} />
        </details>
      ) : null}
      <p className="idea-risk">
        <strong>试写时重点检查</strong>
        {idea.risk}
      </p>
    </article>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  return value ? (
    <div className="idea-fact">
      <h4>{label}</h4>
      <p>{value}</p>
    </div>
  ) : null;
}
