import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  configureSearch,
  refreshNow,
  search,
  searchHybrid,
  markStale,
  updateEmbeddingConfig,
  getEmbeddingState,
  _resetForTest,
  _setEmbedFnForTest,
  _waitEmbedIdleForTest,
} from "./search-service";
import type { EmbeddingConfig } from "./embedding-provider";

let dir = "";

function writeDoc(id: string, title: string, body: string) {
  fs.writeFileSync(
    path.join(dir, "documents", `${id}.md`),
    `---\nid: ${id}\ntitle: ${title}\nfolderId: null\ncreatedAt: 2026-05-28T00:00:00.000Z\nupdatedAt: 2026-05-29T00:00:00.000Z\ncurrentVersionId: ver_1\n---\n\n${body}\n`,
  );
}

// 确定性「概念」嵌入：把文本映射到 3 概念 one-hot + misc 兜底维。
// 同义词命中同一概念 → 让查询与文档「语义近」但字面不同（验证纯语义召回）。
const CONCEPTS = [
  ["cat", "feline", "kitten"],
  ["dog", "canine", "puppy"],
  ["travel", "trip", "journey"],
];
function conceptVec(text: string): number[] {
  const low = text.toLowerCase();
  const v = CONCEPTS.map((words) => (words.some((w) => low.includes(w)) ? 1 : 0));
  return [...v, v.some((x) => x > 0) ? 0 : 1]; // 无概念 → misc 维，正交于任何概念向量
}
async function conceptEmbed(_cfg: EmbeddingConfig, texts: string[]): Promise<number[][]> {
  return texts.map(conceptVec);
}

const CFG = { enabled: true, endpoint: "https://e.example/v1", model: "m", apiKey: "sk-test" };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "pentou-emb-"));
  fs.mkdirSync(path.join(dir, "conversations"), { recursive: true });
  fs.mkdirSync(path.join(dir, "documents"), { recursive: true });
  _setEmbedFnForTest(conceptEmbed);
});

afterEach(() => {
  _resetForTest();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function enableAndWait(model = "m") {
  updateEmbeddingConfig({ enabled: true, endpoint: CFG.endpoint, model, apiKey: CFG.apiKey });
  await _waitEmbedIdleForTest();
}

describe("searchService hybrid (Phase 2)", () => {
  it("disabled → searchHybrid returns lex, no degraded", async () => {
    configureSearch(dir);
    writeDoc("d1", "Cat facts", "the cat is fast");
    refreshNow();
    const r = await searchHybrid("cat", 30);
    expect(r.mode).toBe("lex");
    expect(r.degraded).toBeFalsy();
    expect(r.hits).toHaveLength(1);
  });

  it("RRF fuses FTS + vector: both / pure-semantic / pure-lex with correct matchReason", async () => {
    configureSearch(dir);
    writeDoc("d_both", "B", "the cat is fast");        // 字面 cat + 概念 cat → both
    writeDoc("d_sem", "S", "I adore my feline friend"); // 无字面 cat、概念 cat → 纯语义
    writeDoc("d_lex", "cat trivia", "");                // 标题含 cat、空正文(无 chunk) → 纯字面
    refreshNow();
    await enableAndWait();

    const r = await searchHybrid("cat", 30);
    expect(r.mode).toBe("hybrid");
    const byId = Object.fromEntries(r.hits.map((h) => [h.id, h]));
    expect(byId["d_both"]?.matchReason).toBe("both");
    expect(byId["d_sem"]?.matchReason).toBe("semantic");
    expect(byId["d_lex"]?.matchReason).toBe("lex");
  });

  it("pure-semantic hit: snippet is chunk text, all matched:false (not looks-empty)", async () => {
    configureSearch(dir);
    writeDoc("d_sem", "S", "I adore my feline friend and kitten");
    refreshNow();
    await enableAndWait();

    const r = await searchHybrid("cat", 30);
    const hit = r.hits.find((h) => h.id === "d_sem")!;
    expect(hit.matchReason).toBe("semantic");
    expect(hit.snippetParts.every((p) => p.matched === false)).toBe(true);
    expect(hit.snippetText.length).toBeGreaterThan(0);
  });

  it("phase reaches ready after full embed; lex search still works unchanged", async () => {
    configureSearch(dir);
    writeDoc("d1", "Note", "the cat sleeps");
    refreshNow();
    await enableAndWait();
    const st = getEmbeddingState();
    expect(st.phase).toBe("ready");
    expect(st.embedding.done).toBe(st.embedding.total);
    expect(st.embedding.total).toBeGreaterThan(0);
    // Phase 1 lex 路径不受影响
    expect(search("cat", 30).hits).toHaveLength(1);
  });

  it("configuring (first batch pending) → hybrid query degrades to lex", async () => {
    configureSearch(dir);
    writeDoc("d1", "Note", "the cat sleeps");
    refreshNow();
    // embed 永不 resolve → runEmbed 卡在首批，phase 停留 configuring
    _setEmbedFnForTest(() => new Promise<number[][]>(() => {}));
    updateEmbeddingConfig({ enabled: true, endpoint: CFG.endpoint, model: "m", apiKey: CFG.apiKey });
    const r = await searchHybrid("cat", 30);
    expect(r.mode).toBe("lex");
    expect(r.degraded).toBe(true);
    expect(getEmbeddingState().phase).toBe("configuring");
  });

  it("provider error during embed → phase error → hybrid degrades to lex", async () => {
    configureSearch(dir);
    writeDoc("d1", "Note", "the cat sleeps");
    refreshNow();
    _setEmbedFnForTest(async () => { throw new Error("boom"); });
    await enableAndWait();
    expect(getEmbeddingState().phase).toBe("error");
    const r = await searchHybrid("cat", 30);
    expect(r.mode).toBe("lex");
    expect(r.degraded).toBe(true);
  });

  it("dimension change mid-run is rejected → error", async () => {
    configureSearch(dir);
    writeDoc("d1", "Note", "the cat sleeps");
    refreshNow();
    await enableAndWait(); // dim=4 stored
    expect(getEmbeddingState().dim).toBe(4);

    // 新文档 + 换成返回不同维度的 embed → 增量嵌入触发维度不一致
    _setEmbedFnForTest(async (_c, texts) => texts.map(() => [1, 2, 3, 4, 5, 6, 7, 8]));
    writeDoc("d2", "Note2", "a wonderful trip");
    markStale();
    await searchHybrid("trip", 30); // 触发 refresh → 新 chunk → 背景嵌入
    await _waitEmbedIdleForTest();
    expect(getEmbeddingState().phase).toBe("error");
  });

  it("deleting a file drops its chunks and vectors", async () => {
    configureSearch(dir);
    writeDoc("d1", "Note", "the cat sleeps");
    writeDoc("d2", "Note2", "the dog runs");
    refreshNow();
    await enableAndWait();
    const before = getEmbeddingState().embedding.total;
    expect(before).toBeGreaterThanOrEqual(2);

    fs.unlinkSync(path.join(dir, "documents", "d2.md"));
    markStale();
    await searchHybrid("dog", 30); // 触发增量刷新
    await _waitEmbedIdleForTest();
    const after = getEmbeddingState().embedding.total;
    expect(after).toBeLessThan(before);
    // d2 不再出现在结果中
    const r = await searchHybrid("dog", 30);
    expect(r.hits.find((h) => h.id === "d2")).toBeUndefined();
  });
});

describe("embedding config + key security (§4.7)", () => {
  it("getEmbeddingState never exposes apiKey, only hasKey", async () => {
    configureSearch(dir);
    refreshNow();
    updateEmbeddingConfig({ enabled: true, endpoint: CFG.endpoint, model: "m", apiKey: "sk-zzz" });
    const st = getEmbeddingState() as any;
    expect(st.apiKey).toBeUndefined();
    expect(st.hasKey).toBe(true);
  });

  it("persists config with chmod 0600 and PUT-blank keeps existing key", async () => {
    configureSearch(dir);
    refreshNow();
    updateEmbeddingConfig({ enabled: true, endpoint: CFG.endpoint, model: "m", apiKey: "sk-keepme" });
    const p = path.join(dir, ".config", "embedding.json");
    expect(fs.existsSync(p)).toBe(true);
    expect((fs.statSync(p).mode & 0o777)).toBe(0o600);
    // 留空 key → 沿用现有（文件仍含 key、hasKey 仍 true）
    updateEmbeddingConfig({ enabled: true, endpoint: "https://e2/v1", model: "m" });
    expect(getEmbeddingState().hasKey).toBe(true);
    const saved = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(saved.apiKey).toBe("sk-keepme");
    expect(saved.endpoint).toBe("https://e2/v1");
  });

  it("disabling clears vectors and deletes the key field", async () => {
    configureSearch(dir);
    writeDoc("d1", "Note", "the cat sleeps");
    refreshNow();
    await enableAndWait();
    expect(getEmbeddingState().embedding.total).toBeGreaterThan(0);

    updateEmbeddingConfig({ enabled: false });
    const st = getEmbeddingState();
    expect(st.phase).toBe("disabled");
    expect(st.hasKey).toBe(false);
    expect(st.embedding.total).toBe(0);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, ".config", "embedding.json"), "utf-8"));
    expect(saved.apiKey).toBeUndefined();
  });

  it("env var overrides file key and file is not written with the env key", async () => {
    // 先落一份带文件 key 的配置
    configureSearch(dir);
    refreshNow();
    updateEmbeddingConfig({ enabled: true, endpoint: CFG.endpoint, model: "m", apiKey: "sk-file" });
    _resetForTest();
    _setEmbedFnForTest(conceptEmbed);

    // env 注入 key → 覆盖文件、且后续保存不落 env key
    process.env.PENTOU_EMBED_API_KEY = "sk-from-env";
    try {
      configureSearch(dir);
      refreshNow();
      expect(getEmbeddingState().hasKey).toBe(true);
      // 再保存（改 model）→ 文件不应写入 env key
      updateEmbeddingConfig({ enabled: true, endpoint: CFG.endpoint, model: "m2" });
      const saved = JSON.parse(fs.readFileSync(path.join(dir, ".config", "embedding.json"), "utf-8"));
      expect(saved.apiKey).toBeUndefined();
    } finally {
      delete process.env.PENTOU_EMBED_API_KEY;
    }
  });
});

/**
 * 混合模式的注意力加权（spec content-favorites）：与 lex 路径同一出口、同一口径，
 * 不能出现「换个 mode 收藏就不算数了」。
 */
describe("hybrid 模式的收藏加权", () => {
  const writeFavDoc = (id: string, title: string, body: string, favorite: boolean) => {
    fs.writeFileSync(
      path.join(dir, "documents", `${id}.md`),
      `---\nid: ${id}\ntitle: ${title}\nfolderId: null\ncreatedAt: 2026-05-28T00:00:00.000Z\nupdatedAt: 2026-05-29T00:00:00.000Z\ncurrentVersionId: ver_1\n${favorite ? "favorite: true\n" : ""}---\n\n${body}\n`,
    );
  };

  it("hybrid 与 lex 一致地回显 favorite / weight", async () => {
    configureSearch(dir);
    writeFavDoc("d_fav", "Cat A", "the cat is fast", true);
    writeFavDoc("d_plain", "Cat B", "the cat is slow", false);
    refreshNow();
    await enableAndWait();

    const hybrid = await searchHybrid("cat", 30);
    expect(hybrid.mode).toBe("hybrid");
    const byIdHybrid = Object.fromEntries(hybrid.hits.map((h) => [h.id, h]));
    expect(byIdHybrid.d_fav.favorite).toBe(true);
    expect(byIdHybrid.d_fav.weight).toBe(1);
    expect(byIdHybrid.d_plain.favorite).toBe(false);

    const lex = search("cat", 30);
    const byIdLex = Object.fromEntries(lex.hits.map((h) => [h.id, h]));
    expect(byIdLex.d_fav.favorite).toBe(byIdHybrid.d_fav.favorite);
    expect(byIdLex.d_fav.weight).toBe(byIdHybrid.d_fav.weight);
  });

  it("hybrid 下 favoriteOnly 同样只留收藏项", async () => {
    configureSearch(dir);
    writeFavDoc("d_fav", "Cat A", "the cat is fast", true);
    writeFavDoc("d_plain", "Cat B", "the cat is slow", false);
    refreshNow();
    await enableAndWait();

    const r = await searchHybrid("cat", 30, { favoriteOnly: true });
    expect(r.hits.map((h) => h.id)).toEqual(["d_fav"]);
  });

  it("降级回 lex 时加权照常生效（不因降级丢掉收藏信号）", async () => {
    configureSearch(dir);
    writeFavDoc("d_fav", "Cat A", "the cat is fast", true);
    refreshNow();
    _setEmbedFnForTest(async () => { throw new Error("boom"); });
    updateEmbeddingConfig({ enabled: true, endpoint: CFG.endpoint, model: "m", apiKey: CFG.apiKey });

    const r = await searchHybrid("cat", 30);
    expect(r.mode).toBe("lex");
    expect(r.hits[0].favorite).toBe(true);
  });
});
