import { afterEach, describe, expect, it, vi } from "vitest";
import { postCapture } from "./ingest";
import type { CapturePayload } from "../shared/types";

const config = { server: "http://localhost:5173", token: "secret" };
const payload: CapturePayload = {
  platform: "chatgpt",
  externalId: "conv-1",
  raw: "{}",
  capturedAt: "2026-07-09T00:00:00.000Z",
  trigger: "manual",
};

function stubFetch(response: Response | Error): void {
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postCapture failure classification", () => {
  it("classifies fetch failures as network (queueable)", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const result = await postCapture(config, payload);
    expect(result).toMatchObject({ ok: false, code: "network" });
  });

  it("classifies 401 as unauthorized", async () => {
    stubFetch(new Response("", { status: 401 }));
    const result = await postCapture(config, payload);
    expect(result).toMatchObject({ ok: false, code: "unauthorized" });
  });

  it("classifies non-401 HTTP failures as http", async () => {
    stubFetch(new Response("", { status: 500 }));
    const result = await postCapture(config, payload);
    expect(result).toMatchObject({ ok: false, code: "http" });
  });

  it("classifies per-item server errors as item-error with the platform message", async () => {
    stubFetch(new Response(JSON.stringify({
      ok: false,
      results: [{ itemIndex: 0, conversations: [], error: "chatgpt raw payload missing mapping" }],
    }), { status: 200 }));
    const result = await postCapture(config, payload);
    expect(result).toMatchObject({ ok: false, code: "item-error" });
    expect(result.error).toContain("chatgpt raw payload missing mapping");
  });

  it("summarizes successful actions", async () => {
    stubFetch(new Response(JSON.stringify({
      ok: true,
      results: [{ itemIndex: 0, conversations: [{ action: "merged", id: "c1", title: "T" }] }],
    }), { status: 200 }));
    const result = await postCapture(config, payload);
    expect(result).toMatchObject({ ok: true, actions: { merged: 1 }, id: "c1" });
  });
});
