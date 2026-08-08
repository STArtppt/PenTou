import { describe, expect, it } from "vitest";
import {
  WritePolicyError,
  assertBodyRewrite,
  assertCanAssignFolder,
  assertCanRewriteBody,
  assertNotDeleting,
  assertNotWritingConversation,
  auditFolderAnomalies,
  canRewriteBody,
} from "./agent-write-policy";

const userDoc = { id: "doc_user", title: "我的笔记", folderId: "df_1" };

describe("写权限按出身划（spec agent-write-policy）", () => {
  it("允许改写 AI 生成的文档", () => {
    expect(canRewriteBody({ id: "doc_a", generatedBy: "deepseek" })).toBe(true);
    expect(canRewriteBody({ id: "doc_b", sourceConversationId: "conv_1" })).toBe(true);
    expect(canRewriteBody({ id: "doc_c", sourceAiChatId: "chat_1" })).toBe(true);
  });

  it("允许改写 AI 空间内的一切（含记忆）", () => {
    expect(canRewriteBody({ id: "doc_x", folderId: "df_ai_dp_default" })).toBe(true);
    expect(canRewriteBody({ id: "doc_memory_dp_default", folderId: null })).toBe(true);
  });

  it("拒绝改写用户导入或手写文档的正文，并给出可读原因", () => {
    expect(canRewriteBody(userDoc)).toBe(false);
    expect(() => assertCanRewriteBody(userDoc)).toThrow(WritePolicyError);
    expect(() => assertCanRewriteBody(userDoc)).toThrow(/我的笔记/);
  });

  it("允许时仍强制走 commitVersion，否则视为违规", () => {
    const aiDoc = { id: "doc_a", generatedBy: "m" };
    expect(() => assertBodyRewrite(aiDoc, "/api/documents/doc_a/commit-version")).not.toThrow();
    expect(() => assertBodyRewrite(aiDoc, "/api/documents/doc_a")).toThrow(/回滚/);
  });

  it("拒绝的文档即使走 commitVersion 也不放行", () => {
    expect(() => assertBodyRewrite(userDoc, "/api/documents/doc_user/commit-version")).toThrow(/不改它的正文/);
  });
});

describe("改归属允许、删除与改会话一律拒绝", () => {
  it("给用户文档分配文件夹被允许（只动元数据，不动正文）", () => {
    expect(() => assertCanAssignFolder(userDoc)).not.toThrow();
  });

  it("记忆不参与归类", () => {
    expect(() => assertCanAssignFolder({ id: "doc_memory_dp_default" })).toThrow(/不参与归类/);
  });

  it("删除文档与文件夹都被拒绝，并指向「写进计划由你决定」", () => {
    expect(() => assertNotDeleting("document")).toThrow(/不删除文档/);
    expect(() => assertNotDeleting("folder")).toThrow(/不删除文件夹/);
    expect(() => assertNotDeleting("document")).toThrow(/计划/);
  });

  it("改会话被拒绝，并说明会话按来源平台归类", () => {
    expect(() => assertNotWritingConversation()).toThrow(/来源平台归类/);
  });
});

describe("不一致数据只报告不处置", () => {
  it("孤儿文件夹如实报告，措辞明确「未做处置」", () => {
    const notes = auditFolderAnomalies({
      folders: [{ id: "df_1", name: "旧项目遗留", projectId: "dp_gone" }],
      projectIds: ["dp_alive"],
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("旧项目遗留");
    expect(notes[0]).toContain("未做任何处置");
  });

  it("重名文件夹如实报告，不建议合并", () => {
    const notes = auditFolderAnomalies({
      folders: [
        { id: "df_1", name: "Cursor", projectId: null },
        { id: "df_2", name: "Cursor", projectId: null },
      ],
      projectIds: [],
    });
    expect(notes.some((n) => n.includes("同名文件夹「Cursor」") && n.includes("未做合并"))).toBe(true);
  });

  it("各项目各一个同名 AI 空间是设计如此，不算重名异常", () => {
    const notes = auditFolderAnomalies({
      folders: [
        { id: "df_ai_dp_default", name: "AI 空间", projectId: null },
        { id: "df_ai_dp_x", name: "AI 空间", projectId: "dp_x" },
      ],
      projectIds: ["dp_x"],
    });
    expect(notes).toEqual([]);
  });

  it("数据健康时不产生噪音", () => {
    expect(
      auditFolderAnomalies({
        folders: [{ id: "df_1", name: "开发", projectId: "dp_x" }],
        projectIds: ["dp_x"],
      }),
    ).toEqual([]);
  });
});
