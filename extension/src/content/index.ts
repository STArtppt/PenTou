import { findAdapter, adapters } from "./adapters";
import { PlatformFetchError } from "./adapters/types";
import type { BackgroundRequest, CapturePayload, ContentRequest, ContentResponse, PlatformSlug } from "../shared/types";
import { readState } from "../shared/state";

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

async function submitAuto(): Promise<void> {
  const response = await capture("auto");
  if (!response.ok || !response.supported || !response.payload) return;
  const key = `${response.payload.platform}:${response.payload.externalId}:${response.payload.raw.length}`;
  if (key === lastAutoKey) return;
  lastAutoKey = key;
  await chrome.runtime.sendMessage({ type: "PENTOU_SUBMIT", payload: response.payload } satisfies BackgroundRequest);
}

async function scheduleAuto(): Promise<void> {
  const adapter = findAdapter();
  if (!adapter) return;
  const state = await readState();
  const platform = adapter.platform as PlatformSlug;
  if (!state.platforms[platform]?.enabled || !state.platforms[platform]?.auto) return;

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
