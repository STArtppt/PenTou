import { describe, expect, it } from "vitest";
import { mergeState, QUEUE_LIMIT } from "./state";
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
});
