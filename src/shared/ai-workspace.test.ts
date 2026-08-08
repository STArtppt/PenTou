import { describe, expect, it } from "vitest";
import {
  aiWorkspaceFolder,
  aiWorkspaceFolderId,
  isAiWorkspaceFolderId,
  isMemoryDocId,
  isOrganizeCandidate,
  memoryDocId,
  sortAiWorkspaceFirst,
  sortMemoryFirst,
} from "./ai-workspace";

describe("AI 空间与记忆的身份约定", () => {
  it("id 由项目确定性推导，默认目录与项目各不相同", () => {
    expect(aiWorkspaceFolderId(null)).toBe("df_ai_dp_default");
    expect(aiWorkspaceFolderId(undefined)).toBe("df_ai_dp_default");
    expect(aiWorkspaceFolderId("dp_x")).toBe("df_ai_dp_x");
    expect(memoryDocId(null)).toBe("doc_memory_dp_default");
    expect(memoryDocId("dp_x")).toBe("doc_memory_dp_x");
  });

  it("记忆 id 满足文档 id 的合法形状（否则路由会拒绝它）", () => {
    expect(memoryDocId("dp_1770000000_ab12")).toMatch(/^doc_[a-zA-Z0-9_]+$/);
  });

  it("识别函数不误伤普通 id", () => {
    expect(isAiWorkspaceFolderId("df_ai_dp_x")).toBe(true);
    expect(isAiWorkspaceFolderId("df_1")).toBe(false);
    expect(isAiWorkspaceFolderId(null)).toBe(false);
    expect(isMemoryDocId("doc_memory_dp_default")).toBe(true);
    expect(isMemoryDocId("doc_abc")).toBe(false);
  });

  it("aiWorkspaceFolder 带上正确的项目归属", () => {
    expect(aiWorkspaceFolder(null)).toEqual({ id: "df_ai_dp_default", name: "AI 空间", projectId: null });
    expect(aiWorkspaceFolder("dp_x").projectId).toBe("dp_x");
  });
});

describe("排序：AI 空间置顶、记忆置顶", () => {
  it("AI 空间排到首位，其余相对顺序不变，原数组不被修改", () => {
    const input = [{ id: "df_1" }, { id: "df_ai_dp_default" }, { id: "df_2" }];
    expect(sortAiWorkspaceFirst(input).map((f) => f.id)).toEqual(["df_ai_dp_default", "df_1", "df_2"]);
    expect(input.map((f) => f.id)).toEqual(["df_1", "df_ai_dp_default", "df_2"]);
  });

  it("记忆排到 AI 空间首位", () => {
    const input = [{ id: "doc_a" }, { id: "doc_memory_dp_default" }, { id: "doc_b" }];
    expect(sortMemoryFirst(input).map((d) => d.id)).toEqual(["doc_memory_dp_default", "doc_a", "doc_b"]);
  });
});

describe("整理候选集（记忆参与检索、不参与整理）", () => {
  it("记忆与 AI 空间内的文档都不是归类候选", () => {
    expect(isOrganizeCandidate({ id: "doc_memory_dp_default", folderId: "df_ai_dp_default" })).toBe(false);
    expect(isOrganizeCandidate({ id: "doc_plan_1", folderId: "df_ai_dp_default" })).toBe(false);
  });

  it("用户的普通文档是候选，无论是否已分类", () => {
    expect(isOrganizeCandidate({ id: "doc_a", folderId: null })).toBe(true);
    expect(isOrganizeCandidate({ id: "doc_a", folderId: "df_1" })).toBe(true);
  });
});
