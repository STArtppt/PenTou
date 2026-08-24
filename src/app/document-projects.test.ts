/**
 * document-projects.test.ts —— 项目维度的过滤与两层移动树（spec document-projects）。
 */
import { describe, expect, it } from "vitest";
import {
  buildMoveTargetGroups,
  filterDocumentsByProject,
  filterFoldersByProject,
  moveGroupRowCount,
  resolveMoveProjectId,
  sortDocumentsByTime,
  uncategorizedInProject,
} from "./document-projects";
import { sortByAttention } from "@/shared/attention";
import type { Document, DocumentFolder, DocumentProject } from "./data";

const doc = (id: string, extra: Partial<Document> = {}): Document => ({
  id,
  title: id,
  folderId: null,
  createdAt: "",
  updatedAt: "",
  body: "",
  currentVersionId: "",
  ...extra,
});

const folders: DocumentFolder[] = [
  { id: "df_legacy", name: "存量" },                          // 默认目录（无 projectId）
  { id: "df_guides", name: "指南", projectId: "dp_pentou" },
  { id: "df_notes", name: "笔记", projectId: "dp_other" },
  { id: "df_guides_2", name: "指南", projectId: "dp_other" }, // 同名跨项目：两个独立文件夹
];

const projects: DocumentProject[] = [
  { id: "dp_pentou", name: "笔头文档", description: "/Users/x/pentou/docs", sourceKey: "pentou", createdAt: "" },
  { id: "dp_other", name: "other", description: "", sourceKey: "other", createdAt: "" },
];

describe("project filtering", () => {
  const documents = [
    doc("d_default"),
    doc("d_default_filed", { folderId: "df_legacy" }),
    doc("d_pentou", { projectId: "dp_pentou" }),
    doc("d_pentou_filed", { projectId: "dp_pentou", folderId: "df_guides" }),
    doc("d_other", { projectId: "dp_other" }),
  ];

  it("shows only the selected project's documents", () => {
    expect(filterDocumentsByProject(documents, "dp_pentou").map((d) => d.id))
      .toEqual(["d_pentou", "d_pentou_filed"]);
    expect(filterDocumentsByProject(documents, null).map((d) => d.id))
      .toEqual(["d_default", "d_default_filed"]);
  });

  it("shows only the selected project's folders — same-named folders never merge across projects", () => {
    expect(filterFoldersByProject(folders, "dp_other").map((f) => f.id)).toEqual(["df_notes", "df_guides_2"]);
    expect(filterFoldersByProject(folders, null).map((f) => f.id)).toEqual(["df_legacy"]);
  });

  it("puts folder-less documents in their own project's uncategorized, not the default one", () => {
    expect(uncategorizedInProject(documents, folders, "dp_pentou").map((d) => d.id)).toEqual(["d_pentou"]);
    expect(uncategorizedInProject(documents, folders, null).map((d) => d.id)).toEqual(["d_default"]);
  });

  it("treats a document pointing at a foreign folder as uncategorized (legacy self-heal)", () => {
    const stray = [doc("d_stray", { projectId: "dp_pentou", folderId: "df_notes" })];
    expect(uncategorizedInProject(stray, folders, "dp_pentou").map((d) => d.id)).toEqual(["d_stray"]);
  });
});

describe("two-level move target tree", () => {
  const groups = buildMoveTargetGroups({
    folders,
    projects,
    defaultProjectLabel: "默认目录",
    uncategorizedLabel: "未分类",
  });

  it("lists the default folder first, then every project", () => {
    expect(groups.map((g) => g.label)).toEqual(["默认目录", "笔头文档", "other"]);
    expect(groups.map((g) => g.projectId)).toEqual([null, "dp_pentou", "dp_other"]);
  });

  it("puts uncategorized at the head of each project's targets", () => {
    for (const group of groups) {
      expect(group.targets[0]).toEqual({ id: null, name: "未分类" });
    }
    expect(groups[1].targets.map((tgt) => tgt.id)).toEqual([null, "df_guides"]);
    expect(groups[2].targets.map((tgt) => tgt.id)).toEqual([null, "df_notes", "df_guides_2"]);
  });

  it("counts header rows so the submenu is sized correctly", () => {
    // 3 组标题 + (1+1) + (1+1) + (1+2) 个目标
    expect(moveGroupRowCount(groups)).toBe(3 + 2 + 2 + 3);
    // 对话视图那种无标题的单组不计标题行
    expect(moveGroupRowCount([{ key: "chat", projectId: null, targets: [{ id: null, name: "未分类" }] }])).toBe(1);
  });
});

describe("ownership invariant on move", () => {
  it("takes the project from the destination folder, ignoring anything else", () => {
    expect(resolveMoveProjectId({ folders, folderId: "df_guides", requestedProjectId: "dp_other" }))
      .toBe("dp_pentou");
    expect(resolveMoveProjectId({ folders, folderId: "df_legacy", requestedProjectId: "dp_pentou" }))
      .toBeNull();
  });

  it("uses the requested project when moving into a project's uncategorized", () => {
    expect(resolveMoveProjectId({ folders, folderId: null, requestedProjectId: "dp_other" })).toBe("dp_other");
    expect(resolveMoveProjectId({ folders, folderId: null, requestedProjectId: null })).toBeNull();
  });

  it("keeps the document's current project when none is requested", () => {
    expect(resolveMoveProjectId({ folders, folderId: null, currentProjectId: "dp_pentou" })).toBe("dp_pentou");
  });

  it("never leaves a document in a folder from another project", () => {
    for (const folder of folders) {
      const resolved = resolveMoveProjectId({ folders, folderId: folder.id, requestedProjectId: "dp_bogus" });
      expect(resolved).toBe(folder.projectId ?? null);
    }
  });
});

describe("sorting documents by time", () => {
  const documents = [
    doc("b", { updatedAt: "2026-06-01T00:00:00.000Z" }),
    doc("a", { updatedAt: "2026-05-01T00:00:00.000Z" }),
    doc("c", { updatedAt: "2026-07-01T00:00:00.000Z" }),
  ];

  it("sorts oldest first and newest first without touching the input", () => {
    expect(sortDocumentsByTime(documents, true).map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(sortDocumentsByTime(documents, false).map((d) => d.id)).toEqual(["c", "b", "a"]);
    expect(documents.map((d) => d.id)).toEqual(["b", "a", "c"]);
  });

  it("falls back to createdAt, then to a stable title order", () => {
    const mixed = [
      doc("zeta", { createdAt: "2026-06-01T00:00:00.000Z" }),
      doc("alpha", { createdAt: "2026-06-01T00:00:00.000Z" }),
      doc("older", { createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(sortDocumentsByTime(mixed, true).map((d) => d.id)).toEqual(["older", "alpha", "zeta"]);
  });

  it("does not throw on missing or unparsable timestamps", () => {
    const broken = [doc("later", { updatedAt: "2026-06-01T00:00:00.000Z" }), doc("junk", { updatedAt: "not-a-date" })];
    expect(sortDocumentsByTime(broken, true).map((d) => d.id)).toEqual(["junk", "later"]);
  });
});

/**
 * 收藏优先分组（spec content-favorites）：侧栏把 `sortByAttention` 叠在时间排序**之上**，
 * 各文件夹再按 folderId 过滤。这里验证的是这套组合的性质，而非某个函数单独的行为。
 */
describe("收藏优先分组叠加时间排序", () => {
  const listFor = (docs: Document[], ascending: boolean) =>
    sortByAttention(sortDocumentsByTime(docs, ascending));

  const docs = [
    doc("old-fav", { updatedAt: "2026-05-01T00:00:00.000Z", favorite: true }),
    doc("mid", { updatedAt: "2026-06-01T00:00:00.000Z" }),
    doc("new-fav", { updatedAt: "2026-07-01T00:00:00.000Z", favorite: true }),
    doc("newest", { updatedAt: "2026-08-01T00:00:00.000Z" }),
  ];

  it("收藏整体前置，组内维持时间序", () => {
    expect(listFor(docs, true).map((d) => d.id)).toEqual(["old-fav", "new-fav", "mid", "newest"]);
  });

  it("切换排序方向只反转组内顺序，不打散分组", () => {
    expect(listFor(docs, false).map((d) => d.id)).toEqual(["new-fav", "old-fav", "newest", "mid"]);
  });

  it("同时间以标题稳定兜底的口径在组内依然成立", () => {
    const sameTime = [
      doc("zeta", { updatedAt: "2026-06-01T00:00:00.000Z", favorite: true }),
      doc("alpha", { updatedAt: "2026-06-01T00:00:00.000Z", favorite: true }),
      doc("plain", { updatedAt: "2026-06-01T00:00:00.000Z" }),
    ];
    expect(listFor(sameTime, true).map((d) => d.id)).toEqual(["alpha", "zeta", "plain"]);
  });

  it("不跨文件夹提升：按 folderId 过滤保序，收藏项只浮到本文件夹内部的首位", () => {
    const inFolders = [
      doc("a-plain", { folderId: "df_a", updatedAt: "2026-05-01T00:00:00.000Z" }),
      doc("b-fav", { folderId: "df_b", updatedAt: "2026-06-01T00:00:00.000Z", favorite: true }),
      doc("a-fav", { folderId: "df_a", updatedAt: "2026-07-01T00:00:00.000Z", favorite: true }),
      doc("b-plain", { folderId: "df_b", updatedAt: "2026-08-01T00:00:00.000Z" }),
    ];
    const ordered = listFor(inFolders, true);
    expect(ordered.filter((d) => d.folderId === "df_a").map((d) => d.id)).toEqual(["a-fav", "a-plain"]);
    expect(ordered.filter((d) => d.folderId === "df_b").map((d) => d.id)).toEqual(["b-fav", "b-plain"]);
  });

  it("全未收藏时与纯时间排序逐项一致（缺省行为不变）", () => {
    const plain = [doc("x", { updatedAt: "2026-06-01T00:00:00.000Z" }), doc("y", { updatedAt: "2026-05-01T00:00:00.000Z" })];
    expect(listFor(plain, true).map((d) => d.id)).toEqual(sortDocumentsByTime(plain, true).map((d) => d.id));
  });
});
