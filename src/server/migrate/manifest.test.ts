import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { compareMigrationManifests, createMigrationManifest, isMigrationPathAllowed } from "./manifest";
import { mergeFolderArrays, mergeFolderBundleIntoDataDir, readFolderBundle } from "./merge-folders";
import { receiveMigrationFile } from "./receiver";

let dir = "";

function write(rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, "utf-8");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "pentou-migrate-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("migration manifest", () => {
  it("includes only whitelisted content paths and excludes folders/runtime files", () => {
    write("conversations/conv_1.md", "chat");
    write("conversations/conv_1.versions/v1.md", "version");
    write("documents/doc_1.md", "doc");
    write("documents/doc_1.versions/v1.md", "doc version");
    write("ai-chats/chat_1.md", "ai");
    write("assets/abc.png", "png");
    write("folders.json", "[]");
    write("document-folders.json", "[]");
    write(".qmd/index.db", "index");
    write(".migrate-tmp/task/conversations/tmp.md", "tmp");
    write("ingest/config.json", "{}");

    const paths = createMigrationManifest(dir, "test").entries.map((entry) => entry.path);

    expect(paths).toEqual([
      "ai-chats/chat_1.md",
      "assets/abc.png",
      "conversations/conv_1.md",
      "conversations/conv_1.versions/v1.md",
      "documents/doc_1.md",
      "documents/doc_1.versions/v1.md",
    ]);
  });

  it("rejects traversal, absolute, normalized, and non-whitelisted paths", () => {
    const rejected = [
      "../secret.md",
      "/tmp/secret.md",
      "conversations/../assets/a.png",
      "folders.json",
      "document-folders.json",
      ".qmd/index.db",
      "bin/obscura",
      "ingest/token.json",
    ];
    for (const item of rejected) expect(isMigrationPathAllowed(item), item).toBe(false);
    expect(isMigrationPathAllowed("documents/doc_1.md")).toBe(true);
  });

  it("classifies adds, conflicts, skips, and target-only entries", () => {
    const source = {
      schemaVersion: 1,
      pentouVersion: "s",
      generatedAt: "now",
      entries: [
        { path: "conversations/a.md", hash: "same", size: 1, mtime: 1 },
        { path: "conversations/b.md", hash: "source", size: 2, mtime: 2 },
        { path: "documents/c.md", hash: "new", size: 3, mtime: 3 },
      ],
    };
    const target = {
      schemaVersion: 1,
      pentouVersion: "t",
      generatedAt: "now",
      entries: [
        { path: "conversations/a.md", hash: "same", size: 1, mtime: 1 },
        { path: "conversations/b.md", hash: "target", size: 4, mtime: 4 },
        { path: "assets/only.png", hash: "only", size: 5, mtime: 5 },
      ],
    };

    const plan = compareMigrationManifests(source, target);

    expect(plan.adds).toEqual(["documents/c.md"]);
    expect(plan.skips).toBe(1);
    expect(plan.targetOnly).toBe(1);
    expect(plan.conflicts).toEqual([{
      path: "conversations/b.md",
      sourceHash: "source",
      targetHash: "target",
      sourceMtime: 2,
      targetMtime: 4,
      sourceSize: 2,
      targetSize: 4,
    }]);
  });
});

describe("migration receiver and folders", () => {
  it("writes only allowed paths and verifies hashes before atomic rename", () => {
    const ok = receiveMigrationFile(dir, "task-1", {
      path: "documents/doc_1.md",
      data: Buffer.from("hello"),
      expectedHash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });
    expect(ok.ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, "documents/doc_1.md"), "utf-8")).toBe("hello");

    const badHash = receiveMigrationFile(dir, "task-1", {
      path: "documents/doc_2.md",
      data: Buffer.from("hello"),
      expectedHash: "bad",
    });
    expect(badHash.ok).toBe(false);
    expect(fs.existsSync(path.join(dir, "documents/doc_2.md"))).toBe(false);

    const traversal = receiveMigrationFile(dir, "task-1", {
      path: "../escape.md",
      data: Buffer.from("hello"),
      expectedHash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });
    expect(traversal.ok).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(dir), "escape.md"))).toBe(false);
  });

  it("merges folder arrays by id with source winning conflicts", () => {
    const result = mergeFolderArrays(
      [{ id: "a", name: "source A" }, { id: "c", name: "source C" }],
      [{ id: "a", name: "target A" }, { id: "b", name: "target B" }],
    );
    expect(result).toEqual([
      { id: "a", name: "source A" },
      { id: "b", name: "target B" },
      { id: "c", name: "source C" },
    ]);
  });
});

// 项目清单不在文件清单里（它是顶层 json），只能随文件夹批一起搬。漏搬的后果不是
// "少个分组"，而是文档 frontmatter 的 projectId 指向不存在的项目 → 文档在任何视图下都看不见。
describe("migration folder bundle carries document projects", () => {
  const project = (id: string, sourceKey: string) =>
    ({ id, name: sourceKey, description: "", sourceKey, createdAt: "2026-07-01T00:00:00.000Z" });

  it("reads the project list alongside the two folder lists", () => {
    write("folders.json", JSON.stringify([{ id: "f_1", name: "chat" }]));
    write("document-folders.json", JSON.stringify([{ id: "df_1", name: "guides", projectId: "dp_a" }]));
    write("document-projects.json", JSON.stringify([project("dp_a", "pentou")]));

    expect(readFolderBundle(dir)).toEqual({
      folders: [{ id: "f_1", name: "chat" }],
      documentFolders: [{ id: "df_1", name: "guides", projectId: "dp_a" }],
      documentProjects: [project("dp_a", "pentou")],
    });
  });

  it("merges projects by id so migrated documents keep a project that exists", () => {
    write("document-projects.json", JSON.stringify([project("dp_target", "notes")]));

    const result = mergeFolderBundleIntoDataDir(dir, {
      folders: [],
      documentFolders: [],
      documentProjects: [project("dp_source", "pentou")],
    });

    const merged = JSON.parse(fs.readFileSync(path.join(dir, "document-projects.json"), "utf-8"));
    expect(merged.map((p: any) => p.id).sort()).toEqual(["dp_source", "dp_target"]);
    expect(result.documentProjects).toEqual({ source: 1, result: 2 });
  });

  it("leaves the target's projects untouched when an older peer sends no project list", () => {
    write("document-projects.json", JSON.stringify([project("dp_target", "notes")]));

    const result = mergeFolderBundleIntoDataDir(dir, { folders: [], documentFolders: [] });

    const merged = JSON.parse(fs.readFileSync(path.join(dir, "document-projects.json"), "utf-8"));
    expect(merged).toEqual([project("dp_target", "notes")]);
    expect(result.documentProjects).toEqual({ source: 0, result: 1 });
  });

  it("creates the project list on a target that never had one", () => {
    mergeFolderBundleIntoDataDir(dir, {
      folders: [],
      documentFolders: [],
      documentProjects: [project("dp_source", "pentou")],
    });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "document-projects.json"), "utf-8")))
      .toEqual([project("dp_source", "pentou")]);
  });

  it("keeps the project list out of the file manifest", () => {
    write("document-projects.json", "[]");
    write("documents/doc_1.md", "doc");
    expect(createMigrationManifest(dir, "test").entries.map((e) => e.path)).toEqual(["documents/doc_1.md"]);
    expect(isMigrationPathAllowed("document-projects.json")).toBe(false);
  });
});

