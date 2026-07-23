import { describe, expect, it } from "vitest";
import { buildInitConfigForTest, parseCollectArgsForTest } from "./command";
import { defaultConfig } from "./config";

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
    const existing = defaultConfig({
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
