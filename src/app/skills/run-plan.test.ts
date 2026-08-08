import { describe, expect, it } from "vitest";
import { runPlanDoc } from "./run-plan";
import { parsePlanRun, renderPlanBody, serializePlan, type AgentPlan } from "./plan-doc";
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

function harness(
  over: {
    body?: string;
    aiPlan?: string;
    docs?: Record<string, any>;
    folders?: any[];
    /** 写入阶段的故障注入：命中的写请求直接失败（覆盖 partial 终态，实机难复现）。 */
    failWrite?: (call: { method: string; url: string }) => boolean;
  } = {},
) {
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
      if (method !== "GET") {
        if (over.failWrite?.({ method, url })) {
          return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) };
        }
        return { ok: true, status: 200, text: async () => "", json: async () => ({ ok: true }) };
      }
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

// 条目默认全部勾选（design D8）：取消勾选才是「不采纳」
const allChecked = renderPlanBody(PLAN);
const firstOnly = allChecked.replace("- [x] 把《B》", "- [ ] 把《B》");
const noneChecked = allChecked.replace(/- \[x\]/g, "- [ ]");

/** 回写终态的那次 PUT（spec plan-run-status），与「改目标文档归属」的 PUT 区分开。 */
const runWriteback = (calls: { method: string; url: string; body?: any }[]) =>
  calls.find((c) => c.method === "PUT" && c.url === "/api/documents/doc_plan");
const targetPuts = (calls: { method: string; url: string }[]) =>
  calls.filter((c) => c.method === "PUT" && c.url !== "/api/documents/doc_plan").map((c) => c.url);

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

    expect(targetPuts(calls)).toEqual(["/api/documents/doc_a", "/api/documents/doc_b"]);
    // 只改归属，正文一个字不动（回写终态的那次同样不带 body）
    for (const put of calls.filter((c) => c.method === "PUT")) expect(put.body).not.toHaveProperty("body");
  });

  it("部分批准：只执行勾选的那条", async () => {
    const { deps, calls } = harness({ body: firstOnly });

    const result = await runPlanDoc(deps, "doc_plan");

    expect(result).toMatchObject({ approved: 1, skipped: 1 });
    expect(targetPuts(calls)).toEqual(["/api/documents/doc_a"]);
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
    expect(targetPuts(calls)).toEqual(["/api/documents/doc_a", "/api/documents/doc_b"]);
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
    const { deps, calls } = harness({ body: noneChecked });
    const result = await runPlanDoc(deps, "doc_plan");
    expect(result).toMatchObject({ approved: 0, skipped: 2 });
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("全程不调用 LLM", async () => {
    const { deps } = harness({ body: allChecked });
    await expect(runPlanDoc(deps, "doc_plan")).resolves.toBeTruthy();
  });
});

describe("执行终态回写 aiPlanRun（spec plan-run-status）", () => {
  it("执行完把 done 终态写回计划文档自身，且不带 body（不建版本）", async () => {
    const { deps, calls } = harness({ body: allChecked });

    await runPlanDoc(deps, "doc_plan", "ai_sess_1");

    const put = runWriteback(calls)!;
    expect(put).toBeTruthy();
    // 载荷只有 aiPlanRun：带 body 就会进建版本分支，把执行变成一次「编辑」
    expect(Object.keys(put.body)).toEqual(["aiPlanRun"]);
    const run = parsePlanRun(put.body.aiPlanRun)!;
    expect(run).toMatchObject({ status: "done", approved: 2, skipped: 0, cleaned: 0, sessionId: "ai_sess_1" });
    expect(run.assigned.map((a) => a.docId)).toEqual(["doc_a", "doc_b"]);
    expect(run.createdFolders.map((f) => f.name)).toEqual(["读书笔记"]);
    expect(Date.parse(run.ranAt)).not.toBeNaN();
  });

  it("回写发生在所有归属改完之后 —— 终态清单不会漏记最后一条", async () => {
    const { deps, calls } = harness({ body: allChecked });
    await runPlanDoc(deps, "doc_plan");
    const puts = calls.filter((c) => c.method === "PUT").map((c) => c.url);
    expect(puts.at(-1)).toBe("/api/documents/doc_plan");
  });

  it("没传 sessionId 时终态里就没有 sessionId 键（状态条据此不渲染跳转入口）", async () => {
    const { deps, calls } = harness({ body: allChecked });
    await runPlanDoc(deps, "doc_plan");
    expect(parsePlanRun(runWriteback(calls)!.body.aiPlanRun)).not.toHaveProperty("sessionId");
  });

  it("写入中途失败：记 partial 且只含实际已完成的部分，原错误照旧冒泡", async () => {
    // 第二条归属写入失败：文件夹已建、doc_a 已改，doc_b 没改
    const { deps, calls } = harness({
      body: allChecked,
      failWrite: ({ method, url }) => method === "PUT" && url === "/api/documents/doc_b",
    });

    await expect(runPlanDoc(deps, "doc_plan", "ai_sess_2")).rejects.toThrow(/doc_b failed: 500/);

    const run = parsePlanRun(runWriteback(calls)!.body.aiPlanRun)!;
    expect(run.status).toBe("partial");
    expect(run.assigned.map((a) => a.docId)).toEqual(["doc_a"]);
    expect(run.createdFolders).toHaveLength(1);
    expect(run.sessionId).toBe("ai_sess_2");
    // 中断原因随终态存下：run 会话可被删，不存就再也查不到为什么断的（design D8）
    expect(run.error).toMatch(/doc_b failed: 500/);
  });

  it("done 终态不带 error —— 没断就没有原因可记", async () => {
    const { deps, calls } = harness({ body: allChecked });
    await runPlanDoc(deps, "doc_plan");
    expect(parsePlanRun(runWriteback(calls)!.body.aiPlanRun)).not.toHaveProperty("error");
  });

  it("校验阶段失败（快照失配）不留终态 —— 零改动就是未执行", async () => {
    const { deps, calls } = harness({ body: allChecked, docs: { doc_b: { id: "doc_b", updatedAt: "改过了" } } });
    await expect(runPlanDoc(deps, "doc_plan")).rejects.toThrow(/被改过/);
    expect(runWriteback(calls)).toBeUndefined();
  });

  it("文件夹基底变动不留终态", async () => {
    const { deps, calls } = harness({
      body: allChecked,
      folders: [...FOLDERS, { id: "df_user", name: "用户刚建的", projectId: null }],
    });
    await expect(runPlanDoc(deps, "doc_plan")).rejects.toThrow(/避免覆盖你的改动/);
    expect(runWriteback(calls)).toBeUndefined();
  });

  it("一条都没勾时不留终态 —— 没产生任何改动", async () => {
    const { deps, calls } = harness({ body: noneChecked });
    await runPlanDoc(deps, "doc_plan");
    expect(runWriteback(calls)).toBeUndefined();
  });

  it("回写失败时明说「跑完了但没记上」，不让它读起来像执行失败", async () => {
    const { deps } = harness({
      body: allChecked,
      failWrite: ({ method, url }) => method === "PUT" && url === "/api/documents/doc_plan",
    });
    await expect(runPlanDoc(deps, "doc_plan")).rejects.toThrow(/已执行完毕.*改动已经生效/s);
  });
});
