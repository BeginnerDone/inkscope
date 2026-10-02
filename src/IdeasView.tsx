import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useState } from "react";
import type { AnalysisReport, Idea } from "./types";

export function IdeasView({ report }: { report: AnalysisReport }) {
  const [platform, setPlatform] = useState("全部");
  const ideas = report.ideas || [];
  const current = report.ideasVersion === 2;
  const visible =
    platform === "全部"
      ? ideas
      : ideas.filter((idea) => idea.platform === platform);
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
            : "这是旧版灵感。点击上方“重新分析”，可复用已有原文片段分析，生成包含平台定位、实质差异和开篇兑现的新版方案。"}
        </p>
      </section>
      {current && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={platform}
          onValueChange={(value) => {
            if (value) setPlatform(value);
          }}
          aria-label="灵感平台筛选"
        >
          {["全部", "起点", "番茄"].map((label) => (
            <ToggleGroupItem key={label} value={label}>
              {label} ·{" "}
              {label === "全部"
                ? ideas.length
                : ideas.filter((idea) => idea.platform === label).length}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      {!visible.length && (
        <Empty>
          <EmptyHeader>
            <EmptyDescription>
              {ideas.length
                ? "当前平台暂无方案。"
                : "当前报告还没有原创灵感，重新分析后生成。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {visible.map((idea, index) => (
        <IdeaCard
          key={`${idea.platform}-${idea.title}-${index}`}
          idea={idea}
          index={index}
        />
      ))}
    </div>
  );
}

function IdeaCard({ idea, index }: { idea: Idea; index: number }) {
  return (
    <article className="idea-proposal">
      <header>
        <span className="eyebrow">
          方案 {String(index + 1).padStart(2, "0")}{" "}
          {idea.platform && `· ${idea.platform}`}{" "}
          {idea.genre && `· ${idea.genre}`}
        </span>
        <h3>{idea.title}</h3>
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
