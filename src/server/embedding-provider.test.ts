import { afterEach, describe, expect, it, vi } from "vitest";
import { embed, EmbeddingError, type EmbeddingConfig } from "./embedding-provider";

const cfg: EmbeddingConfig = {
  enabled: true,
  endpoint: "https://api.example.com/v1",
  model: "text-embedding-3-small",
  apiKey: "sk-secret",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("embeddingProvider.embed", () => {
  it("returns vectors aligned to input order (sorts by index)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock as any);

    const out = await embed(cfg, ["a", "b"]);
    expect(out).toEqual([[1, 0], [0, 1]]);
    // 端点拼出 /embeddings，Authorization 带 key（不在此断言明文，仅确认有调用）。
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0][0] as string)).toBe("https://api.example.com/v1/embeddings");
  });

  it("short-circuits empty input without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as any);
    expect(await embed(cfg, [])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws EmbeddingError with status on non-2xx (e.g. 401)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as any);
    await expect(embed(cfg, ["x"])).rejects.toMatchObject({ name: "EmbeddingError", status: 401 });
  });

  it("maps aborted/timeout fetch to EmbeddingError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }) as any);
    await expect(embed(cfg, ["x"])).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("rejects mismatched data length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ data: [{ index: 0, embedding: [1, 2] }] }),
    })) as any);
    await expect(embed(cfg, ["a", "b"])).rejects.toBeInstanceOf(EmbeddingError);
  });
});
