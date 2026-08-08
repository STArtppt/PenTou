import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  configureSearch,
  refreshNow,
  search,
  markStale,
  getStatus,
  _resetForTest,
} from "./search-service";

let dir = "";

function writeConv(id: string, title: string, body: string, date = "2026-05-30T00:00:00.000Z") {
  fs.writeFileSync(
    path.join(dir, "conversations", `${id}.md`),
    `---\nid: ${id}\ntitle: ${title}\nplatform: ChatGPT\ndate: ${date}\nfolderId: null\n---\n\n## User\n\n${body}\n`,
  );
}
function writeDoc(id: string, title: string, body: string) {
  fs.writeFileSync(
    path.join(dir, "documents", `${id}.md`),
    `---\nid: ${id}\ntitle: ${title}\nfolderId: null\ncreatedAt: 2026-05-28T00:00:00.000Z\nupdatedAt: 2026-05-29T00:00:00.000Z\ncurrentVersionId: ver_1\n---\n\n${body}\n`,
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "pentou-search-"));
  fs.mkdirSync(path.join(dir, "conversations"), { recursive: true });
  fs.mkdirSync(path.join(dir, "documents"), { recursive: true });
});

afterEach(() => {
  _resetForTest();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("searchService", () => {
  it("getStatus is building before prewarm completes, ready after build", () => {
    configureSearch(dir);
    expect(getStatus()).toBe("building");
    refreshNow();
    expect(getStatus()).toBe("ready");
  });

  it("matches English content, returns BM25-ordered hits with highlighted snippetParts", () => {
    configureSearch(dir);
    writeDoc("doc_1", "Search Engine Notes", "This document explains full text search using BM25 ranking and FTS5.");
    refreshNow();

    const r = search("BM25", 30);
    expect(r.status).toBe("ready");
    expect(r.hits).toHaveLength(1);
    const hit = r.hits[0];
    expect(hit.type).toBe("document");
    expect(hit.id).toBe("doc_1");
    // snippetParts join back to snippetText with no character loss (no innerHTML)
    expect(hit.snippetParts.map((p) => p.text).join("")).toBe(hit.snippetText);
    expect(hit.snippetParts.some((p) => p.matched && /bm25/i.test(p.text))).toBe(true);
  });

  it("recalls 2-character Chinese words (no-space CJK tokenization)", () => {
    configureSearch(dir);
    writeConv("conv_1", "京都旅行计划", "帮我规划一次去京都的旅行，主要看寺庙和混合检索");
    refreshNow();

    for (const q of ["旅行", "京都", "检索"]) {
      const r = search(q, 30);
      expect(r.hits.length, `query=${q}`).toBe(1);
      expect(r.hits[0].id).toBe("conv_1");
    }
  });

  it("does not false-match unrelated queries", () => {
    configureSearch(dir);
    writeConv("conv_1", "天气", "今天天气不错");
    refreshNow();
    expect(search("量子计算", 30).hits).toHaveLength(0);
  });

  it("short-circuits empty / whitespace-only / punctuation queries", () => {
    configureSearch(dir);
    writeDoc("doc_1", "X", "hello world");
    refreshNow();
    expect(search("", 30).hits).toHaveLength(0);
    expect(search("   ", 30).hits).toHaveLength(0);
    expect(search("！？，。", 30).hits).toHaveLength(0);
  });

  it("incrementally indexes newly added content after markStale", () => {
    configureSearch(dir);
    refreshNow();
    expect(search("kyoto", 30).hits).toHaveLength(0);

    writeDoc("doc_new", "Trip", "A wonderful trip to kyoto next spring");
    markStale();
    const r = search("kyoto", 30);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].id).toBe("doc_new");
  });

  it("drops deleted content from results after markStale", () => {
    configureSearch(dir);
    writeConv("conv_1", "旅行", "京都旅行计划");
    refreshNow();
    expect(search("旅行", 30).hits).toHaveLength(1);

    fs.unlinkSync(path.join(dir, "conversations", "conv_1.md"));
    markStale();
    expect(search("旅行", 30).hits).toHaveLength(0);
  });

  it("respects the limit argument", () => {
    configureSearch(dir);
    for (let i = 0; i < 5; i++) writeDoc(`doc_${i}`, `Note ${i}`, "shared keyword apple here");
    refreshNow();
    expect(search("apple", 2).hits).toHaveLength(2);
    expect(search("apple", 30).hits).toHaveLength(5);
  });
});

describe("记忆参与检索（spec ai-workspace）", () => {
  it("记忆文档能作为命中结果返回，与普通文档无异", () => {
    configureSearch(dir);
    fs.writeFileSync(
      path.join(dir, "documents", "doc_memory_dp_default.md"),
      `---\nid: doc_memory_dp_default\ntitle: 记忆\nfolderId: df_ai_dp_default\ncreatedAt: 2026-05-28T00:00:00.000Z\nupdatedAt: 2026-05-29T00:00:00.000Z\ncurrentVersionId: ver_1\n---\n\n用户偏好用中文回答，且喜欢先给结论。\n`,
    );
    refreshNow();

    const r = search("中文回答", 30);
    expect(r.hits.map((h) => h.id)).toContain("doc_memory_dp_default");
  });
});

