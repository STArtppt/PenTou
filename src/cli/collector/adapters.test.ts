import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClaudeCodeAdapter } from "./adapters/claude-code";
import { createWaylogAdapter, extractWaylogExternalId } from "./adapters/waylog";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("collector adapters", () => {
  it("discovers Claude Code jsonl files and uses filename as externalId", async () => {
    const root = tmpDir("pentou-claude-");
    const project = path.join(root, "proj");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, "abc-123.jsonl"), "{\"type\":\"human\"}\n");
    fs.writeFileSync(path.join(project, "notes.txt"), "ignore");

    const adapter = createClaudeCodeAdapter(root);
    const files = await adapter.discover();
    expect(files.map((file) => file.path)).toEqual([path.join(project, "abc-123.jsonl")]);

    const item = await adapter.toItem(files[0].path);
    expect(item).toMatchObject({
      platform: "claude-code",
      externalId: "abc-123",
      format: "raw",
      filename: "abc-123.jsonl",
    });
  });

  it("discovers waylog markdown under .waylog from parent dirs", async () => {
    const project = tmpDir("pentou-waylog-");
    const root = path.join(project, ".waylog", "sessions");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "chat.md"), "---\nsessionId: sess-9\n---\n\nbody");

    const adapter = createWaylogAdapter([project]);
    const files = await adapter.discover();
    expect(files.map((file) => file.path)).toEqual([path.join(root, "chat.md")]);

    const item = await adapter.toItem(files[0].path);
    expect(item).toMatchObject({
      platform: "waylog",
      externalId: "sess-9",
      format: "raw",
      filename: "chat.md",
    });
  });

  it("extracts waylog externalId from common frontmatter keys", () => {
    expect(extractWaylogExternalId("---\nconversation_id: \"conv-1\"\n---\n")).toBe("conv-1");
    expect(extractWaylogExternalId("---\nid: plain\n---\n")).toBe("plain");
    expect(extractWaylogExternalId("no frontmatter")).toBeUndefined();
  });
});
