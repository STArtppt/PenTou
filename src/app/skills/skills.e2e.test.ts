/**
 * 四个技能的端到端产出（用 mock 的 `/api/*` 与 LLM 驱动 runner，不起服务）。
 * 断言的重点是 spec 里的硬约束：产物落哪、改了什么、以及**没改什么**。
 */
import { describe, expect, it } from "vitest";
import { executeSkill, type RunEvent, type SkillDeps } from "../skill-runtime";
import { SKILL_REGISTRY } from "./index";

interface Recorded {
  method: string;
  url: string;
  body?: any;
}

function harness(params: {
  routes: Record<string, unknown>;
  llm: string | ((messages: any[]) => string);
}): { deps: SkillDeps; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const deps: SkillDeps = {
    apiBase: "",
    fetchImpl: (async (url: string, init?: any) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (method !== "GET") {
        return { ok: true, status: 200, text: async () => "", json: async () => ({ ok: true, version: { id: "ver_9" } }) };
      }
      const key = Object.keys(params.routes)
        .filter((prefix) => url.startsWith(prefix))
        .sort((a, b) => b.length - a.length)[0];
      if (!key) return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
      return { ok: true, status: 200, json: async () => params.routes[key] };
    }) as unknown as typeof fetch,
    callLLM: async (_cfg, messages) => ({
      content: typeof params.llm === "string" ? params.llm : params.llm(messages),
      toolCalls: [],
    }),
    llmConfig: { endpoint: "", apiKey: "", model: "test-model" } as SkillDeps["llmConfig"],
  };
  return { deps, calls };
}

async function run(skillId: string, input: Record<string, unknown>, deps: SkillDeps) {
  const events: RunEvent[] = [];
  for await (const event of executeSkill(SKILL_REGISTRY[skillId], input, deps)) events.push(event);
  const error = events.find((e) => e.type === "error");
  if (error) throw new Error((error as { error: string }).error);
  return (events.find((e) => e.type === "result") as { output: any }).output;
}

const CONV = {
  id: "conv_1",
  title: "关于本地优先的讨论",
  platform: "ChatGPT",
  messages: [{ role: "user", content: "为什么本地优先？" }],
};

describe("conversation-to-doc 端到端", () => {
  it("新建产物落用户地盘的未分类，带上来源血缘，不碰 AI 空间", async () => {
    const { deps, calls } = harness({
      routes: { "/api/conversations/conv_1": CONV, "/api/documents?fields=meta": [] },
      llm: "# 本地优先\n\n结论……",
    });

    const out = await run("conversation-to-doc", { conversationId: "conv_1" }, deps);

    expect(out).toMatchObject({ title: "本地优先", created: true, projectId: null });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/documents");
    expect(post.body.folderId).toBeNull();
    expect(post.body.sourceConversationId).toBe("conv_1");
    expect(post.body.generatedBy).toBe("test-model");
  });

  it("再转一次覆盖既有产物，但先落新版本（可回滚）", async () => {
    const existing = { id: "doc_old", title: "旧标题", folderId: null, updatedAt: "t", sourceConversationId: "conv_1" };
    const { deps, calls } = harness({
      routes: { "/api/conversations/conv_1": CONV, "/api/documents?fields=meta": [existing] },
      llm: "# 新标题\n\n新正文",
    });

    const out = await run("conversation-to-doc", { conversationId: "conv_1" }, deps);

    expect(out).toMatchObject({ docId: "doc_old", created: false, versionId: "ver_9" });
    expect(calls.find((c) => c.method === "POST")!.url).toBe("/api/documents/doc_old/commit-version");
    // 标题与血缘走 PUT，正文只经 commit-version
    expect(calls.find((c) => c.method === "PUT")!.body).not.toHaveProperty("body");
  });

  it("来源带项目属性时继承该项目", async () => {
    const { deps } = harness({
      routes: { "/api/conversations/conv_1": { ...CONV, projectId: "dp_x" }, "/api/documents?fields=meta": [] },
      llm: "# T\n正文",
    });
    expect((await run("conversation-to-doc", { conversationId: "conv_1" }, deps)).projectId).toBe("dp_x");
  });

  it("全程不写任何会话端点", async () => {
    const { deps, calls } = harness({
      routes: { "/api/conversations/conv_1": CONV, "/api/documents?fields=meta": [] },
      llm: "# T\n正文",
    });
    await run("conversation-to-doc", { conversationId: "conv_1" }, deps);
    expect(calls.filter((c) => c.method !== "GET" && c.url.startsWith("/api/conversations"))).toEqual([]);
  });
});

describe("topic-digest 端到端", () => {
  const HITS = {
    hits: [
      { type: "conversation", id: "c1", title: "选型讨论", snippetText: "本地优先片段", score: 0.9 },
      { type: "document", id: "d1", title: "存储设计", snippetText: "落盘方案", score: 0.5 },
    ],
  };
  const METAS = [
    {
      id: "c1",
      title: "选型讨论",
      platform: "Claude",
      date: "2026-06-14T08:00:00.000Z",
      ingestSource: "cli:claude-code",
      sourceProject: "pentou",
    },
  ];
  const routes = {
    "/api/search": HITS,
    "/api/conversations?fields=meta": METAS,
    "/api/conversations/c1": { id: "c1", messages: [{ role: "user", content: "为什么本地优先？" }] },
    "/api/documents/d1": { id: "d1", body: "落盘方案的正文" },
  };
  // understand 要 JSON，compose 要 Markdown —— 按 system prompt 分辨
  const llm = (messages: any[]) =>
    String(messages[0]?.content).includes("主题理解")
      ? '{"queries":["检索方案","retrieval ranking"],"scope":"围绕检索与排序的取舍"}'
      : "## 主题界定\n\n围绕检索排序。\n\n## 深读\n\n### [1] 选型讨论\n\n#### 概览\n\n……\n\n## 整体评估\n\n……";

  it("汇总落 AI 空间，正文含统计与可点击来源，被引用的会话零改动", async () => {
    const { deps, calls } = harness({ routes, llm });

    const out = await run("topic-digest", { topic: "检索方案" }, deps);

    expect(out).toMatchObject({ topic: "检索方案", sourceCount: 2, deepReadCount: 2, folderId: "df_ai_dp_default" });
    expect(out.citations.map((c: any) => c.id)).toEqual(["c1", "d1"]);
    // 统计由客户端算：模型说什么都不影响这些数字
    expect(out.stats.total).toBe(2);
    expect(out.stats.platform).toEqual([["Claude", 1], ["未标注", 1]]);
    expect(out.stats.month).toEqual([["2026-06", 1], ["未标注", 1]]);

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body.folderId).toBe("df_ai_dp_default");
    expect(post.body.body).toContain("## 分布统计");
    expect(post.body.body).toContain("基于本次检索中**相关度最高的 2 条**");
    expect(post.body.body).toContain("## 来源");
    // 来源是可点击的应用内链接，目标取自检索结果的真实 id
    expect(post.body.body).toContain("[选型讨论](pentou://conversation/c1)");
    expect(post.body.body).toContain("[存储设计](pentou://document/d1)");
    expect(post.body.body).toContain("Claude");

    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(1); // 只写了那一篇汇总
  });

  it("被引用的会话与文档零改动：全程没有任何非 GET 的会话/文档写入", async () => {
    const { deps, calls } = harness({ routes, llm });
    await run("topic-digest", { topic: "检索方案" }, deps);
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes.map((c) => c.url)).toEqual(["/api/documents"]); // 只有新建汇总这一次
    expect(writes.some((c) => c.url.startsWith("/api/conversations"))).toBe(false);
  });

  it("扩展查询词各检索一次，去重后按相关度排序", async () => {
    const { deps, calls } = harness({ routes, llm });
    await run("topic-digest", { topic: "检索方案" }, deps);
    const searches = calls.filter((c) => c.url.startsWith("/api/search"));
    expect(searches).toHaveLength(2);
    expect(decodeURIComponent(searches[1].url)).toContain("q=retrieval ranking");
  });

  it("模型给的来源是垃圾也不影响链接目标", async () => {
    const { deps, calls } = harness({
      routes,
      llm: (messages: any[]) =>
        String(messages[0]?.content).includes("主题理解")
          ? "不是 JSON"
          : "## 主题界定\n\n见 [伪造来源](pentou://conversation/conv_编造的)。",
    });
    await run("topic-digest", { topic: "检索方案" }, deps);
    const body = calls.find((c) => c.method === "POST")!.body.body as string;
    // 来源节里只有检索结果的真实 id
    const sources = body.slice(body.indexOf("## 来源"));
    expect(sources).toContain("pentou://conversation/c1");
    expect(sources).not.toContain("conv_编造的");
  });

  it("指定项目时落该项目的 AI 空间", async () => {
    const { deps } = harness({ routes, llm });
    expect((await run("topic-digest", { topic: "T", projectId: "dp_x" }, deps)).folderId).toBe("df_ai_dp_x");
  });

  it("零命中时明确失败，不产出空汇总", async () => {
    const { deps, calls } = harness({ routes: { ...routes, "/api/search": { hits: [] } }, llm });
    await expect(run("topic-digest", { topic: "不存在的主题" }, deps)).rejects.toThrow(/没有检索到/);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("命中不足 3 条时按实际数量深读，不补空位", async () => {
    const { deps } = harness({
      routes: { ...routes, "/api/search": { hits: [HITS.hits[0]] } },
      llm,
    });
    const out = await run("topic-digest", { topic: "冷门主题" }, deps);
    expect(out.deepReadCount).toBe(1);
    expect(out.citations).toHaveLength(1);
  });
});

describe("doc-folder-organize 端到端", () => {
  const DOCS = [
    { id: "doc_a", title: "Vite 配置笔记", folderId: null, updatedAt: "t-a" },
    { id: "doc_b", title: "读书摘录", folderId: null, updatedAt: "t-b" },
    { id: "doc_memory_dp_default", title: "记忆", folderId: "df_ai_dp_default", updatedAt: "t-m" },
  ];
  const FOLDERS = [
    { id: "df_ai_dp_default", name: "AI 空间", projectId: null },
    { id: "df_dev", name: "开发指南", projectId: null },
    { id: "df_orphan", name: "遗留", projectId: "dp_gone" },
  ];
  const routes = {
    "/api/documents?fields=meta": DOCS,
    "/api/document-folders": FOLDERS,
    "/api/document-projects": [],
  };

  it("产出计划文档：条目带复选框、绑定与快照进 frontmatter、期间零改动", async () => {
    const { deps, calls } = harness({
      routes,
      llm: JSON.stringify({
        items: [
          { docId: "doc_a", folderName: "开发指南", reason: "讲构建配置" },
          { docId: "doc_b", folderName: "读书笔记" },
        ],
      }),
    });

    const out = await run("doc-folder-organize", { planTitle: "整理计划" }, deps);

    expect(out).toMatchObject({ itemCount: 2, candidateCount: 2, folderId: "df_ai_dp_default" });
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes).toHaveLength(1); // 只写了计划本身
    expect(writes[0].url).toBe("/api/documents");
    expect(writes[0].body.folderId).toBe("df_ai_dp_default");
    expect(writes[0].body.body).toContain("- [x] 把《Vite 配置笔记》归入「开发指南」 —— 讲构建配置");

    const plan = JSON.parse(writes[0].body.aiPlan);
    expect(plan.items[0].folderId).toBe("df_dev"); // 复用已有文件夹
    expect(plan.items[1].folderId).toBeNull(); // 需要新建
    expect(plan.snapshot).toEqual([
      { docId: "doc_a", updatedAt: "t-a" },
      { docId: "doc_b", updatedAt: "t-b" },
    ]);
    expect(plan.folderBaseline).toEqual([{ id: "df_dev", name: "开发指南" }]);
  });

  it("记忆不进候选集，模型硬要归类它也会被最后一道过滤挡掉", async () => {
    const { deps } = harness({
      routes,
      llm: JSON.stringify({
        items: [
          { docId: "doc_memory_dp_default", folderName: "杂项" },
          { docId: "doc_a", folderName: "开发指南" },
        ],
      }),
    });
    const out = await run("doc-folder-organize", {}, deps);
    expect(out.candidateCount).toBe(2);
    expect(out.itemCount).toBe(1);
  });

  it("孤儿文件夹只报告不清理", async () => {
    const { deps, calls } = harness({
      routes,
      llm: JSON.stringify({ items: [{ docId: "doc_a", folderName: "开发指南" }] }),
    });
    const out = await run("doc-folder-organize", {}, deps);

    expect(out.notes.some((n: string) => n.includes("遗留") && n.includes("未做任何处置"))).toBe(true);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(calls.some((c) => c.url === "/api/document-folders" && c.method !== "GET")).toBe(false);
  });

  it("模型编出不存在的 docId 时不进计划", async () => {
    const { deps } = harness({
      routes,
      llm: JSON.stringify({ items: [{ docId: "doc_不存在", folderName: "杂项" }] }),
    });
    await expect(run("doc-folder-organize", {}, deps)).rejects.toThrow(/没有需要调整的归类/);
  });

  it("判定为开发项目时走开发典型结构，且判定与依据写进正文", async () => {
    const { deps, calls } = harness({
      routes,
      llm: JSON.stringify({
        projectType: "dev",
        typeReason: "标题多为构建与部署记录",
        items: [
          { docId: "doc_a", folderName: "设计文档" },
          { docId: "doc_b", folderName: "开发记录" },
        ],
      }),
    });

    const out = await run("doc-folder-organize", {}, deps);

    expect(out.projectType).toBe("dev");
    const body = calls.find((c) => c.method === "POST")!.body.body as string;
    expect(body).toContain("开发项目");
    expect(body).toContain("标题多为构建与部署记录");
    // 典型目录不占「新增」预算，两条都留下了
    expect(out.itemCount).toBe(2);
    expect(out.notes.some((n: string) => n.includes("略去"))).toBe(false);
  });

  it("判定为知识工作项目时走知识典型结构", async () => {
    const { deps, calls } = harness({
      routes,
      llm: JSON.stringify({
        projectType: "knowledge",
        typeReason: "多是资料与成稿",
        items: [
          { docId: "doc_a", folderName: "1_输入原料" },
          { docId: "doc_b", folderName: "2_输出产物" },
        ],
      }),
    });

    const out = await run("doc-folder-organize", {}, deps);
    expect(out.projectType).toBe("knowledge");
    expect(out.itemCount).toBe(2);
    expect(calls.find((c) => c.method === "POST")!.body.body).toContain("知识工作项目");
  });

  it("projectType 非法时回退 knowledge 并记 note", async () => {
    const { deps } = harness({
      routes,
      llm: JSON.stringify({
        projectType: "research",
        items: [{ docId: "doc_a", folderName: "1_输入原料" }],
      }),
    });
    const out = await run("doc-folder-organize", {}, deps);
    expect(out.projectType).toBe("knowledge");
    expect(out.notes.some((n: string) => n.includes("research"))).toBe(true);
  });

  it("清理提议落进独立分节，且计划里没有任何删除语义", async () => {
    const { deps, calls } = harness({
      routes,
      llm: JSON.stringify({
        projectType: "dev",
        typeReason: "开发记录为主",
        items: [{ docId: "doc_a", folderName: "设计文档" }],
        cleanup: [{ docId: "doc_b", reason: "一次性的临时摘录" }],
      }),
    });

    const out = await run("doc-folder-organize", {}, deps);

    expect(out).toMatchObject({ itemCount: 1, cleanupCount: 1 });
    const body = calls.find((c) => c.method === "POST")!.body.body as string;
    expect(body).toContain("## 建议清理");
    expect(body).toContain("不会删除");
    expect(body).toContain("- [x] 《读书摘录》 —— 一次性的临时摘录");
    // 出计划阶段一篇文档都不改
    expect(calls.filter((c) => c.method !== "GET").map((c) => c.url)).toEqual(["/api/documents"]);

    const plan = JSON.parse(calls.find((c) => c.method === "POST")!.body.aiPlan);
    expect(plan.items.map((i: any) => i.kind)).toEqual(["assign-folder", "suggest-cleanup"]);
    expect(plan.snapshot).toEqual([
      { docId: "doc_a", updatedAt: "t-a" },
      { docId: "doc_b", updatedAt: "t-b" },
    ]);
  });

  it("同一篇既提议归类又提议清理时以归类为准", async () => {
    const { deps } = harness({
      routes,
      llm: JSON.stringify({
        projectType: "dev",
        items: [{ docId: "doc_a", folderName: "设计文档" }],
        cleanup: [{ docId: "doc_a", reason: "重复" }],
      }),
    });
    const out = await run("doc-folder-organize", {}, deps);
    expect(out).toMatchObject({ itemCount: 1, cleanupCount: 0 });
  });

  it("已有 8 个文件夹 + 模型提议 7 个新目录 → 新增数满足两条约束，裁剪如实说明", async () => {
    const manyDocs = Array.from({ length: 7 }, (_, i) => ({
      id: `doc_${i}`,
      title: `文档${i}`,
      folderId: null,
      updatedAt: `t-${i}`,
    }));
    const manyFolders = [
      { id: "df_ai_dp_default", name: "AI 空间", projectId: null },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `df_${i}`, name: `既有${i}`, projectId: null })),
    ];
    const { deps, calls } = harness({
      routes: {
        "/api/documents?fields=meta": manyDocs,
        "/api/document-folders": manyFolders,
        "/api/document-projects": [],
      },
      llm: JSON.stringify({
        projectType: "dev",
        typeReason: "x",
        // 7 个都不在典型结构、也不在已有文件夹里
        items: manyDocs.map((d, i) => ({ docId: d.id, folderName: `新目录${i}` })),
      }),
    });

    const out = await run("doc-folder-organize", {}, deps);

    const plan = JSON.parse(calls.find((c) => c.method === "POST")!.body.aiPlan);
    const newFolders = new Set(plan.items.map((i: any) => i.folderName));
    expect(newFolders.size).toBe(2); // 已有 8 个 → 总数上限只放得下 2 个新增
    expect(out.itemCount).toBe(2);
    expect(out.notes.some((n: string) => n.includes("已略去 5 条提议"))).toBe(true);
  });

  it("已有目录数达上限时零新增，只在既有目录内归类", async () => {
    const manyFolders = [
      { id: "df_ai_dp_default", name: "AI 空间", projectId: null },
      ...Array.from({ length: 11 }, (_, i) => ({ id: `df_${i}`, name: `既有${i}`, projectId: null })),
    ];
    const { deps, calls } = harness({
      routes: { ...routes, "/api/document-folders": manyFolders },
      llm: JSON.stringify({
        projectType: "dev",
        items: [
          { docId: "doc_a", folderName: "全新目录" },
          { docId: "doc_b", folderName: "既有3" },
        ],
      }),
    });

    const out = await run("doc-folder-organize", {}, deps);
    const plan = JSON.parse(calls.find((c) => c.method === "POST")!.body.aiPlan);

    expect(plan.items.map((i: any) => i.folderName)).toEqual(["既有3"]);
    expect(plan.items[0].folderId).toBe("df_3"); // 归进既有目录，不新建
    expect(out.notes.some((n: string) => n.includes("已略去 1 条提议"))).toBe(true);
  });
});

describe("annotation-driven-rewrite 端到端", () => {
  const AI_DOC = { id: "doc_ai", title: "转出来的", body: "原文", folderId: null, generatedBy: "m" };
  const ANNOTATIONS = {
    annotations: [
      { id: "anno_1", comment: "这段要更具体", range: { start: 0, end: 2 } },
      { id: "anno_2", comment: "", range: { start: 0, end: 1 } },
    ],
  };

  it("只产出提案，一个字都不落盘", async () => {
    const { deps, calls } = harness({
      routes: { "/api/documents/doc_ai/annotations": ANNOTATIONS, "/api/documents/doc_ai": AI_DOC },
      llm: "# 修订后的全文",
    });

    const out = await run("annotation-driven-rewrite", { docId: "doc_ai" }, deps);

    expect(out).toMatchObject({ docId: "doc_ai", proposedBody: "# 修订后的全文", annotationCount: 1 });
    expect(out.usedAnnotationIds).toEqual(["anno_1"]); // 无评论的批注被排除
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("用户手写文档在调 LLM 之前就被拒绝", async () => {
    let llmCalls = 0;
    const { deps } = harness({
      routes: {
        "/api/documents/doc_user/annotations": ANNOTATIONS,
        "/api/documents/doc_user": { id: "doc_user", title: "我的笔记", body: "x", folderId: "df_1" },
      },
      llm: () => { llmCalls += 1; return "不该被生成"; },
    });

    await expect(run("annotation-driven-rewrite", { docId: "doc_user" }, deps)).rejects.toThrow(/不改它的正文/);
    expect(llmCalls).toBe(0);
  });

  it("没有带评论的批注时明确失败", async () => {
    const { deps } = harness({
      routes: {
        "/api/documents/doc_ai/annotations": { annotations: [] },
        "/api/documents/doc_ai": AI_DOC,
      },
      llm: "x",
    });
    await expect(run("annotation-driven-rewrite", { docId: "doc_ai" }, deps)).rejects.toThrow(/没有带评论的批注/);
  });

  it("可只依据指定的批注", async () => {
    const { deps } = harness({
      routes: {
        "/api/documents/doc_ai/annotations": {
          annotations: [
            { id: "anno_1", comment: "A", range: { start: 0, end: 1 } },
            { id: "anno_2", comment: "B", range: { start: 1, end: 2 } },
          ],
        },
        "/api/documents/doc_ai": AI_DOC,
      },
      llm: "全文",
    });
    const out = await run("annotation-driven-rewrite", { docId: "doc_ai", annotationIds: ["anno_2"] }, deps);
    expect(out.usedAnnotationIds).toEqual(["anno_2"]);
  });
});
