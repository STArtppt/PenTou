import { findAdapter, adapters } from "./adapters";
import { PlatformFetchError } from "./adapters/types";
import type { BackgroundRequest, CapturePayload, ContentRequest, ContentResponse, PlatformSlug } from "../shared/types";
import { autoCaptureAllowed, readState } from "../shared/state";

const AUTO_DEBOUNCE_MS = 60_000;
let autoTimer: number | undefined;
let lastAutoKey = "";

async function capture(trigger: "manual" | "auto"): Promise<ContentResponse> {
  const adapter = findAdapter();
  if (!adapter) {
    return { ok: true, supported: false, platforms: adapters.map((a) => a.platform) };
  }

  const id = adapter.conversationId(new URL(location.href));
  if (!id) {
    return { ok: false, error: "This page looks supported, but no conversation id was found.", reason: "platform-api-changed" };
  }

  try {
    const raw = await adapter.fetchRaw(id);
    const payload: CapturePayload = {
      platform: adapter.platform,
      externalId: id,
      raw,
      trigger,
      capturedAt: new Date().toISOString(),
    };
    return { ok: true, supported: true, platform: adapter.platform, externalId: id, payload };
  } catch (error) {
    if (error instanceof PlatformFetchError) {
      return { ok: false, error: error.message, reason: error.reason };
    }
    return { ok: false, error: String((error as Error)?.message ?? error), reason: "platform-api-changed" };
  }
}

/**
 * 扩展重载 / 更新 / 卸载后，已注入页面的 content script 会变成孤儿：DOM 事件照常触发，
 * 但任何 chrome.* 调用都抛 "Extension context invalidated"。对话页流式输出时 DOM 变动极
 * 频繁，不拦住会持续刷错误。`chrome.runtime.id` 在上下文失效后变为 undefined。
 */
function extensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

/** 上下文已失效：停掉观察器与定时器，让孤儿脚本彻底安静下来（页面刷新后会重新注入）。 */
function standDown(): void {
  observer.disconnect();
  if (autoTimer !== undefined) {
    window.clearTimeout(autoTimer);
    autoTimer = undefined;
  }
}

/** 自动采集准入：所有自动路径（防抖 / 切走 / 关页）必须先过此闸（US-02.3 / 边界 4）。 */
async function autoAllowed(): Promise<boolean> {
  if (!extensionAlive()) {
    standDown();
    return false;
  }
  const adapter = findAdapter();
  if (!adapter) return false;
  try {
    const state = await readState();
    return autoCaptureAllowed(state, adapter.platform as PlatformSlug);
  } catch {
    // 读取过程中扩展被重载
    standDown();
    return false;
  }
}

async function submitAuto(): Promise<void> {
  if (!(await autoAllowed())) return;
  const response = await capture("auto");
  if (!response.ok || !response.supported || !response.payload) return;
  const key = `${response.payload.platform}:${response.payload.externalId}:${response.payload.raw.length}`;
  if (key === lastAutoKey) return;
  lastAutoKey = key;
  try {
    await chrome.runtime.sendMessage({ type: "PENTOU_SUBMIT", payload: response.payload } satisfies BackgroundRequest);
  } catch {
    // 上报期间扩展被重载：回退 lastAutoKey，页面刷新后重新注入的脚本可以重试这一轮
    lastAutoKey = "";
    standDown();
  }
}

async function scheduleAuto(): Promise<void> {
  if (!(await autoAllowed())) return;

  if (autoTimer !== undefined) window.clearTimeout(autoTimer);
  autoTimer = window.setTimeout(() => {
    submitAuto();
  }, AUTO_DEBOUNCE_MS);
}

const observer = new MutationObserver(() => {
  scheduleAuto();
});
observer.observe(document.body, { subtree: true, childList: true, characterData: true });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") submitAuto();
});
window.addEventListener("pagehide", () => {
  submitAuto();
});

chrome.runtime.onMessage.addListener((request: ContentRequest, _sender, sendResponse) => {
  (async () => {
    if (request.type === "PENTOU_STATUS") {
      const adapter = findAdapter();
      if (!adapter) return { ok: true, supported: false, platforms: adapters.map((a) => a.platform) };
      const id = adapter.conversationId(new URL(location.href));
      return { ok: true, supported: true, platform: adapter.platform, externalId: id ?? "" };
    }
    if (request.type === "PENTOU_CAPTURE") return await capture(request.trigger);
    return { ok: false, error: "Unknown request" };
  })().then((response) => sendResponse(response)).catch((error) => {
    sendResponse({ ok: false, error: String(error?.message ?? error) });
  });
  return true;
});

scheduleAuto();
