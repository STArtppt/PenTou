import type { BackgroundRequest, BackgroundResponse, ExtensionState, PlatformSlug } from "../shared/types";
import { mergeState } from "../shared/state";
import "./styles.css";

const serverInput = document.querySelector<HTMLInputElement>("#server")!;
const tokenInput = document.querySelector<HTMLInputElement>("#token")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const queueEl = document.querySelector<HTMLParagraphElement>("#queue")!;

function input(id: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`#${id}`)!;
}

function platformState(platform: PlatformSlug) {
  return {
    enabled: input(`${platform}-enabled`).checked,
    auto: input(`${platform}-auto`).checked,
  };
}

function render(state: ExtensionState): void {
  serverInput.value = state.config.server;
  tokenInput.value = state.config.token;
  input("chatgpt-enabled").checked = state.platforms.chatgpt.enabled;
  input("chatgpt-auto").checked = state.platforms.chatgpt.auto;
  input("deepseek-enabled").checked = state.platforms.deepseek.enabled;
  input("deepseek-auto").checked = state.platforms.deepseek.auto;
  queueEl.textContent = state.queue.length === 0
    ? "No queued captures."
    : `${state.queue.length} capture${state.queue.length === 1 ? "" : "s"} waiting for retry.`;
}

function collectState(previous: ExtensionState): ExtensionState {
  return mergeState({
    ...previous,
    config: {
      server: serverInput.value,
      token: tokenInput.value,
    },
    platforms: {
      chatgpt: platformState("chatgpt"),
      deepseek: platformState("deepseek"),
    },
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
