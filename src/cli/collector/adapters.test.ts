import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClaudeCodeAdapter } from "./adapters/claude-code";
import { createWaylogAdapter, extractWaylogExternalId } from "./adapters/waylog";
import { createCodexAdapter, extractCodexExternalId } from "./adapters/codex";
import { createGrokCliAdapter } from "./adapters/grok-cli";
import { createCopilotVscodeAdapter } from "./adapters/copilot-vscode";

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

  it("excludes subagent transcripts (subagents/agent-*.jsonl) from discovery and toItem", async () => {
    const root = tmpDir("pentou-claude-");
    const project = path.join(root, "proj");
    const subagents = path.join(project, "session-1", "subagents");
    fs.mkdirSync(subagents, { recursive: true });
    fs.writeFileSync(path.join(project, "main.jsonl"), "{\"type\":\"user\"}\n");
    fs.writeFileSync(path.join(subagents, "agent-abc.jsonl"), "{\"type\":\"user\",\"isSidechain\":true}\n");

    const adapter = createClaudeCodeAdapter(root);
    const files = await adapter.discover();
    expect(files.map((file) => file.path)).toEqual([path.join(project, "main.jsonl")]);
    expect(await adapter.toItem(path.join(subagents, "agent-abc.jsonl"))).toBeNull();
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

  // ── 采集源扩展（spec collector-source-expansion US-01/02/04）─────────────────

  it("codex: discovers rollout-*.jsonl and extracts the session UUID (US-01)", async () => {
    const root = tmpDir("pentou-codex-");
    const day = path.join(root, "2026", "07", "14");
    fs.mkdirSync(day, { recursive: true });
    const file = path.join(day, "rollout-2026-07-14T10-00-00-019f460d-b2a3-7d31-92da-550d46dd2411.jsonl");
    fs.writeFileSync(file, '{"type":"session_meta"}\n');
    fs.writeFileSync(path.join(day, "other.jsonl"), "{}\n"); // 非 rollout 前缀不采

    const adapter = createCodexAdapter(root);
    const files = await adapter.discover();
    expect(files.map((f) => f.path)).toEqual([file]);

    const item = await adapter.toItem(file);
    expect(item).toMatchObject({
      platform: "codex",
      externalId: "019f460d-b2a3-7d31-92da-550d46dd2411",
      format: "raw",
    });
    expect(extractCodexExternalId("rollout-x.jsonl")).toBeUndefined();
  });

  it("grok-cli: only chat_history.jsonl participates; externalId = session dir UUID (US-02)", async () => {
    const root = tmpDir("pentou-grok-");
    const session = path.join(root, "%2Fproj", "019f5e18-174f-71c1-9b24-3d8626bca882");
    fs.mkdirSync(session, { recursive: true });
    fs.writeFileSync(path.join(session, "chat_history.jsonl"), '{"type":"user","content":"hi"}\n');
    fs.writeFileSync(path.join(session, "events.jsonl"), "{}\n");
    fs.writeFileSync(path.join(session, "summary.json"), "{}\n");

    const adapter = createGrokCliAdapter(root);
    const files = await adapter.discover();
    expect(files.map((f) => f.path)).toEqual([path.join(session, "chat_history.jsonl")]);
    expect(await adapter.toItem(path.join(session, "events.jsonl"))).toBeNull();

    const item = await adapter.toItem(files[0].path);
    expect(item).toMatchObject({
      platform: "grok-cli",
      externalId: "019f5e18-174f-71c1-9b24-3d8626bca882",
      format: "raw",
    });
  });

  it("copilot-vscode: skips empty-requests sessions and non-chatSessions json (US-04 AC3)", async () => {
    const root = tmpDir("pentou-vscode-");
    const chatDir = path.join(root, "hash1", "chatSessions");
    fs.mkdirSync(chatDir, { recursive: true });
    const full = path.join(chatDir, "sess-1.json");
    fs.writeFileSync(full, JSON.stringify({ sessionId: "sess-1", requests: [{ message: { text: "q" } }] }));
    const empty = path.join(chatDir, "sess-2.json");
    fs.writeFileSync(empty, JSON.stringify({ sessionId: "sess-2", requests: [] }));
    fs.writeFileSync(path.join(root, "hash1", "workspace.json"), "{}"); // 非 chatSessions 目录

    const adapter = createCopilotVscodeAdapter(root);
    const files = await adapter.discover();
    expect(files.map((f) => f.path).sort()).toEqual([full, empty].sort());

    expect(await adapter.toItem(empty)).toBeNull();
    const item = await adapter.toItem(full);
    expect(item).toMatchObject({ platform: "copilot-vscode", externalId: "sess-1", format: "raw" });
  });
});
