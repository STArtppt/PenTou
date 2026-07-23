import { enqueueCapture, normalizeServer, readState, writeState, SUPPORTED_PLATFORMS } from "../shared/state";
import type { BackgroundRequest, BackgroundResponse, CapturePayload, CaptureResult, ContentResponse, IngestAction, QueuedCapture } from "../shared/types";
import { postCapture, testConnection } from "./ingest";

const RETRY_ALARM = "pentou-retry-queue";
// 通知 id 携带点击后要打开的地址，service worker 被回收后点击仍可用
const NOTIFY_OPEN_PREFIX = "pentou-open:";

function setBadge(text: string, color = "#111827"): void {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function notify(title: string, message: string, openUrl?: string): void {
  chrome.notifications.create(openUrl ? `${NOTIFY_OPEN_PREFIX}${openUrl}` : `pentou-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon-128.png"),
    title,
    message,
  });
}

function hasConfig(state: Awaited<ReturnType<typeof readState>>): boolean {
  return Boolean(state.config.server && state.config.token);
}

function actionText(actions?: Partial<Record<IngestAction, number>>): string {
  if (!actions) return "OK";
  if (actions.created) return "NEW";
  if (actions.merged) return "UPD";
  if (actions.skipped) return "SKIP";
  return "OK";
}

function successMessage(actions?: Partial<Record<IngestAction, number>>): string {
  if (actions?.created) return "Saved as a new conversation. Click to open Pentou.";
  if (actions?.merged) return "Existing conversation updated. Click to open Pentou.";
  if (actions?.skipped) return "Already up to date - nothing changed.";
  return "Capture accepted.";
}

async function setAuthBlocked(blocked: boolean): Promise<void> {
  const state = await readState();
  if (state.authBlocked === blocked) return;
  state.authBlocked = blocked;
  await writeState(state);
}

async function submit(payload: CapturePayload): Promise<BackgroundResponse> {
  const state = await readState();
  const manual = payload.trigger === "manual";
  if (!hasConfig(state)) {
    if (manual) chrome.runtime.openOptionsPage();
    return { ok: false, error: "Pentou is not configured. Open options to add server and token." };
  }

  const result = await postCapture(state.config, payload);

  if (result.ok) {
    await setAuthBlocked(false);
    if (manual) notify("Saved to Pentou", successMessage(result.actions), normalizeServer(state.config.server));
    else setBadge(actionText(result.actions), "#2563eb");
    return result;
  }

  if (result.code === "network") {
    // 仅 Pentou 不可达才入离线队列（US-04.1）；解析失败等业务错误直接反馈
    const queued = await enqueueCapture(payload);
    setBadge(String(queued.size), queued.dropped ? "#dc2626" : "#f59e0b");
    const message = queued.dropped
      ? "Pentou is unreachable. Saved this capture and dropped the oldest queued item."
      : "Pentou is unreachable. Saved this capture for retry.";
    if (manual) notify("Saved for retry", message);
    return { ok: true, queued: true, error: message };
  }

  if (result.code === "unauthorized") {
    await setAuthBlocked(true);
    setBadge("AUTH", "#dc2626");
    if (manual) notify("Token rejected", "Pentou rejected the ingest token. Auto collection is paused until you update it in options.");
    return result;
  }

  // http / item-error：明确报错，提示升级 Pentou（spec US-05.3 / 异常 1）
  const detail = result.code === "item-error"
    ? `${result.error} The platform API may have changed - try updating Pentou.`
    : result.error ?? "Capture failed.";
  setBadge("ERR", "#dc2626");
  if (manual) notify("Capture failed", detail);
  return { ...result, error: detail };
}

async function flushQueue(): Promise<void> {
  const state = await readState();
  if (!hasConfig(state) || state.queue.length === 0) {
    setBadge(state.queue.length ? String(state.queue.length) : "");
    return;
  }

  const remaining: QueuedCapture[] = [];
  const dropped: string[] = [];
  for (let i = 0; i < state.queue.length; i++) {
    const result = await postCapture(state.config, state.queue[i]);
    if (result.ok) {
      state.authBlocked = false;
      continue;
    }
    if (result.code === "network" || result.code === "unauthorized") {
      // Pentou 掉线或 token 失效：保留余下队列，等下个 alarm / 重新配置
      if (result.code === "unauthorized") state.authBlocked = true;
      remaining.push(...state.queue.slice(i));
      break;
    }
    // 永久性失败（解析错误等）：丢弃并提示，避免毒消息无限重试
    dropped.push(result.error ?? "unknown error");
  }

  state.queue = remaining;
  await writeState(state);

  if (dropped.length > 0) {
    notify(
      "Some queued captures failed",
      `${dropped.length} queued capture(s) could not be imported and were dropped. First error: ${dropped[0]} The platform API may have changed - try updating Pentou.`,
    );
  }
  if (state.authBlocked) setBadge("AUTH", "#dc2626");
  else setBadge(remaining.length ? String(remaining.length) : "");
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 5 });
  flushQueue();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) flushQueue();
});

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith(NOTIFY_OPEN_PREFIX)) return;
  chrome.tabs.create({ url: id.slice(NOTIFY_OPEN_PREFIX.length) });
  chrome.notifications.clear(id);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  let response: ContentResponse | undefined;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: "PENTOU_CAPTURE", trigger: "manual" });
  } catch {
    // 页面没有注入 content script（非受支持平台域名），走统一的"不支持"提示
  }

  if (!response) {
    setBadge("N/A", "#6b7280");
    notify("Page not supported", `Pentou can collect from: ${SUPPORTED_PLATFORMS.join(", ")}.`);
    return;
  }
  if (response.ok && response.supported && response.payload) {
    await submit(response.payload);
    return;
  }
  if (response.ok && !response.supported) {
    setBadge("N/A", "#6b7280");
    notify("Page not supported", `Open a conversation page on: ${response.platforms.join(", ")}.`);
    return;
  }
  // capture 失败：error 文案已区分未登录 / 接口异常（US-01.3）
  setBadge("ERR", "#dc2626");
  notify("Capture failed", (!response.ok && response.error) || "Unknown error.");
});

chrome.runtime.onMessage.addListener((request: BackgroundRequest, _sender, sendResponse) => {
  (async () => {
    if (request.type === "PENTOU_SUBMIT") return await submit(request.payload);
    if (request.type === "PENTOU_GET_STATE") return { ok: true, state: await readState() };
    if (request.type === "PENTOU_SAVE_STATE") {
      // 重新保存配置视为用户已处理 token 问题，解除 401 暂停
      await writeState({ ...request.state, authBlocked: false });
      await flushQueue();
      return { ok: true, state: await readState() };
    }
    if (request.type === "PENTOU_TEST_CONNECTION") {
      const status = await testConnection(request.server, request.token);
      return status === "connected"
        ? { ok: true, status }
        : { ok: false, status, error: status === "unauthorized" ? "Token rejected" : "Pentou is unreachable" };
    }
    return { ok: false, error: "Unknown request" };
  })().then((response) => sendResponse(response)).catch((error) => {
    sendResponse({ ok: false, error: String(error?.message ?? error) });
  });
  return true;
});
