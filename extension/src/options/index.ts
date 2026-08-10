import type { BackgroundRequest, BackgroundResponse, ExtensionState, PlatformSlug } from "../shared/types";
import { mergeState, SUPPORTED_PLATFORMS } from "../shared/state";
import "./styles.css";

/** 展示名：slug → 可读标签（仅 UI，不影响 externalKey）。 */
const PLATFORM_LABELS: Record<PlatformSlug, string> = {
  chatgpt: "ChatGPT",
  deepseek: "DeepSeek",
  doubao: "Doubao",
  qwen: "Qwen (China)",
  "qwen-intl": "Qwen (International)",
  gemini: "Gemini",
};

const serverInput = document.querySelector<HTMLInputElement>("#server")!;
const tokenInput = document.querySelector<HTMLInputElement>("#token")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const queueEl = document.querySelector<HTMLParagraphElement>("#queue")!;
const platformsEl = document.querySelector<HTMLDivElement>("#platforms")!;

function input(id: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`)!;
}

function ensurePlatformRows(): void {
  if (platformsEl.dataset.ready === "1") return;
  for (const slug of SUPPORTED_PLATFORMS) {
    const label = PLATFORM_LABELS[slug] ?? slug;
    const enabled = document.createElement("label");
    enabled.className = "row";
    enabled.innerHTML = `<input id="${slug}-enabled" type="checkbox" /> ${label}`;
    const auto = document.createElement("label");
    auto.className = "row indent";
    auto.innerHTML = `<input id="${slug}-auto" type="checkbox" /> Auto collect after idle`;
    platformsEl.append(enabled, auto);
  }
  platformsEl.dataset.ready = "1";
}

function platformState(platform: PlatformSlug) {
  return {
    enabled: input(`${platform}-enabled`).checked,
    auto: input(`${platform}-auto`).checked,
  };
}

function render(state: ExtensionState): void {
  ensurePlatformRows();
  serverInput.value = state.config.server;
  tokenInput.value = state.config.token;
  for (const slug of SUPPORTED_PLATFORMS) {
    const cfg = state.platforms[slug] ?? { enabled: true, auto: false };
    input(`${slug}-enabled`).checked = cfg.enabled;
    input(`${slug}-auto`).checked = cfg.auto;
  }
  queueEl.textContent = state.queue.length === 0
    ? "No queued captures."
    : `${state.queue.length} capture${state.queue.length === 1 ? "" : "s"} waiting for retry.`;
}

function collectState(previous: ExtensionState): ExtensionState {
  const platforms = {} as ExtensionState["platforms"];
  for (const slug of SUPPORTED_PLATFORMS) {
    platforms[slug] = platformState(slug);
  }
  return mergeState({
    ...previous,
    config: {
      server: serverInput.value,
      token: tokenInput.value,
    },
    platforms,
  });
}

async function send<T extends BackgroundResponse>(request: BackgroundRequest): Promise<T> {
  return await chrome.runtime.sendMessage(request) as T;
}

type TestConnectionResponse =
  | { ok: true; status: "connected" }
  | { ok: false; error: string; status?: "unauthorized" | "unreachable" };

async function load(): Promise<ExtensionState> {
  const response = await send<{ ok: true; state: ExtensionState }>({ type: "PENTOU_GET_STATE" });
  render(response.state);
  return response.state;
}

async function init(): Promise<void> {
  ensurePlatformRows();
  let currentState = await load();

  document.querySelector<HTMLButtonElement>("#save")!.addEventListener("click", async () => {
    currentState = collectState(currentState);
    const response = await send<{ ok: true; state: ExtensionState }>({ type: "PENTOU_SAVE_STATE", state: currentState });
    currentState = response.state;
    render(currentState);
    statusEl.textContent = "Saved.";
  });

  document.querySelector<HTMLButtonElement>("#test")!.addEventListener("click", async () => {
    statusEl.textContent = "Testing...";
    const response = await send<TestConnectionResponse>({
      type: "PENTOU_TEST_CONNECTION",
      server: serverInput.value,
      token: tokenInput.value,
    });
    if (response.ok) {
      statusEl.textContent = "Connected.";
    } else if (response.status === "unauthorized") {
      statusEl.textContent = "Token rejected.";
    } else {
      statusEl.textContent = "Pentou is unreachable.";
    }
  });
}

init().catch((error) => {
  statusEl.textContent = String(error?.message ?? error);
});
