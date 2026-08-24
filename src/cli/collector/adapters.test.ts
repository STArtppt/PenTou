import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClaudeCodeAdapter } from "./adapters/claude-code";
import { createWaylogAdapter, extractWaylogExternalId } from "./adapters/waylog";
import { createCodexAdapter, extractCodexExternalId } from "./adapters/codex";
import { createGrokCliAdapter } from "./adapters/grok-cli";
import { createCopilotVscodeAdapter } from "./adapters/copilot-vscode";
import { createPiAdapter, piExternalId } from "./adapters/pi";

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
    const history = '{"type":"user","content":"hi"}\n';
    fs.writeFileSync(path.join(session, "chat_history.jsonl"), history);
    fs.writeFileSync(path.join(session, "events.jsonl"), "{}\n");
    fs.writeFileSync(
      path.join(session, "summary.json"),
      JSON.stringify({
        created_at: "2026-07-13T03:50:41.719462Z",
        updated_at: "2026-07-13T03:53:14.410275Z",
        generated_title: "Help with bug",
      }),
    );

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
    // 信封携带 summary 时间 + turns，避免 normalizer 用入库时刻兜底
    const envelope = JSON.parse(item!.data as string);
    expect(envelope).toMatchObject({
      schema: "grok-cli-v1",
      history,
      session: {
        created_at: "2026-07-13T03:50:41.719462Z",
        updated_at: "2026-07-13T03:53:14.410275Z",
        title: "Help with bug",
      },
      turns: [],
    });
  });

  it("grok-cli: falls back to first events.jsonl ts when summary has no created_at", async () => {
    const root = tmpDir("pentou-grok-ev-");
    const session = path.join(root, "%2Fproj", "019f5e18-174f-71c1-9b24-3d8626bca883");
    fs.mkdirSync(session, { recursive: true });
    fs.writeFileSync(path.join(session, "chat_history.jsonl"), '{"type":"user","content":"hi"}\n');
    fs.writeFileSync(
      path.join(session, "events.jsonl"),
      [
        JSON.stringify({ type: "mcp_config_resolved", ts: "2026-07-20T00:19:30.100Z" }),
        JSON.stringify({ type: "turn_started", ts: "2026-07-20T00:19:40.692Z", turn_number: 0 }),
        JSON.stringify({ type: "first_token", ts: "2026-07-20T00:19:50.000Z" }),
        JSON.stringify({ type: "turn_ended", ts: "2026-07-20T00:19:55.000Z", outcome: "completed" }),
      ].join("\n"),
    );

    const item = await createGrokCliAdapter(root).toItem(path.join(session, "chat_history.jsonl"));
    const envelope = JSON.parse(item!.data as string);
    expect(envelope.session.created_at).toBe("2026-07-20T00:19:30.100Z");
    expect(envelope.turns).toEqual([{
      turnNumber: 0,
      startedAt: "2026-07-20T00:19:40.692Z",
      firstTokens: ["2026-07-20T00:19:50.000Z"],
      endedAt: "2026-07-20T00:19:55.000Z",
    }]);
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

  it("pi: discovers session jsonl and takes the UUID after the timestamp prefix as externalId", async () => {
    const root = tmpDir("pentou-pi-");
    // ~/.pi/agent/sessions/<编码cwd>/<时间戳>_<uuid>.jsonl
    const project = path.join(root, "--Users-me-proj--");
    fs.mkdirSync(project, { recursive: true });
    const name = "2026-07-27T09-43-03-653Z_019fa2f4-dae5-7c3c-b3fe-905ee8e4baf9.jsonl";
    const raw = '{"type":"session","id":"019fa2f4","timestamp":"2026-07-27T09:43:03.653Z","cwd":"/Users/me/proj"}\n';
    fs.writeFileSync(path.join(project, name), raw);
    fs.writeFileSync(path.join(project, "notes.txt"), "ignore");

    const adapter = createPiAdapter(root);
    const files = await adapter.discover();
    expect(files.map((f) => f.path)).toEqual([path.join(project, name)]);
    expect(await adapter.toItem(path.join(project, "notes.txt"))).toBeNull();

    // 整文件即载荷：会话头已带时间 / cwd，不加信封
    const item = await adapter.toItem(files[0].path);
    expect(item).toMatchObject({
      platform: "pi",
      externalId: "019fa2f4-dae5-7c3c-b3fe-905ee8e4baf9",
      format: "raw",
      data: raw,
      filename: name,
    });
  });

  it("claude-code resolveCwd reads cwd from the jsonl head and never throws", async () => {
    const root = tmpDir("pentou-claude-cwd-");
    const file = path.join(root, "s.jsonl");
    fs.writeFileSync(file, '{"type":"user","cwd":"/Users/x/proj/pentou"}\n{"type":"assistant"}\n');
    const adapter = createClaudeCodeAdapter(root);
    expect(await adapter.resolveCwd?.(file)).toBe("/Users/x/proj/pentou");
    expect(await adapter.resolveCwd?.(path.join(root, "missing.jsonl"))).toBeUndefined();
  });

  it("codex resolveCwd reads session_meta.payload.cwd", async () => {
    const root = tmpDir("pentou-codex-cwd-");
    const file = path.join(root, "rollout-2026-01-01T00-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl");
    fs.writeFileSync(file, '{"type":"session_meta","payload":{"cwd":"/repo"}}\n');
    expect(await createCodexAdapter(root).resolveCwd?.(file)).toBe("/repo");
  });

  it("grok-cli resolveCwd decodes the URI-encoded parent directory", async () => {
    const root = tmpDir("pentou-grok-cwd-");
    const session = path.join(root, encodeURIComponent("/Users/x/proj/pentou"), "uuid");
    fs.mkdirSync(session, { recursive: true });
    const file = path.join(session, "chat_history.jsonl");
    fs.writeFileSync(file, "{}\n");
    expect(await createGrokCliAdapter(root).resolveCwd?.(file)).toBe("/Users/x/proj/pentou");
  });

  it("pi: filename without the timestamp prefix falls back to the whole basename", () => {
    expect(piExternalId("/x/019fa2f4.jsonl")).toBe("019fa2f4");
    // 时间戳前缀里本身带 `-` 不带 `_`，切在首个 `_` 上不会误伤 UUID
    expect(piExternalId("/x/2026-07-27T09-43-03-653Z_abc_def.jsonl")).toBe("abc_def");
  });
});
