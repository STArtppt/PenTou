import { enqueueCapture, readState, writeState } from "../shared/state";
import type { BackgroundRequest, BackgroundResponse, CapturePayload, IngestAction, QueuedCapture } from "../shared/types";
import { postCapture, testConnection } from "./ingest";

const RETRY_ALARM = "pentou-retry-queue";

function setBadge(text: string, color = "#111827"): void {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
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

async function submit(payload: CapturePayload): Promise<BackgroundResponse> {
  const state = await readState();
  if (!hasConfig(state)) {
    chrome.runtime.openOptionsPage();
    return { ok: false, error: "Pentou is not configured. Open options to add server and token." };
  }

  try {
    const result = await postCapture(state.config, payload);
    if (result.ok) {
      if (payload.trigger === "auto") setBadge(actionText(result.actions), "#2563eb");
      return result;
    }
    if (result.error?.includes("token")) {
      setBadge("AUTH", "#dc2626");
      return result;
    }
    throw new Error(result.error);
  } catch {
    const queued = await enqueueCapture(payload);
    setBadge(String(queued.size), queued.dropped ? "#dc2626" : "#f59e0b");
    return {
      ok: true,
      queued: true,
      error: queued.dropped
        ? "Pentou is unreachable. Saved this capture and dropped the oldest queued item."
        : "Pentou is unreachable. Saved this capture for retry.",
    };
  }
}

async function flushQueue(): Promise<void> {
  const state = await readState();
  if (!hasConfig(state) || state.queue.length === 0) {
    setBadge(state.queue.length ? String(state.queue.length) : "");
    return;
  }

  const remaining: QueuedCapture[] = [];
  for (const item of state.queue) {
    try {
      const result = await postCapture(state.config, item);
      if (!result.ok) {
        remaining.push(item);
        if (result.error?.includes("token")) break;
      }
    } catch {
      remaining.push(item);
    }
  }

  state.queue = remaining;
  await writeState(state);
  setBadge(remaining.length ? String(remaining.length) : "");
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 5 });
  flushQueue();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) flushQueue();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const response = await chrome.tabs.sendMessage(tab.id, { type: "PENTOU_CAPTURE", trigger: "manual" });
  if (response?.ok && response.supported && response.payload) {
    await submit(response.payload);
  } else if (response?.ok && !response.supported) {
    setBadge("N/A", "#6b7280");
  } else {
    setBadge("ERR", "#dc2626");
  }
});

chrome.runtime.onMessage.addListener((request: BackgroundRequest, _sender, sendResponse) => {
  (async () => {
    if (request.type === "PENTOU_SUBMIT") return await submit(request.payload);
    if (request.type === "PENTOU_GET_STATE") return { ok: true, state: await readState() };
    if (request.type === "PENTOU_SAVE_STATE") {
      await writeState(request.state);
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
