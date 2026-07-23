import { describe, expect, it } from "vitest";
import { IngestClient, IngestHttpError, IngestNetworkError, isAuthIngestError, isRetryableIngestError } from "./ingest-client";
import type { IngestItem } from "./types";

function item(id: string): IngestItem {
  return { platform: "claude-code", externalId: id, format: "raw", data: "{}", filename: `${id}.jsonl` };
}

describe("IngestClient", () => {
  it("splits uploads into batches of 50", async () => {
    const sizes: number[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      sizes.push(JSON.parse(String(init.body)).items.length);
      return new Response(JSON.stringify({ ok: true, results: [] }), { status: 200 });
    };
    const client = new IngestClient({ server: "http://pentou.test/", token: "tok", fetchImpl: fetchImpl as any });
    await client.ingestBatches(Array.from({ length: 101 }, (_, index) => item(String(index))));
    expect(sizes).toEqual([50, 50, 1]);
  });

  it("classifies 401, 5xx, and network failures", async () => {
    const unauthorized = new IngestHttpError(401, "401 unauthorized");
    const unavailable = new IngestHttpError(503, "503 unavailable");
    const network = new IngestNetworkError("ECONNREFUSED");

    expect(isAuthIngestError(unauthorized)).toBe(true);
    expect(isRetryableIngestError(unauthorized)).toBe(false);
    expect(isRetryableIngestError(unavailable)).toBe(true);
    expect(isRetryableIngestError(network)).toBe(true);
  });

  it("sends ping with bearer token", async () => {
    let seenAuth = "";
    const fetchImpl = async (_url: string, init: RequestInit) => {
      seenAuth = String((init.headers as any).Authorization);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const client = new IngestClient({ server: "http://pentou.test", token: "secret", fetchImpl: fetchImpl as any });
    await client.ping();
    expect(seenAuth).toBe("Bearer secret");
  });
});
