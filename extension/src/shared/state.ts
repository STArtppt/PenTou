import type { ExtensionState, PlatformSlug, QueuedCapture } from "./types";

export const SUPPORTED_PLATFORMS: PlatformSlug[] = ["chatgpt", "deepseek"];
export const DEFAULT_SERVER = "http://localhost:5173";
export const QUEUE_LIMIT = 200;

const DEFAULT_STATE: ExtensionState = {
  config: { server: DEFAULT_SERVER, token: "" },
  platforms: {
    chatgpt: { enabled: true, auto: false },
    deepseek: { enabled: true, auto: false },
  },
  queue: [],
  authBlocked: false,
};

export function normalizeServer(value: string): string {
  return (value || DEFAULT_SERVER).trim().replace(/\/+$/, "");
}

export function mergeState(raw?: Partial<ExtensionState>): ExtensionState {
  return {
    config: {
      server: normalizeServer(raw?.config?.server ?? DEFAULT_STATE.config.server),
      token: String(raw?.config?.token ?? ""),
    },
    platforms: {
      chatgpt: { ...DEFAULT_STATE.platforms.chatgpt, ...(raw?.platforms?.chatgpt ?? {}) },
      deepseek: { ...DEFAULT_STATE.platforms.deepseek, ...(raw?.platforms?.deepseek ?? {}) },
    },
    queue: Array.isArray(raw?.queue) ? raw.queue.slice(-QUEUE_LIMIT) : [],
    authBlocked: Boolean(raw?.authBlocked),
  };
}

/** 自动采集准入：平台开关 + auto 开关 + 未处于 401 暂停（spec US-02.3 / 边界 4）。 */
export function autoCaptureAllowed(state: ExtensionState, platform: PlatformSlug): boolean {
  if (state.authBlocked) return false;
  const config = state.platforms[platform];
  return Boolean(config?.enabled && config?.auto);
}

export async function readState(): Promise<ExtensionState> {
  const stored = await chrome.storage.local.get(["pentouState"]);
  return mergeState(stored.pentouState);
}

export async function writeState(state: ExtensionState): Promise<void> {
  await chrome.storage.local.set({ pentouState: mergeState(state) });
}

export async function enqueueCapture(item: QueuedCapture): Promise<{ dropped: boolean; size: number }> {
  const state = await readState();
  const nextQueue = [...state.queue, item];
  const dropped = nextQueue.length > QUEUE_LIMIT;
  state.queue = dropped ? nextQueue.slice(nextQueue.length - QUEUE_LIMIT) : nextQueue;
  await writeState(state);
  return { dropped, size: state.queue.length };
}
