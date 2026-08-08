import { describe, expect, it } from "vitest";
import path from "node:path";
import { buildInitConfigForTest, parseCollectArgsForTest } from "./command";
import { makeCollectorConfig } from "./test-fixtures";

describe("collector command parsing and init config", () => {
  it("rejects unknown flags instead of treating typos as values", () => {
    expect(() => parseCollectArgsForTest("pull", ["--dryrun"])).toThrow(/unknown option: --dryrun/);
    expect(() => parseCollectArgsForTest("pull", ["--dryrun", "--config", "x"])).toThrow(/unknown option: --dryrun/);
  });

  it("rejects invalid debounce values", () => {
    expect(() => parseCollectArgsForTest("init", ["--debounce-ms", "nope"])).toThrow(/invalid --debounce-ms/);
    expect(() => parseCollectArgsForTest("init", ["--debounce-ms", "0"])).toThrow(/invalid --debounce-ms/);
  });

  it("merges init updates into existing privacy config and snapshots", () => {
    const existing = makeCollectorConfig({
      server: "http://old",
      token: "old-token",
      adapters: {
        "claude-code": { enabled: true, root: "/old/claude" },
        waylog: { enabled: true, dirs: ["/work/.waylog"] },
      },
      exclude: ["secret-project/**"],
      debounceMs: 1234,
      snapshots: { "/old/claude/a.jsonl": { mtimeMs: 1, size: 2 } },
    });

    const next = buildInitConfigForTest(existing, {
      server: "http://new",
      token: "new-token",
      flags: parseCollectArgsForTest("init", []),
    });

    expect(next.server).toBe("http://new");
    expect(next.token).toBe("new-token");
    expect(next.adapters["claude-code"].root).toBe("/old/claude");
    expect(next.adapters.waylog).toEqual({ enabled: true, dirs: ["/work/.waylog"] });
    expect(next.exclude).toEqual(["secret-project/**"]);
    expect(next.debounceMs).toBe(1234);
    expect(next.snapshots).toEqual(existing.snapshots);
  });
});

// ── --docs-dir / --doc-project（spec collector-docs-push）────────────────────

describe("docs dir registration", () => {
  it("pairs --doc-project with the --docs-dir immediately before it", () => {
    const flags = parseCollectArgsForTest("init", [
      "--docs-dir", "/a/docs", "--doc-project", "alpha",
      "--docs-dir", "/b/docs",
    ]);
    expect(flags["--docs-dir"]).toEqual([
      { path: "/a/docs", project: "alpha" },
      { path: "/b/docs" },
    ]);
  });

  it("rejects a --doc-project that does not follow a --docs-dir", () => {
    expect(() => parseCollectArgsForTest("init", ["--doc-project", "alpha"]))
      .toThrow(/--doc-project must follow a --docs-dir/);
  });

  it("enables docs and records the dirs on init", () => {
    const next = buildInitConfigForTest(undefined, {
      server: "http://new",
      token: "tok",
      flags: parseCollectArgsForTest("init", ["--docs-dir", "/a/docs", "--doc-project", "alpha"]),
    });
    expect(next.adapters.docs.enabled).toBe(true);
    expect(next.adapters.docs.dirs).toEqual([{ path: path.resolve("/a/docs"), project: "alpha" }]);
  });

  it("leaves docs untouched when no --docs-dir is passed", () => {
    const existing = makeCollectorConfig({ server: "http://old", token: "old" });
    const next = buildInitConfigForTest(existing, {
      server: "http://new",
      token: "tok",
      flags: parseCollectArgsForTest("init", []),
    });
    expect(next.adapters.docs).toEqual({ enabled: false, dirs: [] });
  });

  it("re-registering the same dir replaces its project instead of duplicating it", () => {
    const existing = makeCollectorConfig({
      server: "http://old",
      token: "old",
      adapters: {
        ...makeCollectorConfig().adapters,
        docs: { enabled: true, dirs: [{ path: path.resolve("/a/docs"), project: "old-name" }] },
      },
    });
    const next = buildInitConfigForTest(existing, {
      server: "http://new",
      token: "tok",
      flags: parseCollectArgsForTest("init", ["--docs-dir", "/a/docs", "--doc-project", "new-name"]),
    });
    expect(next.adapters.docs.dirs).toEqual([{ path: path.resolve("/a/docs"), project: "new-name" }]);
  });
});
