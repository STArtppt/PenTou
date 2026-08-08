import { describe, expect, it } from "vitest";
import { runPlanDoc } from "./run-plan";
import { renderPlanBody, serializePlan, type AgentPlan } from "./plan-doc";
import type { SkillDeps } from "../skill-runtime";

const PLAN: AgentPlan = {
  version: 1,
  projectId: "dp_default",
  createdAt: "2026-08-01T00:00:00.000Z",
  items: [
    { kind: "assign-folder", docId: "doc_a", docTitle: "A", folderName: "开发指南", folderId: "df_dev" },
    { kind: "assign-folder", docId: "doc_b", docTitle: "B", folderName: "读书笔记", folderId: null },
  ],
  snapshot: [
    { docId: "doc_a", updatedAt: "t-a" },
    { docId: "doc_b", updatedAt: "t-b" },
  ],
  folderBaseline: [{ id: "df_dev", name: "开发指南" }],
  notes: [],
};

const FOLDERS = [
  { id: "df_ai_dp_default", name: "AI 空间", projectId: null },
  { id: "df_dev", name: "开发指南", projectId: null },
];

function harness(over: { body?: string; aiPlan?: string; docs?: Record<string, any>; folders?: any[] } = {}) {
  const calls: { method: string; url: string; body?: any }[] = [];
  const docs: Record<string, any> = {
    doc_a: { id: "doc_a", updatedAt: "t-a" },
    doc_b: { id: "doc_b", updatedAt: "t-b" },
    ...over.docs,
  };
  const deps: SkillDeps = {
    apiBase: "",
    fetchImpl: (async (url: string, init?: any) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (method !== "GET") return { ok: true, status: 200, text: async () => "", json: async () => ({ ok: true }) };
      if (url === "/api/document-folders") {
        return { ok: true, json: async () => over.folders ?? FOLDERS };
      }
      if (url === "/api/documents/doc_plan") {
        return {
          ok: true,
          json: async () => ({
            id: "doc_plan",
            updatedAt: "t-p",
            body: over.body ?? renderPlanBody(PLAN),
            aiPlan: "aiPlan" in over ? over.aiPlan : serializePlan(PLAN),
          }),
        };
      }
      const id = url.replace("/api/documents/", "");
      if (docs[id]) return { ok: true, json: async () => docs[id] };
      return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
    }) as unknown as typeof fetch,
    callLLM: async () => { throw new Error("执行计划不该调用 LLM"); },
    llmConfig: {} as SkillDeps["llmConfig"],
  };
  return { deps, calls };
}

const allChecked = renderPlanBody(PLAN).replace(/- \[ \]/g, "- [x]");
const firstOnly = renderPlanBody(PLAN).replace("- [ ] 把《A》", "- [x] 把《A》");

describe("执行计划（spec agent-write-policy）", () => {
  it("按勾选执行：补建缺失文件夹（只增），再逐条改归属", async () => {
    const { deps, calls } = harness({ body: allChecked });

    const result = await runPlanDoc(deps, "doc_plan");

    expect(result).toMatchObject({ approved: 2, skipped: 0 });
    expect(result.createdFolders).toHaveLength(1);
    expect(result.createdFolders[0].name).toBe("读书笔记");

    const folderWrite = calls.find((c) => c.url === "/api/document-folders" && c.method === "POST")!;
    // 既有条目（含 AI 空间）原样保留在写回的载荷里
    expect(folderWrite.body.map((f: any) => f.id).slice(0, 2)).toEqual(["df_ai_dp_default", "df_dev"]);
    expect(folderWrite.body).toHaveLength(3);

    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.url)).toEqual(["/api/documents/doc_a", "/api/documents/doc_b"]);
    // 只改归属，正文一个字不动
    for (const put of puts) expect(put.body).not.toHaveProperty("body");
  });

  it("部分批准：只执行勾选的那条", async () => {
    const { deps, calls } = harness({ body: firstOnly });

    const result = await runPlanDoc(deps, "doc_plan");

    expect(result).toMatchObject({ approved: 1, skipped: 1 });
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.url)).toEqual(["/api/documents/doc_a"]);
    expect(calls.some((c) => c.url === "/api/document-folders" && c.method === "POST")).toBe(false);
  });

  it("快照失配时中止，且此前零写入", async () => {
    const { deps, calls } = harness({ body: allChecked, docs: { doc_b: { id: "doc_b", updatedAt: "改过了" } } });

    await expect(runPlanDoc(deps, "doc_plan")).rejects.toThrow(/被改过.*重新生成/s);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("执行期间用户新建了文件夹 → 中止，用户的文件夹不会丢", async () => {
    const { deps, calls } = harness({
      body: allChecked,
      folders: [...FOLDERS, { id: "df_user", name: "用户刚建的", projectId: null }],
    });

    await expect(runPlanDoc(deps, "doc_plan")).rejects.toThrow(/避免覆盖你的改动/);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("用户改写条目文字不影响执行结果", async () => {
    const rewritten = allChecked
      .split("\n")
      .map((line) => (line.startsWith("- [x]") ? "- [x] 我自己写的完全不同的说法" : line))
      .join("\n");
    const { deps, calls } = harness({ body: rewritten });

    await runPlanDoc(deps, "doc_plan");
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.url)).toEqual([
      "/api/documents/doc_a",
      "/api/documents/doc_b",
    ]);
  });

  it("条目被增删导致对不齐时中止", async () => {
    const { deps } = harness({ body: allChecked.split("\n").filter((l) => !l.includes("《B》")).join("\n") });
    await expect(runPlanDoc(deps, "doc_plan")).rejects.toThrow(/无法安全对齐/);
  });

  it("不是计划文档时明确拒绝", async () => {
    const { deps } = harness({ aiPlan: undefined });
    await expect(runPlanDoc(deps, "doc_plan")).rejects.toThrow(/不是可执行的行动计划/);
  });

  it("一条都没勾时零写入", async () => {
    const { deps, calls } = harness({ body: renderPlanBody(PLAN) });
    const result = await runPlanDoc(deps, "doc_plan");
    expect(result).toMatchObject({ approved: 0, skipped: 2 });
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("全程不调用 LLM", async () => {
    const { deps } = harness({ body: allChecked });
    await expect(runPlanDoc(deps, "doc_plan")).resolves.toBeTruthy();
  });
});
