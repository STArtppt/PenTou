import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { zipSync } from "fflate";
import {
  __setMineruFetchForTests,
  __setMineruSleepForTests,
  getMineruStatus,
  parseFilesWithMineru,
  setMineruDataDir,
  updateMineruConfig,
} from "../../vite-plugins/mineruPlugin";

let dataDir: string;
let fileDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(tmpdir(), "pentou-mineru-test-data-"));
  fileDir = fs.mkdtempSync(path.join(tmpdir(), "pentou-mineru-test-files-"));
  setMineruDataDir(dataDir);
  __setMineruSleepForTests(async () => {});
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(fileDir, { recursive: true, force: true });
  __setMineruFetchForTests(null);
  __setMineruSleepForTests(null);
});

function makeFile(name: string, content: string) {
  const filepath = path.join(fileDir, name);
  fs.writeFileSync(filepath, content);
  return { originalName: name, filepath };
}

describe("MinerU config", () => {
  it("saves, keeps existing token on empty update, clears explicitly, and never returns the key", () => {
    expect(getMineruStatus()).toEqual({ configured: false, hasKey: false });

    const saved = updateMineruConfig({ apiToken: "token-1" });
    expect(saved).toEqual({ configured: true, hasKey: true });
    expect((saved as any).apiToken).toBeUndefined();

    updateMineruConfig({ apiToken: "" });
    expect(getMineruStatus().hasKey).toBe(true);
    expect(fs.readFileSync(path.join(dataDir, ".config", "mineru.json"), "utf-8")).toContain("token-1");

    expect(updateMineruConfig({ clear: true })).toEqual({ configured: false, hasKey: false });
  });
});

describe("parseFilesWithMineru", () => {
  it("returns token guidance without network calls when unconfigured", async () => {
    const fetchMock = vi.fn();
    __setMineruFetchForTests(fetchMock as any);
    const [result] = await parseFilesWithMineru([makeFile("a.pdf", "pdf")]);
    expect(result.success).toBe(false);
    if (result.success === false) expect(result.error).toContain("需配置 MinerU Token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps upload urls by request order, matches poll results by data_id, and extracts full.md", async () => {
    updateMineruConfig({ apiToken: "token-1" });
    const zip = zipSync({
      "full.md": new TextEncoder().encode('# Parsed\n\n![p](images/a.png)\n\n<img src="images/a.png" alt="h">'),
      "images/a.png": new Uint8Array([1, 2, 3]),
    });
    let dataIds: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v4/file-urls/batch")) {
        const body = JSON.parse(String(init?.body));
        expect(body.files.map((f: any) => f.name)).toEqual(["a.pdf", "b.docx"]);
        dataIds = body.files.map((f: any) => f.data_id);
        return new Response(JSON.stringify({
          code: 0,
          data: { batch_id: "batch-1", file_urls: ["https://upload/first", "https://upload/second"] },
        }));
      }
      if (url === "https://upload/first" || url === "https://upload/second") {
        expect(init?.method).toBe("PUT");
        expect((init?.headers as any)?.["Content-Type"]).toBeUndefined();
        return new Response("");
      }
      if (url.endsWith("/api/v4/extract-results/batch/batch-1")) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            extract_result: [
              { file_name: "b.docx", data_id: dataIds[1], state: "done", full_zip_url: "https://zip/b" },
              { file_name: "a.pdf", data_id: dataIds[0], state: "done", full_zip_url: "https://zip/a" },
            ],
          },
        }));
      }
      if (url === "https://zip/a" || url === "https://zip/b") {
        return new Response(zip);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    __setMineruFetchForTests(fetchMock as any);

    const results = await parseFilesWithMineru([
      makeFile("a.pdf", "aaa"),
      makeFile("b.docx", "bbb"),
    ]);

    expect(results.map((r) => r.originalName)).toEqual(["a.pdf", "b.docx"]);
    expect(results.every((r) => r.success)).toBe(true);
    if (results[0].success) {
      expect(results[0].content).toContain("# Parsed");
      expect(results[0].content).toContain("![h](images/a.png)");
      expect(fs.existsSync(path.join(results[0].baseDir, "images", "a.png"))).toBe(true);
      results[0].cleanup();
    }
    if (results[1].success) results[1].cleanup();
  });

  it("keeps a failed upload out of polling while importing the rest", async () => {
    updateMineruConfig({ apiToken: "token-1" });
    const zip = zipSync({ "full.md": new TextEncoder().encode("ok") });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v4/file-urls/batch")) {
        return new Response(JSON.stringify({
          code: 0,
          data: { batch_id: "batch-1", file_urls: ["https://upload/fail", "https://upload/ok"] },
        }));
      }
      if (url === "https://upload/fail") return new Response("", { status: 403 });
      if (url === "https://upload/ok") return new Response("");
      if (url.endsWith("/api/v4/extract-results/batch/batch-1")) {
        return new Response(JSON.stringify({
          code: 0,
          data: { extract_result: [{ file_name: "ok.pdf", state: "done", full_zip_url: "https://zip/ok" }] },
        }));
      }
      if (url === "https://zip/ok") return new Response(zip);
      throw new Error(`unexpected fetch ${url}`);
    });
    __setMineruFetchForTests(fetchMock as any);

    const results = await parseFilesWithMineru([
      makeFile("bad.pdf", "bad"),
      makeFile("ok.pdf", "ok"),
    ]);

    expect(results[0].success).toBe(false);
    if (results[0].success === false) expect(results[0].error).toContain("HTTP 403");
    expect(results[1].success).toBe(true);
    if (results[1].success) results[1].cleanup();
  });
});
