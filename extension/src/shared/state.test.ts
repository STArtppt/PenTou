import { describe, expect, it } from "vitest";
import { autoCaptureAllowed, mergeState, QUEUE_LIMIT } from "./state";
import type { QueuedCapture } from "./types";

function queued(i: number): QueuedCapture {
  return {
    platform: "chatgpt",
    externalId: `id-${i}`,
    raw: "{}",
    capturedAt: new Date(i).toISOString(),
  };
}

describe("extension state", () => {
  it("defaults auto collection off for all platforms", () => {
    const state = mergeState();
    expect(state.platforms.chatgpt).toEqual({ enabled: true, auto: false });
    expect(state.platforms.deepseek).toEqual({ enabled: true, auto: false });
  });

  it("caps queue at the newest 200 captures", () => {
    const queue = Array.from({ length: QUEUE_LIMIT + 3 }, (_, i) => queued(i));
    const state = mergeState({ queue });
    expect(state.queue).toHaveLength(QUEUE_LIMIT);
    expect(state.queue[0].externalId).toBe("id-3");
  });

  it("defaults authBlocked to false and preserves a stored true", () => {
    expect(mergeState().authBlocked).toBe(false);
    expect(mergeState({ authBlocked: true }).authBlocked).toBe(true);
  });

  it("only allows auto capture when platform enabled + auto on + not auth blocked", () => {
    const base = mergeState();
    expect(autoCaptureAllowed(base, "chatgpt")).toBe(false); // auto 默认关（US-02.3）

    const autoOn = mergeState({ platforms: { chatgpt: { enabled: true, auto: true } } as any });
    expect(autoCaptureAllowed(autoOn, "chatgpt")).toBe(true);
    expect(autoCaptureAllowed(autoOn, "deepseek")).toBe(false);

    const disabled = mergeState({ platforms: { chatgpt: { enabled: false, auto: true } } as any });
    expect(autoCaptureAllowed(disabled, "chatgpt")).toBe(false);

    const blocked = mergeState({ platforms: { chatgpt: { enabled: true, auto: true } } as any, authBlocked: true });
    expect(autoCaptureAllowed(blocked, "chatgpt")).toBe(false); // 401 暂停（边界 4）
  });
});
