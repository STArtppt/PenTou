import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAppVersion, stripVersionPrefix } from "./app-version.js";

function makeRoot(version: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pentou-ver-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "pentou", version }),
    "utf-8",
  );
  return dir;
}

describe("stripVersionPrefix", () => {
  it("strips leading v", () => {
    expect(stripVersionPrefix("v1.2.3")).toBe("1.2.3");
    expect(stripVersionPrefix("1.2.3")).toBe("1.2.3");
  });
});

describe("resolveAppVersion", () => {
  it("prefers PENTOU_VERSION env over package.json", () => {
    const root = makeRoot("9.9.9");
    expect(
      resolveAppVersion(root, { env: { PENTOU_VERSION: "v0.2.0" }, execGit: () => null }),
    ).toBe("0.2.0");
  });

  it("uses APP_VERSION when PENTOU_VERSION is absent", () => {
    const root = makeRoot("0.0.1");
    expect(
      resolveAppVersion(root, { env: { APP_VERSION: "1.0.0" }, execGit: () => null }),
    ).toBe("1.0.0");
  });

  it("uses non-placeholder package.json (npm inject path)", () => {
    const root = makeRoot("0.0.6");
    expect(resolveAppVersion(root, { env: {}, execGit: () => null })).toBe("0.0.6");
  });

  it("skips placeholder package.json and uses latest v* tag with -dev", () => {
    const root = makeRoot("0.0.1");
    fs.mkdirSync(path.join(root, ".git"));
    const calls: string[][] = [];
    const execGit = (args: string[]) => {
      calls.push(args);
      if (args[0] === "tag") return "v0.0.6\nv0.0.5\n";
      if (args[0] === "rev-list") return "aaa111";
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "bbb222";
      if (args[0] === "rev-parse" && args[1] === "--short") return "bbb222";
      return null;
    };
    expect(resolveAppVersion(root, { env: {}, execGit })).toBe("0.0.6-dev+bbb222");
    expect(calls[0]).toEqual(["tag", "-l", "v*", "--sort=-v:refname"]);
  });

  it("returns bare tag version when HEAD matches the tag commit", () => {
    const root = makeRoot("0.0.1");
    fs.mkdirSync(path.join(root, ".git"));
    const execGit = (args: string[]) => {
      if (args[0] === "tag") return "v0.0.6\n";
      if (args[0] === "rev-list") return "samehash";
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "samehash";
      return null;
    };
    expect(resolveAppVersion(root, { env: {}, execGit })).toBe("0.0.6");
  });

  it("falls back to 0.0.0-dev when nothing else is available", () => {
    const root = makeRoot("0.0.1");
    expect(resolveAppVersion(root, { env: {}, execGit: () => null })).toBe("0.0.0-dev");
  });
});
