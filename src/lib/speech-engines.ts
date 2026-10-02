// Curated from AOAOSTAR's Legado TTS collection. Each voice was checked against
// the provider with a short sample on 2026-10-02. The provider may change later.
export const builtInSpeechEngines = [
  { id: "yukaimp", name: "俞师 · 沉稳男声" },
  { id: "jlshimp", name: "季师 · 清晰男声" },
  { id: "xijunma", name: "小军 · 温和男声" },
  { id: "wjianm_xsheng", name: "小江 · 青年男声" },
  { id: "qiumum_0gushi", name: "秋木 · 故事男声" },
  { id: "kaolam_diantai", name: "考拉 · 电台男声" },
  { id: "aningfp", name: "安宁 · 柔和女声" },
  { id: "xmguof", name: "婷婷 · 甜美女声" },
  { id: "gdfanf_natong", name: "方方 · 活泼女声" },
  { id: "zhilingfp", name: "知龄 · 优雅女声" },
  { id: "madoufp_wenrou", name: "温柔 · 轻柔女声" },
  { id: "tzruimp", name: "小睿 · 清亮男声" },
] as const;

export const defaultSpeechEngineId = "yukaimp";
export type BuiltInSpeechEngineId = (typeof builtInSpeechEngines)[number]["id"];

export function speechTemplateForVoice(id: string): string | null {
  if (!builtInSpeechEngines.some((engine) => engine.id === id)) return null;
  return `https://dds.dui.ai/runtime/v1/synthesize?voiceId=${id}&text={{java.encodeURI(java.encodeURI(speakText))}}&speed=1&volume=100&audioType=wav`;
}
