import type { CreationSeed } from "../CreationView";
import type { Idea } from "../types";

const section = (label: string, value?: string) => value?.trim() ? `## ${label}\n${value.trim()}` : "";
const join = (parts: string[]) => parts.filter(Boolean).join("\n\n");

export function ideaToCreationSeed(idea: Idea): CreationSeed {
  const opening = (Array.isArray(idea.opening) ? idea.opening : []).map(item =>
    join([`### ${item.chapter}`, section("事件与主动选择", item.event), section("进展、所得与代价", item.reward), section("章尾追问", item.hook)]));
  const escalation = (Array.isArray(idea.escalation) ? idea.escalation : []).map(item =>
    join([`### ${item.stage}`, section("升级冲突", item.conflict), section("兑现与下一目标", item.payoff)]));
  const differences = (Array.isArray(idea.differences) ? idea.differences : []).map(item =>
    `### ${item.axis}\n原作（仅供对照）：${item.original}\n新作：${item.proposal}\n剧情后果：${item.consequence}`);
  const brief = join([
    section("主投平台", idea.platform), section("题材", idea.genre), section("目标读者", idea.audience),
    section("一句话卖点", idea.sellingPoint), section("故事构思", idea.premise),
    section("打破的惯例", idea.convention), section("新规则与冲突", idea.ruleBreak),
    section("原创差异", idea.difference), section("首次爽点兑现", idea.firstPayoff),
    section("持续连载机制", idea.storyEngine), section("主投平台适配", idea.platformFit),
    section("另一平台改写方向", idea.alternatePlatform), section("试写风险与修正", idea.risk),
    section("试读验证", idea.validation),
  ]);
  const outline = join([
    section("首次兑现", idea.firstPayoff), section("前三章规划", opening.join("\n\n")),
    section("前30章阶段推进", escalation.join("\n\n")), section("长篇持续推进", idea.storyEngine),
  ]);
  return {
    title: idea.title, genre: idea.genre || "", audience: idea.audience || "", seed: brief,
    starter: {
      rules: join([section("新作规则与冲突", idea.ruleBreak), section("需要改变的惯例", idea.convention), section("机制如何持续运转", idea.storyEngine)]),
      outline,
      chapters: (Array.isArray(idea.opening) ? idea.opening : []).map(item => ({
        title: item.chapter,
        goal: join([section("事件与主动选择", item.event), section("章尾追问", item.hook)]),
        outcome: item.reward,
      })),
      reference: join([`# 原创灵感原始方案：${idea.title}`, brief, outline,
        "以下原作依据仅用于比较与避免重复，不属于新作已确认设定或正文事实。",
        section("原作启发", idea.sourceAnchor), section("与原作的逐项差异", differences.join("\n\n"))]),
    },
  };
}
