import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  resolveInitialConversationId,
  resolveInitialDocumentId,
  resolveInitialProjectId,
} from "./data";

// 回归：src/docs/debugging/2026-07-16-refresh-opens-oldest-conversation.md
// 刷新后应恢复上次打开的会话，而不是永远选 readdir 字母序第一条。
describe("initial conversation selection", () => {
  const convs = [{ id: "conv_a" }, { id: "conv_b" }, { id: "conv_c" }];

  it("restores the stored conversation when it still exists", () => {
    expect(resolveInitialConversationId(convs, "conv_b")).toBe("conv_b");
  });

  it("falls back to the first conversation when the stored id is stale", () => {
    expect(resolveInitialConversationId(convs, "conv_deleted")).toBe("conv_a");
  });

  it("falls back to the first conversation when nothing is stored", () => {
    expect(resolveInitialConversationId(convs, null)).toBe("conv_a");
  });

  it("returns null when there are no conversations", () => {
    expect(resolveInitialConversationId([], "conv_b")).toBeNull();
  });

  it("persists the active conversation id across reloads via localStorage", () => {
    const data = readFileSync("src/app/data.tsx", "utf8");
    expect(data).toContain('localStorage.setItem("pentou-active-conversation"');
    expect(data).toContain('localStorage.removeItem("pentou-active-conversation")');
    expect(data).toContain("resolveInitialConversationId(convs");
  });
});

// 文档页刷新后应停留在上次选中的项目目录，而非总是默认目录。
describe("initial document project selection", () => {
  const projects = [{ id: "dp_pentou" }, { id: "dp_other" }];

  it("restores the stored project when it still exists", () => {
    expect(resolveInitialProjectId(projects, "dp_pentou")).toBe("dp_pentou");
  });

  it("falls back to the default directory when the stored id is stale", () => {
    expect(resolveInitialProjectId(projects, "dp_deleted")).toBeNull();
  });

  it("falls back to the default directory when nothing is stored", () => {
    expect(resolveInitialProjectId(projects, null)).toBeNull();
  });

  it("returns null when there are no projects", () => {
    expect(resolveInitialProjectId([], "dp_pentou")).toBeNull();
  });

  it("persists the active project id across reloads via localStorage", () => {
    const data = readFileSync("src/app/data.tsx", "utf8");
    expect(data).toContain('localStorage.setItem("pentou-active-project"');
    expect(data).toContain('localStorage.removeItem("pentou-active-project")');
    expect(data).toContain("resolveInitialProjectId(projects");
  });
});

// 文档页刷新后应恢复上次打开的文档，而不是变成未选中。
describe("initial document selection", () => {
  const docs = [{ id: "doc_a" }, { id: "doc_b" }, { id: "doc_c" }];

  it("restores the stored document when it still exists", () => {
    expect(resolveInitialDocumentId(docs, "doc_b")).toBe("doc_b");
  });

  it("falls back to unselected when the stored id is stale", () => {
    expect(resolveInitialDocumentId(docs, "doc_deleted")).toBeNull();
  });

  it("falls back to unselected when nothing is stored", () => {
    expect(resolveInitialDocumentId(docs, null)).toBeNull();
  });

  it("returns null when there are no documents", () => {
    expect(resolveInitialDocumentId([], "doc_b")).toBeNull();
  });

  it("persists the active document id across reloads via localStorage", () => {
    const data = readFileSync("src/app/data.tsx", "utf8");
    expect(data).toContain('localStorage.setItem("pentou-active-document"');
    expect(data).toContain('localStorage.removeItem("pentou-active-document")');
    expect(data).toContain("resolveInitialDocumentId(docs");
  });
});
