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
      { type: "conversation", id: "c1", title: "选型讨论", snippetText: "本地优先片段" },
      { type: "document", id: "d1", title: "存储设计", snippetText: "落盘方案" },
    ],
  };

  it("汇总落 AI 空间，正文附来源清单，被引用的会话零改动", async () => {
    const { deps, calls } = harness({ routes: { "/api/search": HITS }, llm: "# 检索方案\n\n结论。" });

    const out = await run("topic-digest", { topic: "检索方案" }, deps);

    expect(out).toMatchObject({ topic: "检索方案", sourceCount: 2, folderId: "df_ai_dp_default" });
    expect(out.citations.map((c: any) => c.id)).toEqual(["c1", "d1"]);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body.folderId).toBe("df_ai_dp_default");
    expect(post.body.body).toContain("## 来源");
    expect(post.body.body).toContain("选型讨论（会话）");
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(1); // 只写了那一篇汇总
  });

  it("指定项目时落该项目的 AI 空间", async () => {
    const { deps } = harness({ routes: { "/api/search": HITS }, llm: "# T\n正文" });
    expect((await run("topic-digest", { topic: "T", projectId: "dp_x" }, deps)).folderId).toBe("df_ai_dp_x");
  });

  it("零命中时明确失败，不产出空汇总", async () => {
    const { deps, calls } = harness({ routes: { "/api/search": { hits: [] } }, llm: "" });
    await expect(run("topic-digest", { topic: "不存在的主题" }, deps)).rejects.toThrow(/没有检索到/);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
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
    expect(writes[0].body.body).toContain("- [ ] 把《Vite 配置笔记》归入「开发指南」 —— 讲构建配置");

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
