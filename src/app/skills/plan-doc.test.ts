import { describe, expect, it, vi } from "vitest";
import {
  assertFolderBaselineIntact,
  assertSnapshotFresh,
  executePlan,
  parsePlan,
  readCheckedFlags,
  renderPlanBody,
  selectApprovedItems,
  serializePlan,
  type AgentPlan,
  type PlanExecutorApi,
} from "./plan-doc";

function makePlan(over: Partial<AgentPlan> = {}): AgentPlan {
  return {
    version: 1,
    projectId: "dp_default",
    createdAt: "2026-08-01T00:00:00.000Z",
    items: [
      { kind: "assign-folder", docId: "doc_a", docTitle: "A", folderName: "开发指南", folderId: "df_dev", reason: "讲开发" },
      { kind: "assign-folder", docId: "doc_b", docTitle: "B", folderName: "读书笔记", folderId: null },
      { kind: "assign-folder", docId: "doc_c", docTitle: "C", folderName: "开发指南", folderId: "df_dev" },
    ],
    snapshot: [
      { docId: "doc_a", updatedAt: "t-a" },
      { docId: "doc_b", updatedAt: "t-b" },
      { docId: "doc_c", updatedAt: "t-c" },
    ],
    folderBaseline: [{ id: "df_dev", name: "开发指南" }],
    notes: ["文件夹「旧」的所属项目 dp_gone 已不存在 —— 只报告，未做任何处置。"],
    ...over,
  };
}

function mockApi(over: Partial<PlanExecutorApi> = {}): PlanExecutorApi & { saved: any[][] } {
  const saved: any[][] = [];
  return {
    saved,
    listFolders: async () => [
      { id: "df_ai_dp_default", name: "AI 空间", projectId: null },
      { id: "df_dev", name: "开发指南", projectId: null },
    ],
    saveFolders: async (folders) => { saved.push(folders as any[]); },
    readDocMeta: async (docId) => ({ updatedAt: `t-${docId.slice(-1)}` }),
    assignFolder: async () => {},
    newFolderId: () => "df_new",
    ...over,
  };
}

const allChecked = (plan: AgentPlan) => renderPlanBody(plan).replace(/- \[ \]/g, "- [x]");

describe("计划文档格式（design D4）", () => {
  it("每个待办条目以 `- [ ]` 开头，异常只在「只报告」区列出", () => {
    const body = renderPlanBody(makePlan());
    expect(readCheckedFlags(body)).toEqual([false, false, false]);
    expect(body).toContain("## 只报告，不处置");
    expect(body).toContain("未做任何处置");
  });

  it("结构化 plan 在 frontmatter 里往返无损", () => {
    const plan = makePlan();
    expect(parsePlan(serializePlan(plan))).toEqual(plan);
    expect(parsePlan(undefined)).toBeNull();
    expect(parsePlan("not json")).toBeNull();
  });

  it("正文里没有可执行的结构：删掉 frontmatter 就无法执行", () => {
    expect(parsePlan(renderPlanBody(makePlan()))).toBeNull();
  });
});

describe("只读复选框、不解析文字", () => {
  it("用户改写条目描述后，执行结果不受影响", async () => {
    const plan = makePlan();
    const rewritten = allChecked(plan)
      .split("\n")
      .map((line) => (line.startsWith("- [x]") ? "- [x] 我自己改的说法，完全不同的文字" : line))
      .join("\n");

    expect(selectApprovedItems(plan, rewritten)).toEqual(plan.items);
  });

  it("支持部分批准：8 条勾 5 条只执行 5 条", () => {
    const plan = makePlan({
      items: Array.from({ length: 8 }, (_, i) => ({
        kind: "assign-folder" as const,
        docId: `doc_${i}`,
        docTitle: `D${i}`,
        folderName: "归档",
        folderId: "df_dev",
      })),
      snapshot: Array.from({ length: 8 }, (_, i) => ({ docId: `doc_${i}`, updatedAt: "t" })),
    });
    const lines = renderPlanBody(plan).split("\n");
    let seen = 0;
    const body = lines
      .map((line) => (line.startsWith("- [ ]") && seen++ < 5 ? line.replace("- [ ]", "- [x]") : line))
      .join("\n");

    const approved = selectApprovedItems(plan, body);
    expect(approved.map((i) => i.docId)).toEqual(["doc_0", "doc_1", "doc_2", "doc_3", "doc_4"]);
  });

  it("条目被增删导致对不齐时中止，而不是猜", () => {
    const plan = makePlan();
    const truncated = renderPlanBody(plan).split("\n").filter((l) => !l.includes("《C》")).join("\n");
    expect(() => selectApprovedItems(plan, truncated)).toThrow(/无法安全对齐/);
  });
});

describe("快照与基底校验", () => {
  it("文档在计划之后被改过 → 中止并提示重新生成", async () => {
    const plan = makePlan();
    const probe = async (docId: string) => ({ updatedAt: docId === "doc_b" ? "改过了" : `t-${docId.slice(-1)}` });
    await expect(assertSnapshotFresh(plan, plan.items, probe)).rejects.toThrow(/被改过.*重新生成/s);
  });

  it("文档已不存在 → 中止", async () => {
    const plan = makePlan();
    await expect(assertSnapshotFresh(plan, plan.items, async () => null)).rejects.toThrow(/已不存在/);
  });

  it("只勾选的条目参与快照校验，未勾选的过期文档不阻断执行", async () => {
    const plan = makePlan();
    const probe = async (docId: string) => ({ updatedAt: docId === "doc_c" ? "过期" : `t-${docId.slice(-1)}` });
    await expect(assertSnapshotFresh(plan, plan.items.slice(0, 2), probe)).resolves.toBeUndefined();
  });

  it("文件夹基底变化 → 中止，绝不静默覆盖", () => {
    const plan = makePlan();
    expect(() => assertFolderBaselineIntact(plan, [{ id: "df_dev", name: "开发指南" }])).not.toThrow();
    expect(() =>
      assertFolderBaselineIntact(plan, [
        { id: "df_dev", name: "开发指南" },
        { id: "df_user_new", name: "用户刚建的" },
      ]),
    ).toThrow(/避免覆盖你的改动/);
    expect(() => assertFolderBaselineIntact(plan, [{ id: "df_dev", name: "被改名了" }])).toThrow(/中止/);
  });
});

describe("executePlan 端到端", () => {
  it("按需新建缺失文件夹（只增），再改归属", async () => {
    const plan = makePlan();
    const assigned: string[] = [];
    const api = mockApi({ assignFolder: async (docId, folderId) => { assigned.push(`${docId}->${folderId}`); } });

    const result = await executePlan(plan, allChecked(plan), api);

    expect(result).toMatchObject({ approved: 3, skipped: 0 });
    expect(result.createdFolders).toEqual([{ id: "df_new", name: "读书笔记" }]);
    expect(assigned).toEqual(["doc_a->df_dev", "doc_b->df_new", "doc_c->df_dev"]);
    // 只增不改删：既有条目原样保留在写回的载荷里
    expect(api.saved[0].map((f: any) => f.id)).toEqual(["df_ai_dp_default", "df_dev", "df_new"]);
  });

  it("未勾选任何条目时零写入", async () => {
    const plan = makePlan();
    const api = mockApi({
      saveFolders: vi.fn(async () => {}),
      assignFolder: vi.fn(async () => {}),
      readDocMeta: vi.fn(async () => ({ updatedAt: "x" })),
    });

    const result = await executePlan(plan, renderPlanBody(plan), api);

    expect(result).toMatchObject({ approved: 0, skipped: 3, createdFolders: [], assigned: [] });
    expect(api.saveFolders).not.toHaveBeenCalled();
    expect(api.assignFolder).not.toHaveBeenCalled();
    expect(api.readDocMeta).not.toHaveBeenCalled();
  });

  it("并发写检测到基底变化时中止，且此前零写入", async () => {
    const plan = makePlan();
    const api = mockApi({
      listFolders: async () => [
        { id: "df_dev", name: "开发指南", projectId: null },
        { id: "df_user", name: "用户在执行期间新建的", projectId: null },
      ],
      saveFolders: vi.fn(async () => {}),
      assignFolder: vi.fn(async () => {}),
    });

    await expect(executePlan(plan, allChecked(plan), api)).rejects.toThrow(/中止/);
    expect(api.saveFolders).not.toHaveBeenCalled();
    expect(api.assignFolder).not.toHaveBeenCalled();
  });

  it("快照失配时中止，且此前零写入", async () => {
    const plan = makePlan();
    const api = mockApi({
      readDocMeta: async () => ({ updatedAt: "全都变了" }),
      saveFolders: vi.fn(async () => {}),
      assignFolder: vi.fn(async () => {}),
    });

    await expect(executePlan(plan, allChecked(plan), api)).rejects.toThrow(/重新生成/);
    expect(api.saveFolders).not.toHaveBeenCalled();
    expect(api.assignFolder).not.toHaveBeenCalled();
  });

  it("基底比对忽略 AI 空间与别的项目的文件夹", async () => {
    const plan = makePlan();
    const api = mockApi({
      listFolders: async () => [
        { id: "df_ai_dp_default", name: "AI 空间", projectId: null },
        { id: "df_dev", name: "开发指南", projectId: null },
        { id: "df_other", name: "别的项目的文件夹", projectId: "dp_x" },
      ],
    });
    await expect(executePlan(plan, allChecked(plan), api)).resolves.toMatchObject({ approved: 3 });
  });
});
