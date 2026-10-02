import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchSpeechAudio } from "@/lib/tauri";
import { readerParagraphs } from "@/lib/reader";
import {
  defaultSpeechEngineId,
  speechTemplateForVoice,
} from "@/lib/speech-engines";
import type { ChapterDetail, ChapterSummary } from "@/types";

type Engine = "system" | "online";
const storageKey = "inkscope-speech-v1";
type SpeechPrefs = {
  engine: Engine;
  template: string;
  presetId: string;
  rate: number;
  voice: string;
  autoNext: boolean;
};
const defaults: SpeechPrefs = {
  engine: "system",
  template: "",
  presetId: defaultSpeechEngineId,
  rate: 1,
  voice: "",
  autoNext: true,
};
function readPrefs(): SpeechPrefs {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return {
      engine: value.engine === "online" ? "online" : "system",
      template: typeof value.template === "string" ? value.template : "",
      presetId:
        value.presetId === "custom" || speechTemplateForVoice(value.presetId)
          ? value.presetId
          : value.template
            ? "custom"
            : defaultSpeechEngineId,
      rate:
        typeof value.rate === "number"
          ? Math.max(0.6, Math.min(1.8, value.rate))
          : 1,
      voice: typeof value.voice === "string" ? value.voice : "",
      autoNext: value.autoNext !== false,
    };
  } catch {
    return defaults;
  }
}

function currentTemplate(prefs: SpeechPrefs): string {
  return prefs.presetId === "custom"
    ? prefs.template.trim()
    : speechTemplateForVoice(prefs.presetId) || "";
}

export function useReaderSpeech(
  chapter: ChapterDetail | null,
  chapters: ChapterSummary[],
  openChapter: (position: number) => Promise<void>,
) {
  const [prefs, setPrefs] = useState<SpeechPrefs>(readPrefs);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [paragraph, setParagraph] = useState<number | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const tokenRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobRef = useRef<string | null>(null);
  const nextChapterRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const resumeRef = useRef<(() => void) | null>(null);
  const lastChapterRef = useRef<number | null>(null);
  const latestRef = useRef({ chapter, chapters, prefs, openChapter });
  latestRef.current = { chapter, chapters, prefs, openChapter };

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(prefs));
    } catch {
      /* storage unavailable */
    }
  }, [prefs]);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, []);

  const disposeAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = null;
  }, []);
  const stop = useCallback(() => {
    tokenRef.current++;
    nextChapterRef.current = null;
    pausedRef.current = false;
    resumeRef.current?.();
    resumeRef.current = null;
    window.speechSynthesis?.cancel();
    disposeAudio();
    setPlaying(false);
    setPaused(false);
    setParagraph(null);
  }, [disposeAudio]);

  const speak = useCallback(
    async (index: number, token: number) => {
      if (token !== tokenRef.current) return;
      const {
        chapter: current,
        chapters: all,
        prefs: config,
        openChapter: open,
      } = latestRef.current;
      if (!current) return;
      const lines = readerParagraphs(current.content);
      if (index >= lines.length) {
        const position = all.findIndex(
          (item) => item.position === current.position,
        );
        const next = config.autoNext ? all[position + 1] : undefined;
        if (!next) {
          stop();
          return;
        }
        nextChapterRef.current = next.position;
        setParagraph(null);
        try {
          await open(next.position);
        } catch (error) {
          stop();
          toast.error(`切换章节失败：${String(error)}`);
        }
        return;
      }
      setParagraph(index);
      const line = lines[index];
      const advance = () => {
        if (token === tokenRef.current) void speak(index + 1, token);
      };
      if (config.engine === "system") {
        if (!window.speechSynthesis) {
          stop();
          toast.error("当前系统不支持语音朗读");
          return;
        }
        const utterance = new SpeechSynthesisUtterance(line);
        utterance.lang = "zh-CN";
        utterance.rate = config.rate;
        utterance.voice =
          window.speechSynthesis
            .getVoices()
            .find((voice) => voice.voiceURI === config.voice) || null;
        utterance.onend = advance;
        utterance.onerror = (event) => {
          if (
            token !== tokenRef.current ||
            event.error === "canceled" ||
            event.error === "interrupted"
          )
            return;
          stop();
          toast.error(`系统朗读失败：${event.error}`);
        };
        window.speechSynthesis.speak(utterance);
        return;
      }
      try {
        // Send short pieces only; Legado engines often limit request length.
        const chunks = line.match(/[\s\S]{1,180}/gu) || [];
        for (let part = 0; part < chunks.length; part++) {
          if (token !== tokenRef.current) return;
          if (pausedRef.current)
            await new Promise<void>((resolve) => {
              resumeRef.current = resolve;
            });
          if (token !== tokenRef.current) return;
          const result = await fetchSpeechAudio(
            currentTemplate(config),
            chunks[part],
          );
          if (token !== tokenRef.current) return;
          if (pausedRef.current)
            await new Promise<void>((resolve) => {
              resumeRef.current = resolve;
            });
          if (token !== tokenRef.current) return;
          const url = URL.createObjectURL(
            new Blob([new Uint8Array(result.bytes)], { type: result.mime }),
          );
          blobRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.playbackRate = config.rate;
          await new Promise<void>((resolve, reject) => {
            audio.onended = () => resolve();
            audio.onerror = () => reject(new Error("音频无法播放"));
            void audio.play().catch(reject);
          });
          disposeAudio();
        }
        advance();
      } catch (error) {
        if (token !== tokenRef.current) return;
        stop();
        toast.error(`在线朗读失败：${String(error)}`);
      }
    },
    [disposeAudio, stop],
  );

  const start = useCallback(
    (index = 0) => {
      if (!latestRef.current.chapter) return;
      if (
        latestRef.current.prefs.engine === "online" &&
        !currentTemplate(latestRef.current.prefs)
      ) {
        toast.error("请先填写在线朗读引擎地址");
        return;
      }
      stop();
      const token = tokenRef.current;
      setPlaying(true);
      void speak(index, token);
    },
    [speak, stop],
  );
  const pauseOrResume = useCallback(() => {
    if (!playing) {
      start(paragraph ?? 0);
      return;
    }
    if (paused) {
      pausedRef.current = false;
      resumeRef.current?.();
      resumeRef.current = null;
      if (prefs.engine === "system") window.speechSynthesis?.resume();
      else if (audioRef.current)
        void audioRef.current.play().catch((error) => {
          stop();
          toast.error(`音频无法继续播放：${String(error)}`);
        });
      setPaused(false);
    } else {
      pausedRef.current = true;
      if (prefs.engine === "system") window.speechSynthesis?.pause();
      else audioRef.current?.pause();
      setPaused(true);
    }
  }, [playing, paused, prefs.engine, paragraph, start, stop]);

  useEffect(() => {
    const position = chapter?.position ?? null;
    if (lastChapterRef.current === position) return;
    lastChapterRef.current = position;
    if (nextChapterRef.current === position && position !== null) {
      nextChapterRef.current = null;
      const token = tokenRef.current;
      void speak(0, token);
    } else if (playing) stop();
  }, [chapter?.position, playing, speak, stop]);
  useEffect(
    () => () => {
      tokenRef.current++;
      window.speechSynthesis?.cancel();
      disposeAudio();
    },
    [disposeAudio],
  );

  return {
    prefs,
    setPrefs,
    voices,
    playing,
    paused,
    paragraph,
    start,
    stop,
    pauseOrResume,
  };
}
