import { describe, expect, it } from "vitest";
import { mergeDocumentMetaList } from "./data";

// 回归：执行计划后 refreshDocuments(?fields=meta) 把已打开文档 body 冲成空串，
// 主区正文空白，顶部元数据仍在；hydratedDocRef 仍标记已加载，不重拉。
describe("mergeDocumentMetaList", () => {
  const prev = [
    { id: "doc_plan", title: "整理计划", body: "# 待办\n\n- [x] A\n", folderId: null, aiPlanRun: undefined as string | undefined },
    { id: "doc_a", title: "A", body: "full body A", folderId: "df_1" },
    { id: "doc_unopened", title: "U", body: "", folderId: null },
  ];

  it("preserves hydrated body when meta list blanks it out", () => {
    const meta = [
      { id: "doc_plan", title: "整理计划", body: "", folderId: null, aiPlanRun: '{"status":"done"}' },
      { id: "doc_a", title: "A", body: "", folderId: "df_2" },
      { id: "doc_unopened", title: "U", body: "", folderId: null },
    ];
    const next = mergeDocumentMetaList(prev, meta);
    expect(next.find((d) => d.id === "doc_plan")?.body).toBe("# 待办\n\n- [x] A\n");
    expect(next.find((d) => d.id === "doc_a")?.body).toBe("full body A");
  });

  it("applies meta field updates (folder / aiPlanRun) while keeping body", () => {
    const meta = [
      { id: "doc_plan", title: "整理计划", body: "", folderId: null, aiPlanRun: '{"status":"done"}' },
      { id: "doc_a", title: "A renamed", body: "", folderId: "df_new" },
      { id: "doc_unopened", title: "U", body: "", folderId: null },
    ];
    const next = mergeDocumentMetaList(prev, meta);
    const plan = next.find((d) => d.id === "doc_plan")!;
    expect(plan.aiPlanRun).toBe('{"status":"done"}');
    expect(plan.body).toBe("# 待办\n\n- [x] A\n");
    const a = next.find((d) => d.id === "doc_a")!;
    expect(a.folderId).toBe("df_new");
    expect(a.title).toBe("A renamed");
    expect(a.body).toBe("full body A");
  });

  it("keeps meta-only body empty for never-hydrated docs", () => {
    const meta = [{ id: "doc_unopened", title: "U", body: "", folderId: "df_x" }];
    const next = mergeDocumentMetaList(
      [{ id: "doc_unopened", title: "U", body: "", folderId: null as string | null }],
      meta,
    );
    expect(next[0].body).toBe("");
    expect(next[0].folderId).toBe("df_x");
  });

  it("drops docs missing from the meta list (deleted on server)", () => {
    const meta = [{ id: "doc_a", title: "A", body: "", folderId: "df_1" }];
    const next = mergeDocumentMetaList(prev, meta);
    expect(next.map((d) => d.id)).toEqual(["doc_a"]);
  });

  it("includes newly created docs from the meta list", () => {
    const meta = [
      ...prev.map((d) => ({ ...d, body: "" })),
      { id: "doc_new", title: "New", body: "", folderId: null },
    ];
    const next = mergeDocumentMetaList(prev, meta);
    expect(next.find((d) => d.id === "doc_new")).toEqual({
      id: "doc_new",
      title: "New",
      body: "",
      folderId: null,
    });
  });
});
