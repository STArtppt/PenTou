import type { ExtensionState, PlatformSlug, QueuedCapture } from "./types";

export const SUPPORTED_PLATFORMS: PlatformSlug[] = [
  "chatgpt",
  "deepseek",
  "doubao",
  "qwen",
  "qwen-intl",
  "gemini",
];
export const DEFAULT_SERVER = "http://localhost:5173";
export const QUEUE_LIMIT = 200;

const DEFAULT_PLATFORM_CONFIG = { enabled: true, auto: false };

function defaultPlatforms(): Record<PlatformSlug, { enabled: boolean; auto: boolean }> {
  return Object.fromEntries(
    SUPPORTED_PLATFORMS.map((slug) => [slug, { ...DEFAULT_PLATFORM_CONFIG }]),
  ) as Record<PlatformSlug, { enabled: boolean; auto: boolean }>;
}

const DEFAULT_STATE: ExtensionState = {
  config: { server: DEFAULT_SERVER, token: "" },
  platforms: defaultPlatforms(),
  queue: [],
  authBlocked: false,
};

export function normalizeServer(value: string): string {
  return (value || DEFAULT_SERVER).trim().replace(/\/+$/, "");
}

export function mergeState(raw?: Partial<ExtensionState>): ExtensionState {
  const platforms = defaultPlatforms();
  for (const slug of SUPPORTED_PLATFORMS) {
    platforms[slug] = {
      ...platforms[slug],
      ...(raw?.platforms?.[slug] ?? {}),
    };
  }
  return {
    config: {
      server: normalizeServer(raw?.config?.server ?? DEFAULT_STATE.config.server),
      token: String(raw?.config?.token ?? ""),
    },
    platforms,
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
