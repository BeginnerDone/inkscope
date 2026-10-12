import { invoke } from "./tauri";
// Synchronous reads use a session cache hydrated from SQLite before React mounts.
// All persistent writes go through the Rust backend, in invocation order.
let cache: Record<string, string> = {};
let queue: Promise<void> = Promise.resolve();
const supported = (key: string) => ["inkscope-model", "inkscope-reader-v1", "inkscope-speech-v1", "inkscope-writer-v1"].includes(key) || /^inkscope-creation-(draft|conflict)-/.test(key);
export async function initializeStorage() {
  const legacy: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && supported(key)) legacy[key] = localStorage.getItem(key)!;
    }
  } catch { /* SQLite remains usable when legacy WebView storage is unavailable. */ }
  cache = await invoke<Record<string, string>>("initialize_storage", { legacy });
  if (!cache || typeof cache !== "object") throw new Error("SQLite 存储初始化失败");
  // A committed SQLite value must exist before deleting each legacy key.
  for (const key of Object.keys(legacy)) {
    if (typeof cache[key] === "string") {
      try { localStorage.removeItem(key); } catch { /* Retry cleanup on next startup. */ }
    }
  }
}
export const readStorage = (key: string) => cache[key] ?? null;
export function writeStorage(key: string, value: string | null): Promise<void> {
  const request = queue.catch(() => {}).then(async () => {
    await invoke<void>("write_storage", { key, value });
    if (value === null) delete cache[key]; else cache[key] = value;
  });
  queue = request;
  return request;
}
