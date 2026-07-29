/**
 * push.test.ts —— `pentou push docs`（spec collector-docs-push §push docs 一次性命令）。
 * 覆盖：参数解析 / 凭据回落与缺失提示 / dry-run 零请求 / 每次都全量推送 / 汇总计数。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MISSING_CREDENTIALS_HINT,
  parsePushArgs,
  pushDocs,
  resolvePushCredentials,
} from "./push";
import type { IngestItem, IngestResponse } from "./types";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pentou-push-"));
}

function write(root: string, relative: string, content: string): void {
  const full = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

class FakeClient {
  calls: IngestItem[][] = [];
  responses: IngestResponse[] = [];

  async ingest(items: IngestItem[]): Promise<IngestResponse> {
    this.calls.push(items);
    return this.responses.shift() ?? {
      ok: true,
      results: items.map((_item, itemIndex) => ({
        itemIndex,
        conversations: [],
        documents: [{ action: "created" as const, id: `doc_${itemIndex}` }],
      })),
    };
  }
}

const silentLogger = { log() {}, warn() {} };

describe("push docs argument parsing", () => {
  it("parses the directory plus flags", () => {
    const parsed = parsePushArgs(["./docs", "--project", "pentou", "--dry-run"]);
    expect(parsed.rest).toEqual(["./docs"]);
    expect(parsed.flags["--project"]).toBe("pentou");
    expect(parsed.flags["--dry-run"]).toBe(true);
  });

  it("rejects unknown options rather than swallowing typos", () => {
    expect(() => parsePushArgs(["./docs", "--dryrun"])).toThrow(/unknown option: --dryrun/);
  });

  it("requires a value for value flags", () => {
    expect(() => parsePushArgs(["./docs", "--token"])).toThrow(/missing value for --token/);
    expect(() => parsePushArgs(["./docs", "--token", "--verbose"])).toThrow(/missing value for --token/);
  });
});

describe("push docs credentials", () => {
  it("uses explicit flags when supplied", () => {
    const credentials = resolvePushCredentials(
      { "--server": "http://example.test/", "--token": "tok" },
      () => { throw new Error("config must not be read"); },
    );
    expect(credentials).toEqual({ server: "http://example.test", token: "tok" });
  });

  it("falls back to the collector config for whatever is missing", () => {
    const credentials = resolvePushCredentials(
      { "--token": "explicit" },
      () => ({ server: "http://from-config", token: "config-token" }),
    );
    expect(credentials).toEqual({ server: "http://from-config", token: "explicit" });
  });

  it("fails with an actionable hint pointing at collect init", () => {
    expect(() => resolvePushCredentials({}, () => { throw new Error("collector config not found"); }))
      .toThrow(MISSING_CREDENTIALS_HINT);
    expect(MISSING_CREDENTIALS_HINT).toMatch(/pentou collect init/);
    expect(MISSING_CREDENTIALS_HINT).toMatch(/Settings -> Collector/);
  });
});

describe("push docs run", () => {
  it("sends every scanned document and reports the counts", async () => {
    const root = tmpDir();
    write(root, "README.md", "# Readme\n\nbody");
    write(root, "guides/deploy.md", "---\ntitle: 部署\n---\n\nbody");
    write(root, "node_modules/pkg/README.md", "# Dep");
    write(root, "notes.txt", "ignored");

    const client = new FakeClient();
    const summary = await pushDocs({ dir: root, project: "pentou", client: client as any, logger: silentLogger });

    expect(summary.scanned).toBe(2);
    expect(summary.sent).toBe(2);
    expect(summary.counts.created).toBe(2);
    expect(summary.errors).toEqual([]);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].map((item) => item.externalId).sort())
      .toEqual(["pentou/README.md", "pentou/guides/deploy.md"]);
    expect(client.calls[0].every((item) => item.format === "document")).toBe(true);
  });

  it("honours the exclude globs and counts them separately", async () => {
    const root = tmpDir();
    write(root, "keep.md", "# Keep");
    write(root, "drafts/skip.md", "# Skip");

    const client = new FakeClient();
    const summary = await pushDocs({
      dir: root,
      exclude: ["**/drafts/**"],
      client: client as any,
      logger: silentLogger,
    });
    expect(summary.excluded).toBe(1);
    expect(summary.sent).toBe(1);
    expect(client.calls[0]).toHaveLength(1);
  });

  it("sends nothing on --dry-run and prints the target project", async () => {
    const root = tmpDir();
    write(root, "a.md", "# A");
    const client = new FakeClient();
    const lines: string[] = [];

    const summary = await pushDocs({
      dir: root,
      project: "pentou",
      dryRun: true,
      client: client as any,
      logger: { log: (m) => lines.push(m), warn() {} },
    });
    expect(client.calls).toHaveLength(0);
    expect(summary.sent).toBe(0);
    expect(lines).toEqual(['a.md -> project "pentou"']);
  });

  it("pushes in full every run — idempotency is the server's job", async () => {
    const root = tmpDir();
    write(root, "a.md", "# A\n\nbody");
    const client = new FakeClient();

    await pushDocs({ dir: root, client: client as any, logger: silentLogger });
    client.responses.push({
      ok: true,
      results: [{ itemIndex: 0, conversations: [], documents: [{ action: "skipped", id: "doc_0" }] }],
    });
    const second = await pushDocs({ dir: root, client: client as any, logger: silentLogger });

    expect(client.calls).toHaveLength(2); // 不读写快照 → 第二次照样发
    expect(second.counts.skipped).toBe(1);
    expect(second.counts.created).toBe(0);
  });

  it("writes no collector config and keeps no snapshot file", async () => {
    const root = tmpDir();
    write(root, "a.md", "# A");
    const client = new FakeClient();
    await pushDocs({ dir: root, client: client as any, logger: silentLogger });
    // 登记目录里只剩原始文件，没有任何 CLI 副产物
    expect(fs.readdirSync(root)).toEqual(["a.md"]);
  });

  it("records per-item errors returned by the server", async () => {
    const root = tmpDir();
    write(root, "a.md", "# A");
    const client = new FakeClient();
    client.responses.push({
      ok: false,
      results: [{ itemIndex: 0, conversations: [], error: "boom" }],
    });
    const summary = await pushDocs({ dir: root, client: client as any, logger: silentLogger });
    expect(summary.counts.error).toBe(1);
    expect(summary.errors[0].error).toBe("boom");
  });

  it("skips an oversize document with an explicit error instead of truncating", async () => {
    const root = tmpDir();
    write(root, "big.md", "x".repeat(11 * 1024 * 1024));
    write(root, "small.md", "# Small");
    const client = new FakeClient();

    const summary = await pushDocs({ dir: root, client: client as any, logger: silentLogger });
    expect(summary.counts.error).toBe(1);
    expect(summary.errors[0].error).toMatch(/not truncated/);
    expect(client.calls[0].map((item) => item.filename)).toEqual(["small.md"]);
  });
});
