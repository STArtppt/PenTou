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

  it("does not index reasoning comment blocks (spec message-reasoning)", () => {
    configureSearch(dir);
    const body = [
      "<!-- msg-ts: 2026-08-07T09:36:48.000Z -->",
      "<!-- reasoning:search -->",
      "秘密检索词 unique_reasoning_token_xyz",
      "<!-- /reasoning:search -->",
      "<!-- reasoning:thinking -->",
      "内部思考 another_reasoning_token_abc",
      "<!-- /reasoning:thinking -->",
      "",
      "可见的最终答案",
    ].join("\n");
    writeConv("conv_reasoning", "有推理过程的会话", body);
    refreshNow();
    expect(search("unique_reasoning_token_xyz", 30).hits).toHaveLength(0);
    expect(search("another_reasoning_token_abc", 30).hits).toHaveLength(0);
    expect(search("最终答案", 30).hits).toHaveLength(1);
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


/**
 * 注意力加权（spec content-favorites）：收藏项在相关度相近时上浮，但强相关的未收藏项
 * 不被挤出；`favoriteOnly` 是显式过滤，与加权是两件事。
 */
describe("检索的收藏加权与过滤", () => {
  const writeFavDoc = (id: string, title: string, body: string, favorite: boolean) => {
    fs.writeFileSync(
      path.join(dir, "documents", `${id}.md`),
      `---\nid: ${id}\ntitle: ${title}\nfolderId: null\ncreatedAt: 2026-05-28T00:00:00.000Z\nupdatedAt: 2026-05-29T00:00:00.000Z\ncurrentVersionId: ver_1\n${favorite ? "favorite: true\n" : ""}---\n\n${body}\n`,
    );
  };

  it("命中回显 favorite 与 weight；未收藏为 false / 0", () => {
    configureSearch(dir);
    writeFavDoc("doc_fav", "Kyoto A", "kyoto travel notes alpha", true);
    writeFavDoc("doc_plain", "Kyoto B", "kyoto travel notes beta", false);
    refreshNow();

    const hits = search("kyoto", 30).hits;
    const byId = Object.fromEntries(hits.map((h) => [h.id, h]));
    expect(byId.doc_fav.favorite).toBe(true);
    expect(byId.doc_fav.weight).toBe(1);
    expect(byId.doc_plain.favorite).toBe(false);
    expect(byId.doc_plain.weight).toBe(0);
  });

  it("相关度相近时收藏项上浮，且强相关的未收藏项仍在结果集里", () => {
    configureSearch(dir);
    // 5 条相关度接近的命中，最后一条收藏 —— 名次前移 30% 后应越过若干未收藏项
    for (let i = 0; i < 5; i++) writeFavDoc(`doc_p${i}`, `Plain ${i}`, "kyoto travel notes", false);
    writeFavDoc("doc_f", "Fav", "kyoto travel notes", true);
    refreshNow();

    const hits = search("kyoto", 30).hits;
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("doc_f");
    expect(ids).toHaveLength(6);
    // 收藏项不再排在末位（加权确实生效）
    expect(ids[ids.length - 1]).not.toBe("doc_f");
  });

  it("加权是偏置而非过滤：一条无关的收藏项不会被塞进结果", () => {
    configureSearch(dir);
    writeFavDoc("doc_hit", "Hit", "kyoto travel notes", false);
    writeFavDoc("doc_unrelated", "Unrelated", "completely different subject matter", true);
    refreshNow();

    expect(search("kyoto", 30).hits.map((h) => h.id)).toEqual(["doc_hit"]);
  });

  it("favorite=1 的结果集不含未收藏项", () => {
    configureSearch(dir);
    writeFavDoc("doc_fav", "Kyoto A", "kyoto travel notes alpha", true);
    writeFavDoc("doc_plain", "Kyoto B", "kyoto travel notes beta", false);
    refreshNow();

    const hits = search("kyoto", 30, { favoriteOnly: true }).hits;
    expect(hits.map((h) => h.id)).toEqual(["doc_fav"]);
  });

  it("取消收藏后重扫，加权与过滤都跟着回退", () => {
    configureSearch(dir);
    writeFavDoc("doc_x", "Kyoto", "kyoto travel notes", true);
    refreshNow();
    expect(search("kyoto", 30, { favoriteOnly: true }).hits).toHaveLength(1);

    writeFavDoc("doc_x", "Kyoto", "kyoto travel notes", false);
    markStale();
    expect(search("kyoto", 30, { favoriteOnly: true }).hits).toHaveLength(0);
    expect(search("kyoto", 30).hits[0].favorite).toBe(false);
  });

  it("删除文件后 flags 不留孤儿行（同 id 重建的文档不会继承旧收藏）", () => {
    configureSearch(dir);
    writeFavDoc("doc_y", "Kyoto", "kyoto travel notes", true);
    refreshNow();
    expect(search("kyoto", 30).hits[0].favorite).toBe(true);

    fs.rmSync(path.join(dir, "documents", "doc_y.md"));
    markStale();
    expect(search("kyoto", 30).hits).toHaveLength(0);

    writeFavDoc("doc_y", "Kyoto", "kyoto travel notes", false);
    markStale();
    expect(search("kyoto", 30).hits[0].favorite).toBe(false);
  });
});

/**
 * 老库兼容（spec content-favorites D4）：本能力上线前建的索引库没有 flags 表。
 * `CREATE TABLE IF NOT EXISTS` 对它是纯追加 —— 打开不报错，收藏一律按未收藏起步，
 * 此后任何一次收藏切换都会改 .md 的 mtime、触发重扫，把 flags 补齐。
 */
describe("无 flags 表的存量索引库", () => {
  it("首次打开不报错，且重扫后收藏信号自愈", async () => {
    const Database = (await import("better-sqlite3")).default;

    configureSearch(dir);
    writeDoc("doc_legacy", "Kyoto", "kyoto travel notes");
    refreshNow();
    _resetForTest();

    // 模拟老库：把 flags 表整张删掉
    const dbPath = path.join(dir, ".qmd", "index.db");
    const raw = new Database(dbPath);
    raw.exec("DROP TABLE flags");
    raw.close();

    configureSearch(dir);
    refreshNow(); // 文件 mtime 未变 → 全部跳过，flags 仍是空的（正是老库的处境）
    const hits = search("kyoto", 30).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0].favorite).toBe(false);

    // 用户此后收藏它 → mtime 变 → 重扫补齐 flags
    fs.writeFileSync(
      path.join(dir, "documents", "doc_legacy.md"),
      `---\nid: doc_legacy\ntitle: Kyoto\nfolderId: null\ncreatedAt: 2026-05-28T00:00:00.000Z\nupdatedAt: 2026-05-29T00:00:00.000Z\ncurrentVersionId: ver_1\nfavorite: true\n---\n\nkyoto travel notes\n`,
    );
    markStale();
    expect(search("kyoto", 30).hits[0].favorite).toBe(true);
  });
});
