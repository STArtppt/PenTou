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

/** 默认已是全勾选（design D8）；保留这个名字是为了让下面的用例读起来仍是「全部批准」。 */
const allChecked = (plan: AgentPlan) => renderPlanBody(plan);
const noneChecked = (plan: AgentPlan) => renderPlanBody(plan).replace(/- \[x\]/g, "- [ ]");

describe("计划文档格式（design D4 / D8）", () => {
  it("每个待办条目默认以 `- [x]` 开头，异常只在「只报告」区列出", () => {
    const body = renderPlanBody(makePlan());
    expect(readCheckedFlags(body)).toEqual([true, true, true]);
    expect(body).toContain("## 只报告，不处置");
    expect(body).toContain("未做任何处置");
  });

  it("开头说明默认全勾选的语义，避免用户以为要自己逐条勾", () => {
    const body = renderPlanBody(makePlan());
    expect(body).toContain("已默认全部勾选");
    expect(body).toContain("取消勾选");
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

  it("支持部分批准：8 条取消 3 条只执行其余 5 条", () => {
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
    // 默认全勾 → 用户取消最后 3 条
    let seen = 0;
    const body = renderPlanBody(plan)
      .split("\n")
      .map((line) => (line.startsWith("- [x]") && seen++ >= 5 ? line.replace("- [x]", "- [ ]") : line))
      .join("\n");

    const approved = selectApprovedItems(plan, body);
    expect(approved.map((i) => i.docId)).toEqual(["doc_0", "doc_1", "doc_2", "doc_3", "doc_4"]);
  });

  it("默认全勾选时 selectApprovedItems 返回全部条目", () => {
    const plan = makePlan();
    expect(selectApprovedItems(plan, renderPlanBody(plan))).toEqual(plan.items);
  });

  it("旧计划（`- [ ]` 默认未勾选）按其实际状态执行，不受默认态改动影响", () => {
    const plan = makePlan();
    // 模拟默认态改动之前生成、且用户只勾了第二条的旧计划正文
    const legacy = noneChecked(plan).replace("- [ ] 把《B》", "- [x] 把《B》");
    expect(selectApprovedItems(plan, legacy).map((i) => i.docId)).toEqual(["doc_b"]);
    expect(selectApprovedItems(plan, noneChecked(plan))).toEqual([]);
  });

  it("条目被增删导致对不齐时中止，而不是猜", () => {
    const plan = makePlan();
    const truncated = renderPlanBody(plan).split("\n").filter((l) => !l.includes("《C》")).join("\n");
    expect(() => selectApprovedItems(plan, truncated)).toThrow(/无法安全对齐/);
  });
});

describe("建议清理条目（design D7）", () => {
  const withCleanup = (over: Partial<AgentPlan> = {}) =>
    makePlan({
      items: [
        { kind: "assign-folder", docId: "doc_a", docTitle: "A", folderName: "开发指南", folderId: "df_dev" },
        { kind: "suggest-cleanup", docId: "doc_z", docTitle: "Z", reason: "只是一次性的临时记录" },
      ],
      snapshot: [
        { docId: "doc_a", updatedAt: "t-a" },
        { docId: "doc_z", updatedAt: "t-z" },
      ],
      ...over,
    });

  it("清理条目单独成节，节前写明「不会删除」", () => {
    const body = renderPlanBody(withCleanup());
    expect(body).toContain("## 建议清理");
    expect(body).toContain("_待清理");
    expect(body).toContain("不会删除");
    // 归类条目仍在「待办」节
    expect(body.indexOf("## 待办")).toBeLessThan(body.indexOf("## 建议清理"));
  });

  it("没有清理条目时不输出空的清理小节", () => {
    expect(renderPlanBody(makePlan())).not.toContain("## 建议清理");
  });

  it("执行 = 归入 `_待清理`，全程零删除调用", async () => {
    const plan = withCleanup();
    const assigned: { docId: string; folderId: string }[] = [];
    const api = mockApi({
      readDocMeta: async (docId) => ({ updatedAt: docId === "doc_z" ? "t-z" : "t-a" }),
      assignFolder: async (docId, folderId) => { assigned.push({ docId, folderId }); },
    });

    const result = await executePlan(plan, renderPlanBody(plan), api);

    expect(result.cleaned).toBe(1);
    expect(result.createdFolders).toEqual([{ id: "df_new", name: "_待清理" }]);
    expect(assigned).toEqual([
      { docId: "doc_a", folderId: "df_dev" },
      { docId: "doc_z", folderId: "df_new" },
    ]);
    // 执行器的 API 面上根本没有删除能力 —— 这条断言钉住的是这一点
    expect(Object.keys(api)).not.toContain("deleteDocument");
    expect(Object.keys(api)).not.toContain("deleteFolder");
  });

  it("未勾选的清理条目不被执行", async () => {
    const plan = withCleanup();
    const api = mockApi({
      readDocMeta: async () => ({ updatedAt: "t-a" }),
      assignFolder: vi.fn(async () => {}),
    });
    const body = renderPlanBody(plan).replace("- [x] 《Z》", "- [ ] 《Z》");
    const result = await executePlan(plan, body, api);
    expect(result.cleaned).toBe(0);
    expect(result.assigned.map((a) => a.docId)).toEqual(["doc_a"]);
  });

  it("英文界面下清理目录用英文名", () => {
    const body = renderPlanBody(withCleanup({ lang: "en" }));
    expect(body).toContain("_Pending Cleanup");
    expect(body).toContain("nothing is deleted");
  });
});

describe("项目类型判定写入正文（spec project-type-taxonomy）", () => {
  it("写明判定结果与依据", () => {
    const body = renderPlanBody(makePlan({ projectType: "dev", typeReason: "文档标题多为开发记录" }));
    expect(body).toContain("开发项目");
    expect(body).toContain("文档标题多为开发记录");
  });

  it("没有判定结果时不输出该节", () => {
    expect(renderPlanBody(makePlan())).not.toContain("## 项目类型判定");
  });
});

describe("未知 kind 的兼容（design Migration 1）", () => {
  it("parsePlan 跳过不认识的条目而不是抛错", () => {
    const raw = JSON.stringify({
      ...makePlan(),
      items: [
        { kind: "assign-folder", docId: "doc_a", docTitle: "A", folderName: "开发指南" },
        { kind: "rename-folder", folderId: "df_x", newName: "未来才有的条目类型" },
      ],
    });
    const parsed = parsePlan(raw);
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0].kind).toBe("assign-folder");
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

    const result = await executePlan(plan, noneChecked(plan), api);

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
