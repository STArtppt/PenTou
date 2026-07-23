import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { compareMigrationManifests, createMigrationManifest, isMigrationPathAllowed } from "./manifest";
import { mergeFolderArrays } from "./merge-folders";
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

