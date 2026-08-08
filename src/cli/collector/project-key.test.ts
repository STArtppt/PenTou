/**
 * project-key.test.ts —— 登记目录 → 项目身份键
 * （spec collector-docs-push §项目映射：显式 > git 根目录名 > 手动输入 > 目录 basename）。
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gitProjectKey, resolveProjectKey } from "./project-key";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pentou-project-key-"));
}

describe("gitProjectKey", () => {
  it("returns the repository root name from a nested sub-directory", () => {
    const root = path.join(tmpDir(), "my-repo");
    const nested = path.join(root, "docs", "guides");
    fs.mkdirSync(nested, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
    // 登记的是子目录，但项目名应当是仓库名——否则两个仓库的 docs/ 会撞在一起
    expect(gitProjectKey(nested)).toBe("my-repo");
    expect(gitProjectKey(root)).toBe("my-repo");
  });

  it("returns undefined outside a git repository and never throws", () => {
    const dir = tmpDir();
    expect(gitProjectKey(dir)).toBeUndefined();
    expect(gitProjectKey(path.join(dir, "does-not-exist"))).toBeUndefined();
  });
});

describe("resolveProjectKey", () => {
  const dir = "/tmp/some/workspace/docs";

  it("uses an explicit project without probing anything", async () => {
    const detectGit = vi.fn();
    const ask = vi.fn();
    expect(await resolveProjectKey(dir, { explicit: "pentou", detectGit, ask })).toBe("pentou");
    expect(detectGit).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it("prefers the git repository root over the directory name", async () => {
    const ask = vi.fn();
    expect(await resolveProjectKey(dir, { detectGit: () => "my-repo", ask })).toBe("my-repo");
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks when the directory is not in a git repo", async () => {
    const ask = vi.fn(async (_prompt: string) => "手动项目名");
    expect(await resolveProjectKey(dir, { detectGit: () => undefined, ask, interactive: true }))
      .toBe("手动项目名");
    expect(ask).toHaveBeenCalledOnce();
    expect(ask.mock.calls[0][0]).toContain("not a git repository");
  });

  it("takes the directory name when the user just presses Enter", async () => {
    expect(await resolveProjectKey(dir, {
      detectGit: () => undefined,
      ask: async () => "",
      interactive: true,
    })).toBe("docs");
    expect(await resolveProjectKey(dir, {
      detectGit: () => undefined,
      ask: async () => "   ",
      interactive: true,
    })).toBe("docs");
  });

  it("never blocks on a prompt in a non-interactive shell (CI)", async () => {
    const ask = vi.fn();
    expect(await resolveProjectKey(dir, { detectGit: () => undefined, ask, interactive: false }))
      .toBe("docs");
    expect(ask).not.toHaveBeenCalled();
  });

  it("falls back to the directory name when the prompt aborts (stdin EOF)", async () => {
    // 管道 / Ctrl+D 让 readline 抛错时，不该把整条 init 带崩
    expect(await resolveProjectKey(dir, {
      detectGit: () => undefined,
      ask: async () => { throw new Error("Aborted with Ctrl+D"); },
      interactive: true,
    })).toBe("docs");
  });

  it("resolves the directory before taking its basename", async () => {
    expect(await resolveProjectKey("~/x/../y/notes/", {
      detectGit: () => undefined,
      interactive: false,
    })).toBe("notes");
  });
});
