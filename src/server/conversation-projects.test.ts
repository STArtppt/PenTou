/**
 * conversation-projects.test.ts —— 存量对话按 sourceProject 一次性归集
 * （spec conversation-projects §存量对话按来源项目一次性归集）。
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { conversationToMd } from "./api-router";
import {
  backfillConversationProjects,
  readConversationProjectsMarker,
} from "./conversation-projects";
import { patchConversationProjectFields, readFrontmatter } from "./conversation-folders";
import { setDocsDataDir, ensureDocDirs } from "../../vite-plugins/documentsPlugin";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDataDir(): string {
  const abs = fs.mkdtempSync(path.join(tmpdir(), "pentou-conv-projects-"));
  cleanupDirs.push(abs);
  fs.mkdirSync(path.join(abs, "conversations"), { recursive: true });
  fs.writeFileSync(path.join(abs, "folders.json"), "[]");
  setDocsDataDir(abs);
  ensureDocDirs(abs);
  return abs;
}

function writeConv(dataDir: string, over: Record<string, unknown> = {}) {
  const id = typeof over.id === "string" ? over.id : `conv_${Math.random().toString(36).slice(2, 9)}`;
  const conv = {
    id,
    title: "T",
    platform: "Claude",
    date: "2026-07-01T00:00:00.000Z",
    folderId: null,
    messages: [{ id: "m1", role: "user", content: `hi ${id}`, timestamp: "2026-07-01T00:00:00.000Z" }],
    ...over,
  };
  const md = conversationToMd(conv);
  fs.writeFileSync(path.join(dataDir, "conversations", `${id}.md`), md, "utf-8");
  return { id, md };
}

describe("backfillConversationProjects", () => {
  it("groups 12 conversations that share a sourceProject into one project folder", () => {
    const dataDir = tempDataDir();
    for (let i = 0; i < 12; i++) writeConv(dataDir, { id: `conv_${i}`, sourceProject: "pentou" });
    const result = backfillConversationProjects(dataDir);
    expect(result.skipped).toBe(false);
    expect(result.processed).toBe(12);
    expect(result.projects).toBe(1);

    const projects = JSON.parse(fs.readFileSync(path.join(dataDir, "document-projects.json"), "utf-8"));
    expect(projects).toHaveLength(1);
    expect(projects[0].sourceKey).toBe("pentou");
    const folders = JSON.parse(fs.readFileSync(path.join(dataDir, "folders.json"), "utf-8"));
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ name: "Claude", platform: "Claude", projectId: projects[0].id });

    for (let i = 0; i < 12; i++) {
      const md = fs.readFileSync(path.join(dataDir, "conversations", `conv_${i}.md`), "utf-8");
      const meta = readFrontmatter(md)!;
      expect(meta.projectId).toBe(projects[0].id);
      expect(meta.folderId).toBe(folders[0].id);
      expect(meta.sourceProject).toBe("pentou");
    }
  });

  it("does not rewrite conversations without sourceProject", () => {
    const dataDir = tempDataDir();
    const { md } = writeConv(dataDir, { id: "conv_plain" });
    backfillConversationProjects(dataDir);
    expect(fs.readFileSync(path.join(dataDir, "conversations", "conv_plain.md"), "utf-8")).toBe(md);
  });

  it("is idempotent after the marker is deleted", () => {
    const dataDir = tempDataDir();
    for (let i = 0; i < 3; i++) writeConv(dataDir, { id: `conv_i${i}`, sourceProject: "pentou" });
    const first = backfillConversationProjects(dataDir);
    fs.rmSync(path.join(dataDir, ".migrations"), { recursive: true, force: true });
    const second = backfillConversationProjects(dataDir);
    expect(second.processed).toBe(0);
    expect(second.projects).toBe(0);
    const projects = JSON.parse(fs.readFileSync(path.join(dataDir, "document-projects.json"), "utf-8"));
    expect(projects).toHaveLength(first.projects);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "folders.json"), "utf-8"))).toHaveLength(1);
  });

  it("skips a corrupt file and continues", () => {
    const dataDir = tempDataDir();
    writeConv(dataDir, { id: "conv_ok", sourceProject: "pentou" });
    fs.writeFileSync(path.join(dataDir, "conversations", "conv_bad.md"), "not a conversation", "utf-8");
    const result = backfillConversationProjects(dataDir);
    expect(result.processed).toBe(1);
    expect(fs.readFileSync(path.join(dataDir, "conversations", "conv_bad.md"), "utf-8")).toBe("not a conversation");
    expect(readConversationProjectsMarker(dataDir)?.processed).toBe(1);
  });

  it("only patches projectId and folderId, leaving the rest of the file intact", () => {
    const dataDir = tempDataDir();
    const { md } = writeConv(dataDir, { id: "conv_keep", sourceProject: "docs", favorite: true });
    backfillConversationProjects(dataDir);
    const after = fs.readFileSync(path.join(dataDir, "conversations", "conv_keep.md"), "utf-8");
    expect(after).toContain("sourceProject: docs");
    expect(after).toContain("favorite: true");
    const patched = patchConversationProjectFields(md, {
      projectId: readFrontmatter(after)!.projectId,
      folderId: readFrontmatter(after)!.folderId,
    });
    expect(after).toBe(patched);
  });
});
