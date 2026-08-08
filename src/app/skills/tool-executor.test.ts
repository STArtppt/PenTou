import { describe, expect, it } from "vitest";
import { createToolExecutor, isToolExecutable } from "./tool-executor";
import type { ExecutableToolCall, SkillDeps } from "../skill-runtime";

/** 记录被打到的 URL，并按路径回放固定负载。 */
function stubDeps(routes: Record<string, unknown>): { deps: SkillDeps; urls: string[] } {
  const urls: string[] = [];
  const deps: SkillDeps = {
    apiBase: "",
    fetchImpl: (async (url: string) => {
      urls.push(url);
      const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      if (!key) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => routes[key] };
    }) as unknown as typeof fetch,
    callLLM: async () => ({ content: "", toolCalls: [] }),
    llmConfig: {} as SkillDeps["llmConfig"],
  };
  return { deps, urls };
}

const call = (name: string, args: Record<string, unknown> = {}): ExecutableToolCall => ({
  id: "c1",
  name,
  arguments: args,
});

describe("工具执行器（客户端打 /api/*）", () => {
  it("search_corpus 打 /api/search 并透传 limit", async () => {
    const { deps, urls } = stubDeps({ "/api/search": { hits: [{ title: "选型" }] } });
    const out = await createToolExecutor()(call("search_corpus", { query: "本地优先", limit: 3 }), deps);

    expect(urls[0]).toContain("/api/search?q=");
    expect(urls[0]).toContain("limit=3");
    expect(out).toEqual({ hits: [{ title: "选型" }] });
  });

  it("list_documents 只取元数据，并能按项目 / 未分类过滤", async () => {
    const docs = [
      { id: "doc_a", title: "A", folderId: null, updatedAt: "t1" },
      { id: "doc_b", title: "B", folderId: "df_1", projectId: "dp_x", updatedAt: "t2", generatedBy: "m" },
    ];
    const { deps, urls } = stubDeps({ "/api/documents": docs });
    const exec = createToolExecutor();

    const all = (await exec(call("list_documents"), deps)) as any;
    expect(urls[0]).toBe("/api/documents?fields=meta");
    expect(all.documents).toHaveLength(2);
    expect(all.documents[0].projectId).toBe("dp_default");
    expect(all.documents[1].aiGenerated).toBe(true);

    const unfiled = (await exec(call("list_documents", { unfiledOnly: true }), deps)) as any;
    expect(unfiled.documents.map((d: any) => d.id)).toEqual(["doc_a"]);

    const scoped = (await exec(call("list_documents", { projectId: "dp_x" }), deps)) as any;
    expect(scoped.documents.map((d: any) => d.id)).toEqual(["doc_b"]);
  });

  it("read_document 按 id 打 /api/documents/:id", async () => {
    const { deps, urls } = stubDeps({ "/api/documents/doc_a": { id: "doc_a", title: "A", body: "正文" } });
    const out = await createToolExecutor()(call("read_document", { docId: "doc_a" }), deps);
    expect(urls[0]).toBe("/api/documents/doc_a");
    expect(out).toEqual({ id: "doc_a", title: "A", body: "正文" });
  });

  it("list_folders 同时取项目与文件夹", async () => {
    const { deps, urls } = stubDeps({
      "/api/document-projects": [{ id: "dp_x", name: "X" }],
      "/api/document-folders": [{ id: "df_1", name: "开发", projectId: "dp_x" }],
    });
    const out = (await createToolExecutor()(call("list_folders"), deps)) as any;
    expect(urls.sort()).toEqual(["/api/document-folders", "/api/document-projects"]);
    expect(out.projects[0].id).toBe("dp_x");
    expect(out.folders[0].name).toBe("开发");
  });

  it("read_current_view 走注入的视图提供者，不打任何端点", async () => {
    const { deps, urls } = stubDeps({});
    const exec = createToolExecutor({
      view: { read: async (section) => ({ kind: "doc", title: "设计稿", text: section ?? "全文" }) },
    });

    expect(await exec(call("read_current_view"), deps)).toEqual({ kind: "doc", title: "设计稿", text: "全文" });
    expect(await exec(call("read_current_view", { section: "取舍" }), deps)).toEqual({
      kind: "doc",
      title: "设计稿",
      text: "取舍",
    });
    expect(urls).toEqual([]);
  });

  it("没有当前视图时明确报错，让模型知道做不到", async () => {
    const { deps } = stubDeps({});
    await expect(createToolExecutor()(call("read_current_view"), deps)).rejects.toThrow("当前没有打开的文档或会话");
  });

  it("目录之外的工具名直接拒绝", async () => {
    const { deps } = stubDeps({});
    await expect(createToolExecutor()(call("drop_database"), deps)).rejects.toThrow("unknown tool");
  });

  it("端点失败时抛出可读错误而不是返回空结果", async () => {
    const { deps } = stubDeps({});
    await expect(createToolExecutor()(call("read_document", { docId: "doc_x" }), deps)).rejects.toThrow(
      "/api/documents/doc_x failed: 404",
    );
  });
});

/** 可写场景：记录每次请求的 method / url / body，便于断言「打到哪个端点、写了什么」。 */
function stubWritableDeps(routes: Record<string, unknown>) {
  const calls: { method: string; url: string; body?: any }[] = [];
  const deps: SkillDeps = {
    apiBase: "",
    fetchImpl: (async (url: string, init?: any) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (method !== "GET") return { ok: true, status: 200, json: async () => ({ ok: true, version: { id: "ver_1" } }) };
      const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      if (!key) return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
      return { ok: true, status: 200, json: async () => routes[key] };
    }) as unknown as typeof fetch,
    callLLM: async () => ({ content: "", toolCalls: [] }),
    llmConfig: { endpoint: "", apiKey: "", model: "deepseek-v4-flash" } as SkillDeps["llmConfig"],
  };
  return { deps, calls };
}

const USER_DOC = { id: "doc_user", title: "我的笔记", folderId: null, updatedAt: "t1" };
const AI_DOC = { id: "doc_ai", title: "转出来的", folderId: null, updatedAt: "t2", generatedBy: "m" };
const FOLDERS = [
  { id: "df_ai_dp_default", name: "AI 空间", projectId: null },
  { id: "df_dev", name: "开发指南", projectId: null },
];

describe("写工具走 /api/* 并受写权限约束", () => {
  it("create_folder 以重读到的表为基底追加，既有条目原样保留", async () => {
    const { deps, calls } = stubWritableDeps({ "/api/document-folders": FOLDERS });
    const out = (await createToolExecutor()(call("create_folder", { name: "读书笔记" }), deps)) as any;

    expect(out.created).toBe(true);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/document-folders");
    expect(post.body.map((f: any) => f.id)).toEqual(["df_ai_dp_default", "df_dev", out.folder.id]);
  });

  it("create_folder 命中同名文件夹时直接复用，不写入", async () => {
    const { deps, calls } = stubWritableDeps({ "/api/document-folders": FOLDERS });
    const out = (await createToolExecutor()(call("create_folder", { name: "开发指南" }), deps)) as any;
    expect(out).toEqual({ folder: FOLDERS[1], created: false });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("assign_folder 对用户手写文档也允许 —— 只动归属，载荷里没有 body", async () => {
    const { deps, calls } = stubWritableDeps({
      "/api/documents/doc_user": USER_DOC,
      "/api/document-folders": FOLDERS,
    });
    await createToolExecutor()(call("assign_folder", { docId: "doc_user", folderId: "df_dev" }), deps);

    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/documents/doc_user");
    expect(put.body).toEqual({ folderId: "df_dev", projectId: null });
    expect("body" in put.body).toBe(false);
  });

  it("assign_folder 拒绝把记忆归类", async () => {
    const { deps } = stubWritableDeps({
      "/api/documents/doc_memory_dp_default": { id: "doc_memory_dp_default", title: "记忆", folderId: "df_ai_dp_default", updatedAt: "t" },
      "/api/document-folders": FOLDERS,
    });
    await expect(
      createToolExecutor()(call("assign_folder", { docId: "doc_memory_dp_default", folderId: "df_dev" }), deps),
    ).rejects.toThrow(/不参与归类/);
  });

  it("write_workspace_doc 落进 AI 空间并带上生成血缘", async () => {
    const { deps, calls } = stubWritableDeps({});
    await createToolExecutor()(call("write_workspace_doc", { title: "主题汇总", body: "# 汇总" }), deps);

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/documents");
    expect(post.body.folderId).toBe("df_ai_dp_default");
    expect(post.body.generatedBy).toBe("deepseek-v4-flash");
  });

  it("write_memory 强制走 commit-version，保证可回滚", async () => {
    const { deps, calls } = stubWritableDeps({
      "/api/documents/doc_memory_dp_default": { id: "doc_memory_dp_default", title: "记忆", folderId: "df_ai_dp_default", updatedAt: "t" },
    });
    const out = (await createToolExecutor()(call("write_memory", { body: "## 偏好\n中文" }), deps)) as any;

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/documents/doc_memory_dp_default/commit-version");
    expect(post.body.type).toBe("llm-rewrite");
    expect(out.versionId).toBe("ver_1");
  });

  it("propose_folder_plan 产出计划文档，排除记忆并如实报告孤儿文件夹", async () => {
    const { deps, calls } = stubWritableDeps({
      "/api/documents?fields=meta": [
        USER_DOC,
        AI_DOC,
        { id: "doc_memory_dp_default", title: "记忆", folderId: "df_ai_dp_default", updatedAt: "t" },
      ],
      "/api/document-folders": [...FOLDERS, { id: "df_orphan", name: "遗留", projectId: "dp_gone" }],
      "/api/document-projects": [],
    });

    const out = (await createToolExecutor({ planTitle: "整理计划" })(
      call("propose_folder_plan", {
        projectId: "dp_default",
        items: [
          { docId: "doc_user", folderName: "开发指南", reason: "讲开发" },
          { docId: "doc_memory_dp_default", folderName: "开发指南" },
        ],
      }),
      deps,
    )) as any;

    expect(out.itemCount).toBe(1); // 记忆被排除
    expect(out.notes.some((n: string) => n.includes("遗留") && n.includes("未做任何处置"))).toBe(true);

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body.folderId).toBe("df_ai_dp_default");
    expect(post.body.body).toContain("- [x] 把《我的笔记》归入「开发指南」");
    const plan = JSON.parse(post.body.aiPlan);
    expect(plan.snapshot).toEqual([{ docId: "doc_user", updatedAt: "t1" }]);
    // 基底不含 AI 空间与别的项目的文件夹
    expect(plan.folderBaseline).toEqual([{ id: "df_dev", name: "开发指南" }]);
  });

  it("目录里根本没有删除类工具，也没有写会话的工具", () => {
    for (const name of ["delete_document", "delete_folder", "update_conversation", "assign_conversation_folder"]) {
      expect(isToolExecutable(name)).toBe(false);
    }
  });
});
