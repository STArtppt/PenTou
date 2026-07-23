import { afterEach, describe, expect, it, vi } from "vitest";
import { batchExportToVault } from "./obsidian";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 回归：批量导出必须逐篇取服务端全文，而不是用侧栏 meta-only 列表的空 body
 *（debugging/2026-07-13-batch-export-empty-body.md）。 */
describe("batchExportToVault", () => {
  const cfg = { vaultName: "V", vaultPath: "/abs/vault" };

  function stubFetch(handlers: { doc?: (id: string) => any; exportStatus?: number }) {
    const exportBodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith("/api/documents/")) {
          const id = String(url).split("/").pop()!;
          const doc = handlers.doc?.(id);
          if (!doc) return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
          return { ok: true, status: 200, json: async () => doc };
        }
        if (String(url) === "/api/obsidian/export") {
          const payload = JSON.parse(String(init?.body));
          exportBodies.push(payload);
          if (handlers.exportStatus && handlers.exportStatus !== 200) {
            return { ok: false, status: handlers.exportStatus, json: async () => ({ error: "boom" }) };
          }
          return { ok: true, status: 200, json: async () => ({ fileName: payload.title }) };
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    return exportBodies;
  }

  it("exports the server-side full body, not the (empty) list body", async () => {
    const exportBodies = stubFetch({
      doc: (id) => ({ id, title: `T-${id}`, body: `full-body-of-${id}` }),
    });

    const result = await batchExportToVault(
      [
        { id: "doc_a", title: "T-doc_a" },
        { id: "doc_b", title: "T-doc_b" },
      ],
      cfg,
    );

    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(exportBodies.map((b) => b.content)).toEqual(["full-body-of-doc_a", "full-body-of-doc_b"]);
    expect(exportBodies.every((b) => b.content.length > 0)).toBe(true);
  });

  it("aggregates per-doc failures without aborting the batch", async () => {
    const exportBodies = stubFetch({
      doc: (id) => (id === "doc_missing" ? null : { id, title: `T-${id}`, body: `body-${id}` }),
    });

    const result = await batchExportToVault(
      [
        { id: "doc_missing", title: "T-doc_missing" },
        { id: "doc_ok", title: "T-doc_ok" },
      ],
      cfg,
    );

    expect(result.failed).toEqual([
      { id: "doc_missing", title: "T-doc_missing", error: "HTTP 404" },
    ]);
    expect(result.succeeded).toEqual([{ id: "doc_ok", title: "T-doc_ok", fileName: "T-doc_ok" }]);
    expect(exportBodies).toHaveLength(1);
  });
});
