import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  detectVaults,
  exportNoteToVault,
  sanitizeNoteTitle,
  validateVaultPath,
  ObsidianExportError,
} from "./obsidian-export";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempVault(): string {
  const abs = fs.mkdtempSync(path.join(tmpdir(), "pentou-obsidian-"));
  cleanupDirs.push(abs);
  return abs;
}

describe("sanitizeNoteTitle", () => {
  it("replaces filesystem and Obsidian illegal chars with -", () => {
    expect(sanitizeNoteTitle('a/b\\c:d*e?f"g<h>i|j#k')).toBe("a-b-c-d-e-f-g-h-i-j-k");
  });

  it("falls back to Untitled when title is all illegal chars", () => {
    expect(sanitizeNoteTitle("///")).toMatch(/^Untitled-\d+$/);
    expect(sanitizeNoteTitle("")).toMatch(/^Untitled-\d+$/);
  });

  it("neutralizes traversal sequences", () => {
    expect(sanitizeNoteTitle("../../etc/passwd")).not.toContain("/");
  });
});

describe("exportNoteToVault", () => {
  it("writes note content byte-identical, including large bodies", () => {
    const vault = tempVault();
    const big = "汉字content-".repeat(15000); // ~146k+ chars
    const { fileName } = exportNoteToVault(vault, "大文档", big);
    expect(fileName).toBe("大文档");
    expect(fs.readFileSync(path.join(vault, "大文档.md"), "utf-8")).toBe(big);
  });

  it("suffixes on name conflict without touching the original", () => {
    const vault = tempVault();
    exportNoteToVault(vault, "Note", "first");
    const second = exportNoteToVault(vault, "Note", "second");
    expect(second.fileName).toBe("Note (1)");
    expect(fs.readFileSync(path.join(vault, "Note.md"), "utf-8")).toBe("first");
    expect(fs.readFileSync(path.join(vault, "Note (1).md"), "utf-8")).toBe("second");
  });

  it("keeps traversal-shaped titles inside the vault", () => {
    const vault = tempVault();
    const { fileName } = exportNoteToVault(vault, "../../escape", "x");
    expect(fs.existsSync(path.join(vault, `${fileName}.md`))).toBe(true);
    expect(fs.readdirSync(vault)).toHaveLength(1);
  });

  it("rejects non-absolute vaultPath with 400", () => {
    expect(() => exportNoteToVault("relative/path", "t", "c")).toThrowError(ObsidianExportError);
    try {
      exportNoteToVault("relative/path", "t", "c");
    } catch (e) {
      expect((e as ObsidianExportError).status).toBe(400);
    }
  });

  it("rejects unreachable vaultPath with 404", () => {
    try {
      exportNoteToVault(path.join(tmpdir(), "pentou-nonexistent-vault-xyz"), "t", "c");
      expect.unreachable();
    } catch (e) {
      expect((e as ObsidianExportError).status).toBe(404);
    }
  });
});

describe("validateVaultPath", () => {
  it("flags isVault by .obsidian marker", () => {
    const vault = tempVault();
    expect(validateVaultPath(vault)).toEqual({ ok: true, isVault: false });
    fs.mkdirSync(path.join(vault, ".obsidian"));
    expect(validateVaultPath(vault)).toEqual({ ok: true, isVault: true });
  });
});

describe("detectVaults", () => {
  function tempRegistry(content: string): string {
    const dir = tempVault();
    const file = path.join(dir, "obsidian.json");
    fs.writeFileSync(file, content);
    return file;
  }

  it("parses vault entries from registry", () => {
    const reg = tempRegistry(
      JSON.stringify({ vaults: { a1: { path: "/Users/x/VaultOne", ts: 1, open: true }, b2: { path: "/Users/x/文档库", ts: 2 } } }),
    );
    expect(detectVaults(reg)).toEqual([
      { name: "VaultOne", path: "/Users/x/VaultOne" },
      { name: "文档库", path: "/Users/x/文档库" },
    ]);
  });

  it("returns empty array when registry is missing", () => {
    expect(detectVaults(path.join(tmpdir(), "no-such-obsidian.json"))).toEqual([]);
  });

  it("returns empty array when registry is corrupt", () => {
    expect(detectVaults(tempRegistry("{not json"))).toEqual([]);
    expect(detectVaults(tempRegistry(JSON.stringify({ vaults: null })))).toEqual([]);
  });
});
