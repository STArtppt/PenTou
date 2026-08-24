import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClaudeCodeAdapter } from "./adapters/claude-code";
import { createDocsAdapter } from "./adapters/docs";
import { CollectorWatchEngine, backoffDelay, createExcludeMatcher, degradeOversizeItem, lookupGitProject, pullOnce, snapshotChanged, type GitProjectCache } from "./engine";
import { makeCollectorConfig } from "./test-fixtures";
import type { IngestItem, IngestResponse } from "./types";
import { IngestHttpError } from "./ingest-client";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJsonl(file: string, text = "{\"type\":\"human\"}\n"): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

class FakeClient {
  calls: IngestItem[][] = [];
  responses: IngestResponse[] = [];
  errors: Error[] = [];

  async ingest(items: IngestItem[]): Promise<IngestResponse> {
    this.calls.push(items);
    const error = this.errors.shift();
    if (error) throw error;
    return this.responses.shift() ?? {
      ok: true,
      results: items.map((_item, itemIndex) => ({
        itemIndex,
        conversations: [{ action: "created", id: `conv_${itemIndex}` }],
      })),
    };
  }
}

describe("collector engine", () => {
  it("detects snapshot changes by mtime or size", () => {
    expect(snapshotChanged(undefined, { mtimeMs: 1, size: 1 })).toBe(true);
    expect(snapshotChanged({ mtimeMs: 1, size: 1 }, { mtimeMs: 1, size: 1 })).toBe(false);
    expect(snapshotChanged({ mtimeMs: 1, size: 1 }, { mtimeMs: 2, size: 1 })).toBe(true);
    expect(snapshotChanged({ mtimeMs: 1, size: 1 }, { mtimeMs: 1, size: 2 })).toBe(true);
  });

  it("matches simple exclude glob patterns", () => {
    const match = createExcludeMatcher(["**/secret/**", "private-project/**", "*.secret.jsonl", "~/private/**"], "/Users/me");
    expect(match("/tmp/a/secret/chat.jsonl")).toBe("**/secret/**");
    expect(match("/tmp/private-project/chat.jsonl")).toBe("private-project/**");
    expect(match("/tmp/private-project/nested/chat.jsonl")).toBe("private-project/**");
    expect(match("/tmp/a/token.secret.jsonl")).toBe("*.secret.jsonl");
    expect(match("/Users/me/private/chat.jsonl")).toBe("~/private/**");
    expect(match("/tmp/public/chat.jsonl")).toBeNull();
  });

  it("expands ~ from os.homedir(), not process.env.HOME (Windows has no HOME)", () => {
    const home = os.homedir();
    const original = process.env.HOME;
    delete process.env.HOME;
    try {
      const match = createExcludeMatcher(["~/private/**"]);
      expect(match(path.join(home, "private", "chat.jsonl"))).toBe("~/private/**");
      expect(match(path.join(home, "public", "chat.jsonl"))).toBeNull();
    } finally {
      if (original === undefined) delete process.env.HOME;
      else process.env.HOME = original;
    }
  });

  it("does not treat plain exclude text as unsafe substring matching", () => {
    const match = createExcludeMatcher(["test"]);
    expect(match("/tmp/my-latest-app/chat.jsonl")).toBeNull();
    expect(match("/tmp/test/chat.jsonl")).toBe("test");
  });

  it("pull uploads all discovered files and accumulates conversation actions", async () => {
    const root = tmpDir("pentou-pull-");
    writeJsonl(path.join(root, "a.jsonl"));
    writeJsonl(path.join(root, "b.jsonl"));
    const config = makeCollectorConfig({
      server: "http://x",
      token: "t",
      adapters: { "claude-code": { enabled: true, root }, waylog: { enabled: false, dirs: [] } },
    });
    const client = new FakeClient();
    client.responses.push({
      ok: true,
      results: [
        { itemIndex: 0, conversations: [{ action: "created", id: "conv_a" }] },
        { itemIndex: 1, conversations: [{ action: "merged", id: "conv_b" }, { action: "skipped", id: "conv_c" }] },
      ],
    });

    const summary = await pullOnce(config, [createClaudeCodeAdapter(root)], { client: client as any });
    expect(summary.scanned).toBe(2);
    expect(summary.sent).toBe(2);
    expect(summary.counts).toEqual({ created: 1, merged: 1, skipped: 1, error: 0 });
    expect(Object.keys(config.snapshots)).toHaveLength(2);
  });

  it("pull reports per-item errors and continues other files", async () => {
    const root = tmpDir("pentou-pull-error-");
    writeJsonl(path.join(root, "a.jsonl"));
    writeJsonl(path.join(root, "b.jsonl"));
    const config = makeCollectorConfig({
      server: "http://x",
      token: "t",
      adapters: { "claude-code": { enabled: true, root }, waylog: { enabled: false, dirs: [] } },
    });
    const client = new FakeClient();
    client.responses.push({
      ok: true,
      results: [
        { itemIndex: 0, conversations: [], error: "unrecognized format" },
        { itemIndex: 1, conversations: [{ action: "created", id: "conv_b" }] },
      ],
    });

    const summary = await pullOnce(config, [createClaudeCodeAdapter(root)], { client: client as any });
    expect(summary.counts).toEqual({ created: 1, merged: 0, skipped: 0, error: 1 });
    expect(summary.errors[0].error).toBe("unrecognized format");
  });

  it("pull counts server-reported empty sessions as skipped, not error", async () => {
    const root = tmpDir("pentou-pull-empty-");
    writeJsonl(path.join(root, "a.jsonl"));
    const config = makeCollectorConfig({
      server: "http://x",
      token: "t",
      adapters: { "claude-code": { enabled: true, root }, waylog: { enabled: false, dirs: [] } },
    });
    const client = new FakeClient();
    client.responses.push({
      ok: true,
      results: [{ itemIndex: 0, conversations: [], skippedReason: "no conversations parsed" }],
    });

    const summary = await pullOnce(config, [createClaudeCodeAdapter(root)], { client: client as any });
    expect(summary.counts).toEqual({ created: 0, merged: 0, skipped: 1, error: 0 });
    expect(summary.errors).toEqual([]);
    // 空会话推进快照：watch 模式下文件不变化就不再重传
    expect(Object.keys(config.snapshots)).toHaveLength(1);
  });

  it("pull degrades oversize raw files to locally parsed conversation items (spec US-01)", async () => {
    const root = tmpDir("pentou-pull-oversize-");
    writeJsonl(path.join(root, "a.jsonl"), "small-a");
    // 真实形态：对话文本很小，超限来自会被解析丢弃的 bulk 行（tool_result 等）
    const bulk = JSON.stringify({ type: "tool_result", blob: "x".repeat(11 * 1024 * 1024) });
    writeJsonl(
      path.join(root, "big.jsonl"),
      '{"type":"user","message":{"role":"user","content":"hello big"},"timestamp":"2026-07-01T00:00:00.000Z"}\n' +
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"world"}]},"timestamp":"2026-07-01T00:00:01.000Z"}\n' +
        bulk + "\n",
    );
    writeJsonl(path.join(root, "c.jsonl"), "small-c");
    const config = makeCollectorConfig({
      server: "http://x",
      token: "t",
      adapters: { "claude-code": { enabled: true, root }, waylog: { enabled: false, dirs: [] } },
    });
    const client = new FakeClient();

    const summary = await pullOnce(config, [createClaudeCodeAdapter(root)], { client: client as any });

    expect(client.calls).toHaveLength(1);
    const items = client.calls[0];
    expect(items.map((item) => item.format)).toEqual(["raw", "conversation", "raw"]);
    const degraded = items[1];
    expect(degraded.externalId).toBe("big"); // 单会话结果保留 externalId（§4.5 决策 3）
    expect((degraded.data as any).messages).toHaveLength(2);
    expect((degraded.data as any).messages[0].content).toBe("hello big");
    expect(summary.counts).toEqual({ created: 3, merged: 0, skipped: 0, error: 0 });
    expect(summary.truncated).toBe(0);
    expect(summary.errors).toEqual([]);
    expect(Object.keys(config.snapshots)).toHaveLength(3);
  });

  it("pull isolates oversize local-parse empty results as skipped without poisoning other files", async () => {
    const root = tmpDir("pentou-pull-oversize-fail-");
    writeJsonl(path.join(root, "a.jsonl"), "small-a");
    writeJsonl(path.join(root, "big.jsonl"), "x".repeat(11 * 1024 * 1024)); // 解析不出任何对话的超限内容
    writeJsonl(path.join(root, "c.jsonl"), "small-c");
    const config = makeCollectorConfig({
      server: "http://x",
      token: "t",
      adapters: { "claude-code": { enabled: true, root }, waylog: { enabled: false, dirs: [] } },
    });
    const client = new FakeClient();
    client.responses.push({
      ok: true,
      results: [
        { itemIndex: 0, conversations: [{ action: "created", id: "conv_a" }] },
        { itemIndex: 1, conversations: [{ action: "created", id: "conv_c" }] },
      ],
    });

    const summary = await pullOnce(config, [createClaudeCodeAdapter(root)], { client: client as any });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].map((item) => item.filename)).toEqual(["a.jsonl", "c.jsonl"]);
    // 解析出 0 条对话 = 空载荷：归 skipped 且推进快照，不再逐轮报错
    expect(summary.counts).toEqual({ created: 2, merged: 0, skipped: 1, error: 0 });
    expect(summary.errors).toEqual([]);
    expect(config.snapshots[path.join(root, "big.jsonl")]).toBeDefined();
  });

  it("pull shrinks a single conversation still exceeding the limit after parse (spec US-02)", async () => {
    const root = tmpDir("pentou-pull-shrink-");
    const chunk = "y".repeat(200 * 1024); // 200KB < 单消息 cap，走阶段二整条移除
    const lines = ['{"type":"user","message":{"role":"user","content":"U1"},"timestamp":"2026-07-01T00:00:00.000Z"}'];
    for (let i = 0; i < 60; i++) {
      lines.push(JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: `${chunk}#${i}` }] },
        timestamp: `2026-07-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
      }));
    }
    writeJsonl(path.join(root, "long.jsonl"), lines.join("\n") + "\n");
    const config = makeCollectorConfig({
      server: "http://x",
      token: "t",
      adapters: { "claude-code": { enabled: true, root }, waylog: { enabled: false, dirs: [] } },
    });
    const client = new FakeClient();

    const summary = await pullOnce(config, [createClaudeCodeAdapter(root)], { client: client as any });

    expect(summary.truncated).toBe(1);
    expect(summary.errors).toEqual([]);
    const item = client.calls[0][0];
    expect(item.format).toBe("conversation");
    const messages = (item.data as any).messages;
    expect(messages[0].content).toBe("U1"); // 指纹锚点保留
    expect(messages.some((m: any) => m.content.includes("pentou-cli 省略中部"))).toBe(true);
    expect(messages[messages.length - 1].content.endsWith("#59")).toBe(true); // 尾部最新保留
    expect(Buffer.byteLength(JSON.stringify(client.calls[0]))).toBeLessThanOrEqual(10 * 1024 * 1024);
  });

  it("dry-run marks oversize files without parsing or sending (spec US-01 AC4)", async () => {
    const root = tmpDir("pentou-pull-dryrun-");
    writeJsonl(path.join(root, "a.jsonl"), "small-a");
    writeJsonl(path.join(root, "big.jsonl"), "x".repeat(11 * 1024 * 1024)); // 不可解析，若被解析将产生错误
    const config = makeCollectorConfig({
      server: "http://x",
      token: "t",
      adapters: { "claude-code": { enabled: true, root }, waylog: { enabled: false, dirs: [] } },
    });
    const client = new FakeClient();
    const logs: string[] = [];
    const logger = { log: (m: string) => logs.push(m), warn: () => {}, error: () => {} };

    const summary = await pullOnce(config, [createClaudeCodeAdapter(root)], { client: client as any, dryRun: true, logger });

    expect(client.calls).toHaveLength(0);
    expect(logs.some((line) => line.includes("(oversize: local parse fallback)"))).toBe(true);
    expect(summary.errors).toEqual([]); // 未解析，无解析错误
  });

  it("degradeOversizeItem drops externalId when a file parses into multiple conversations (§4.5 决策 3)", () => {
    const data = JSON.stringify([
      { session_id: "s1", messages: [{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }] },
      { session_id: "s2", messages: [{ role: "user", content: "q2" }, { role: "assistant", content: "a2" }] },
    ]);
    const entry = {
      file: "/tmp/export.json",
      item: { platform: "claude-code", externalId: "export", format: "raw" as const, data, filename: "export.json" },
      snapshot: { mtimeMs: 1, size: data.length },
    };

    const result = degradeOversizeItem(entry as any);

    expect(result.entries).toHaveLength(2);
    expect(result.entries.every((one) => one.item.externalId === undefined)).toBe(true);
    expect(result.entries.every((one) => one.item.format === "conversation")).toBe(true);
    expect(result.entries.every((one) => one.file === "/tmp/export.json")).toBe(true);
  });

  it("pull reports unsent files after a 401 instead of silently dropping them", async () => {
    const root = tmpDir("pentou-pull-401-");
    for (let i = 0; i < 51; i++) writeJsonl(path.join(root, `${String(i).padStart(2, "0")}.jsonl`));
    const config = makeCollectorConfig({
      server: "http://x",
      token: "t",
      adapters: { "claude-code": { enabled: true, root }, waylog: { enabled: false, dirs: [] } },
    });
    const client = new FakeClient();
    client.errors.push(new IngestHttpError(401, "401 unauthorized"));

    const summary = await pullOnce(config, [createClaudeCodeAdapter(root)], { client: client as any });

    expect(summary.sent).toBe(50);
    expect(summary.counts.error).toBe(51);
    expect(summary.errors).toHaveLength(51);
    expect(summary.errors.at(-1)?.error).toContain("not sent after auth failure");
  });

  it("debounces repeated watch events into one upload", async () => {
    const root = tmpDir("pentou-watch-");
    const file = path.join(root, "a.jsonl");
    writeJsonl(file);
    const config = makeCollectorConfig({
      server: "http://x",
      token: "t",
      debounceMs: 25,
      adapters: { "claude-code": { enabled: true, root }, waylog: { enabled: false, dirs: [] } },
    });
    const client = new FakeClient();
    const engine = new CollectorWatchEngine(config, [createClaudeCodeAdapter(root)], { client: client as any });

    engine.schedule(file);
    engine.schedule(file);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0][0].externalId).toBe("a");
    engine.stop();
  });

  it("watch does not retry real uploads after a 401", async () => {
    const root = tmpDir("pentou-watch-401-");
    const file = path.join(root, "a.jsonl");
    writeJsonl(file);
    const config = makeCollectorConfig({
      server: "http://x",
      token: "bad",
      debounceMs: 5,
      adapters: { "claude-code": { enabled: true, root }, waylog: { enabled: false, dirs: [] } },
    });
    const client = new FakeClient();
    client.errors.push(new IngestHttpError(401, "401 unauthorized"));
    const engine = new CollectorWatchEngine(config, [createClaudeCodeAdapter(root)], { client: client as any });

    engine.schedule(file);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(client.calls).toHaveLength(1);
    engine.stop();
  });

  it("uses capped exponential backoff", () => {
    expect(backoffDelay(1)).toBe(1000);
    expect(backoffDelay(3)).toBe(4000);
    expect(backoffDelay(99)).toBe(300000);
  });

  // 查询型 watch：db 写入事件聚合为一次该源的差量拉取，仅变化会话重传
  // （spec collector-source-expansion US-03 AC2）
  it("query adapter watch events coalesce into one differential sync", async () => {
    const root = tmpDir("pentou-query-");
    const dbPath = path.join(root, "fake.db");
    fs.writeFileSync(dbPath, "");
    const key = (id: string) => `sqlite://${dbPath}#${id}`;
    const metas = new Map([
      ["s1", { mtimeMs: 100, size: 2 }],
      ["s2", { mtimeMs: 200, size: 3 }],
    ]);
    const fakeQuery = {
      platform: "fakeq",
      kind: "query" as const,
      async discover() {
        return [...metas.keys()].map((id) => ({ path: key(id), platform: "fakeq" }));
      },
      watchRoots: () => [root],
      async snapshot(fileOrKey: string) {
        return metas.get(fileOrKey.split("#")[1]) ?? null;
      },
      async toItem(fileOrKey: string) {
        const id = fileOrKey.split("#")[1];
        return { platform: "fakeq", externalId: id, format: "raw" as const, data: `{"id":"${id}"}` };
      },
    };
    const config = makeCollectorConfig({ server: "http://x", token: "t", debounceMs: 10 });
    config.snapshots[key("s1")] = { mtimeMs: 100, size: 2 }; // s1 未变化
    const client = new FakeClient();
    const engine = new CollectorWatchEngine(config, [fakeQuery], { client: client as any });

    engine.schedule(dbPath);
    engine.schedule(`${dbPath}-wal`); // 防抖窗口内的第二个事件合并
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].map((item) => item.externalId)).toEqual(["s2"]);
    expect(config.snapshots[key("s2")]).toEqual({ mtimeMs: 200, size: 3 });
    engine.stop();
  });
});

// ── 文档源（spec collector-docs-push §pull 与 watch 复用现有引擎，design 决策 12）──

describe("collector engine with the docs adapter", () => {
  function docsConfig(root: string) {
    return makeCollectorConfig({
      server: "http://localhost",
      token: "tok",
      adapters: {
        ...makeCollectorConfig().adapters,
        "claude-code": { enabled: false, root: path.join(root, "__none__") },
        docs: { enabled: true, dirs: [{ path: root, project: "pentou" }] },
      },
    });
  }

  it("counts document results and does not re-send unchanged files", async () => {
    const root = tmpDir("pentou-engine-docs-");
    fs.writeFileSync(path.join(root, "a.md"), "# A\n\nbody");
    const config = docsConfig(root);
    const adapters = [createDocsAdapter(config.adapters.docs.dirs)];
    const client = new FakeClient();
    client.responses.push({
      ok: true,
      results: [{ itemIndex: 0, conversations: [], documents: [{ action: "created", id: "doc_1" }] }],
    });

    const first = await pullOnce(config, adapters, { client: client as any });
    expect(first.sent).toBe(1);
    expect(first.counts.created).toBe(1);
    expect(client.calls[0][0].format).toBe("document");

    // 快照已推进：文件未变化 → 第二次不重复上报
    const engine = new CollectorWatchEngine(config, adapters, { client: client as any });
    const before = client.calls.length;
    await engine.backfill();
    expect(client.calls.length).toBe(before);
  });

  it("fails an oversize document instead of shrinking it", async () => {
    const root = tmpDir("pentou-engine-docs-big-");
    fs.writeFileSync(path.join(root, "big.md"), "x".repeat(11 * 1024 * 1024));
    const config = docsConfig(root);
    const adapters = [createDocsAdapter(config.adapters.docs.dirs)];
    const client = new FakeClient();

    const summary = await pullOnce(config, adapters, { client: client as any });
    expect(client.calls).toHaveLength(0); // 绝不截断上报
    expect(summary.counts.error).toBe(1);
    expect(summary.truncated).toBe(0);
    expect(summary.errors[0].error).toMatch(/not truncated/);
    expect(config.snapshots[path.join(root, "big.md")]).toBeUndefined();
  });
});

describe("conversation git project payload", () => {
  function claudeConfig(root: string) {
    return makeCollectorConfig({
      server: "http://x",
      token: "t",
      adapters: { "claude-code": { enabled: true, root }, waylog: { enabled: false, dirs: [] } },
    });
  }

  it("attaches the git root as project.key for a nested cwd", async () => {
    const repo = path.join(tmpDir("pentou-git-"), "pentou");
    fs.mkdirSync(path.join(repo, "src", "server"), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });
    const root = tmpDir("pentou-cwd-");
    writeJsonl(
      path.join(root, "a.jsonl"),
      JSON.stringify({ type: "user", cwd: path.join(repo, "src", "server"), message: { role: "user", content: "hi" } }) + "\n",
    );
    const client = new FakeClient();
    await pullOnce(claudeConfig(root), [createClaudeCodeAdapter(root)], { client: client as any });
    expect(client.calls[0][0].project).toMatchObject({ key: "pentou", name: "pentou" });
    expect(path.basename(client.calls[0][0].project?.rootPath ?? "")).toBe("pentou");
  });

  it("omits project when cwd is not a git repo", async () => {
    const cwd = tmpDir("pentou-nongit-");
    const root = tmpDir("pentou-cwd-");
    writeJsonl(
      path.join(root, "a.jsonl"),
      JSON.stringify({ type: "user", cwd, message: { role: "user", content: "hi" } }) + "\n",
    );
    const client = new FakeClient();
    const summary = await pullOnce(claudeConfig(root), [createClaudeCodeAdapter(root)], { client: client as any });
    expect(summary.counts.error).toBe(0);
    expect(client.calls[0][0].project).toBeUndefined();
  });

  it("probes each cwd once per scan, negatives included", () => {
    const cache: GitProjectCache = new Map();
    const seen: string[] = [];
    const detect = (dir: string) => {
      seen.push(dir);
      return dir === "/repo/src" ? { key: "pentou", rootPath: "/repo" } : undefined;
    };
    // 同一仓库的几十个会话共用一次 git 探测；非仓库目录（返回 undefined）同样只探一次
    for (let i = 0; i < 20; i++) {
      expect(lookupGitProject(cache, "/repo/src", detect)).toMatchObject({ key: "pentou" });
      expect(lookupGitProject(cache, "/elsewhere", detect)).toBeUndefined();
    }
    expect(seen).toEqual(["/repo/src", "/elsewhere"]);
  });

  it("shares one git probe across every session in the same repo", async () => {
    const repo = path.join(tmpDir("pentou-git-shared-"), "pentou");
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });
    const root = tmpDir("pentou-cwd-many-");
    for (let i = 0; i < 5; i++) {
      writeJsonl(
        path.join(root, `s${i}.jsonl`),
        JSON.stringify({ type: "user", cwd: path.join(repo, "src"), message: { role: "user", content: `hi ${i}` } }) + "\n",
      );
    }
    const client = new FakeClient();
    await pullOnce(claudeConfig(root), [createClaudeCodeAdapter(root)], { client: client as any });
    const items = client.calls.flat();
    expect(items).toHaveLength(5);
    for (const item of items) expect(item.project).toMatchObject({ key: "pentou" });
  });

  it("omits project when the session has no cwd", async () => {
    const root = tmpDir("pentou-nocwd-");
    writeJsonl(path.join(root, "a.jsonl"));
    const client = new FakeClient();
    const summary = await pullOnce(claudeConfig(root), [createClaudeCodeAdapter(root)], { client: client as any });
    expect(summary.counts.error).toBe(0);
    expect(client.calls[0][0].project).toBeUndefined();
  });
});
