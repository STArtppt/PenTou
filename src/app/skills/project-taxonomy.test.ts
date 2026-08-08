import { describe, expect, it } from "vitest";
import {
  DEV_FOLDERS,
  KNOWLEDGE_FOLDERS,
  enforceFolderBudget,
  isProjectType,
  typicalFoldersFor,
} from "./project-taxonomy";

const p = (folderName: string, docId = folderName) => ({ folderName, docId });

describe("典型目录结构", () => {
  it("按类型取对应的一套", () => {
    expect(typicalFoldersFor("dev")).toBe(DEV_FOLDERS);
    expect(typicalFoldersFor("knowledge")).toBe(KNOWLEDGE_FOLDERS);
  });

  it("用规范写法而非来源截图的笔误", () => {
    expect(DEV_FOLDERS).toContain("部署运维");
    expect(DEV_FOLDERS).toContain("常见问题");
    expect(DEV_FOLDERS).not.toContain("布署运维");
    expect(DEV_FOLDERS).not.toContain("常识问题");
  });

  it("只认两种类型", () => {
    expect(isProjectType("dev")).toBe(true);
    expect(isProjectType("knowledge")).toBe(true);
    expect(isProjectType("research")).toBe(false);
    expect(isProjectType(undefined)).toBe(false);
  });
});

describe("enforceFolderBudget", () => {
  it("典型结构与已有文件夹内的提议全部放行", () => {
    const r = enforceFolderBudget(
      [p("设计文档", "d1"), p("开发记录", "d2"), p("我自己的收藏", "d3")],
      ["我自己的收藏"],
      DEV_FOLDERS,
    );
    expect(r.kept).toHaveLength(3);
    expect(r.dropped).toHaveLength(0);
    expect(r.note).toBeNull();
  });

  it("新增超 3 个时按承载文档数降序保留前 3 个", () => {
    const proposals = [
      p("甲", "d1"), p("甲", "d2"), p("甲", "d3"),
      p("乙", "d4"), p("乙", "d5"),
      p("丙", "d6"), p("丙", "d7"),
      p("丁", "d8"),
      p("戊", "d9"),
    ];
    const r = enforceFolderBudget(proposals, [], KNOWLEDGE_FOLDERS);
    expect(new Set(r.kept.map((x) => x.folderName))).toEqual(new Set(["甲", "乙", "丙"]));
    expect(r.droppedFolders).toEqual(["丁", "戊"]);
    expect(r.dropped.map((x) => x.docId)).toEqual(["d8", "d9"]);
    expect(r.note).toContain("已略去 2 条提议");
  });

  it("被裁目录的条目整条丢弃，不改塞进别的目录", () => {
    const r = enforceFolderBudget(
      [p("甲", "d1"), p("甲", "d2"), p("乙", "d3"), p("丙", "d4"), p("丁", "d5")],
      [],
      [],
    );
    expect(r.dropped).toEqual([p("丁", "d5")]);
    // 丢弃即丢弃：kept 里不存在被改写 folderName 的条目
    expect(r.kept.every((x) => ["甲", "乙", "丙"].includes(x.folderName))).toBe(true);
  });

  it("已有 8 个文件夹 + 提议 3 个新目录 → 只留 2 个（总数上限 10）", () => {
    const existing = ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"];
    const proposals = [
      p("甲", "d1"), p("甲", "d2"), p("甲", "d3"),
      p("乙", "d4"), p("乙", "d5"),
      p("丙", "d6"),
    ];
    const r = enforceFolderBudget(proposals, existing, []);
    expect(new Set(r.kept.map((x) => x.folderName))).toEqual(new Set(["甲", "乙"]));
    expect(r.droppedFolders).toEqual(["丙"]);
  });

  it("已有 11 个文件夹时零新增，但既有目录内的归类照常", () => {
    const existing = Array.from({ length: 11 }, (_, i) => `f${i}`);
    const r = enforceFolderBudget([p("甲", "d1"), p("f3", "d2")], existing, []);
    expect(r.kept).toEqual([p("f3", "d2")]);
    expect(r.droppedFolders).toEqual(["甲"]);
    expect(r.note).toContain("已略去 1 条提议");
  });

  it("典型结构目录不计入「新增」预算", () => {
    // 7 个开发典型目录 + 3 个真正的新目录：典型的不占预算，三个新的全留
    const proposals = [
      ...DEV_FOLDERS.map((name, i) => p(name, `t${i}`)),
      p("甲", "d1"), p("乙", "d2"), p("丙", "d3"),
    ];
    const r = enforceFolderBudget(proposals, [], DEV_FOLDERS);
    expect(r.dropped).toHaveLength(0);
  });
});
