import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClaudeCodeAdapter } from "./adapters/claude-code";
import { CollectorWatchEngine, backoffDelay, createExcludeMatcher, pullOnce, snapshotChanged } from "./engine";
import { defaultConfig } from "./config";
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

  it("does not treat plain exclude text as unsafe substring matching", () => {
    const match = createExcludeMatcher(["test"]);
    expect(match("/tmp/my-latest-app/chat.jsonl")).toBeNull();
    expect(match("/tmp/test/chat.jsonl")).toBe("test");
  });

  it("pull uploads all discovered files and accumulates conversation actions", async () => {
    const root = tmpDir("pentou-pull-");
    writeJsonl(path.join(root, "a.jsonl"));
    writeJsonl(path.join(root, "b.jsonl"));
    const config = defaultConfig({
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
    const config = defaultConfig({
      server: "http://x",
      token: "t",
      adapters: { "claude-code": { enabled: true, root }, waylog: { enabled: false, dirs: [] } },
    });
    const client = new FakeClient();
    client.responses.push({
      ok: true,
      results: [
        { itemIndex: 0, conversations: [], error: "no conversations parsed" },
        { itemIndex: 1, conversations: [{ action: "created", id: "conv_b" }] },
      ],
    });

    const summary = await pullOnce(config, [createClaudeCodeAdapter(root)], { client: client as any });
    expect(summary.counts).toEqual({ created: 1, merged: 0, skipped: 0, error: 1 });
    expect(summary.errors[0].error).toBe("no conversations parsed");
  });

  it("pull isolates 413 failures so large files do not poison small-file batches", async () => {
    const root = tmpDir("pentou-pull-413-");
    writeJsonl(path.join(root, "a.jsonl"), "small-a");
    writeJsonl(path.join(root, "big.jsonl"), "x".repeat(11 * 1024 * 1024));
    writeJsonl(path.join(root, "c.jsonl"), "small-c");
    const config = defaultConfig({
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
    expect(summary.counts).toEqual({ created: 2, merged: 0, skipped: 0, error: 1 });
    expect(summary.errors).toEqual([{ file: path.join(root, "big.jsonl"), error: "file exceeds ingest 10MB limit" }]);
  });

  it("pull reports unsent files after a 401 instead of silently dropping them", async () => {
    const root = tmpDir("pentou-pull-401-");
    for (let i = 0; i < 51; i++) writeJsonl(path.join(root, `${String(i).padStart(2, "0")}.jsonl`));
    const config = defaultConfig({
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
    const config = defaultConfig({
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
    const config = defaultConfig({
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
});
