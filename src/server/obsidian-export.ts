/**
 * obsidian-export.ts
 * Obsidian vault 直写导出（spec obsidian-vault-export）：
 * - detectVaults：读 Obsidian 官方注册表 obsidian.json，探测本机 vault 列表
 * - exportNoteToVault：sanitize 文件名 + 防路径穿越 + 同名加序号 + 落盘
 * - validateVaultPath：设置页手动输入路径时的保存前校验
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface DetectedVault {
  name: string;
  path: string;
}

export class ObsidianExportError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Obsidian 注册表位置，按 OS 取（spec §4.3）。 */
export function obsidianRegistryPath(platform: NodeJS.Platform = process.platform): string {
  const home = os.homedir();
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "obsidian", "obsidian.json");
  if (platform === "win32") return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "obsidian", "obsidian.json");
  return path.join(home, ".config", "obsidian", "obsidian.json");
}

/** 注册表缺失 / 损坏时返回空数组，不抛错（spec 异常 4）。 */
export function detectVaults(registryPath: string = obsidianRegistryPath()): DetectedVault[] {
  try {
    const raw = fs.readFileSync(registryPath, "utf-8");
    const parsed = JSON.parse(raw);
    const vaults = parsed?.vaults;
    if (!vaults || typeof vaults !== "object") return [];
    const out: DetectedVault[] = [];
    for (const entry of Object.values<any>(vaults)) {
      if (typeof entry?.path === "string" && entry.path) {
        out.push({ name: path.basename(entry.path), path: entry.path });
      }
    }
    return out;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error("[obsidian] failed to parse registry:", String(e));
    }
    return [];
  }
}

/** 文件系统 + Obsidian 非法字符替换为 -；全非法时用 Untitled 兜底（spec US-03 / 边界 2）。 */
export function sanitizeNoteTitle(title: string): string {
  const cleaned = title
    .replace(/[/\\:*?"<>|#^[\]\x00-\x1f]/g, "-")
    .replace(/\.+$/, "")
    .trim();
  if (!cleaned || /^[-. ]+$/.test(cleaned)) return `Untitled-${Date.now()}`;
  return cleaned;
}

function assertVaultDir(vaultPath: string): string {
  if (typeof vaultPath !== "string" || !path.isAbsolute(vaultPath)) {
    throw new ObsidianExportError(400, "vaultPath must be an absolute path");
  }
  const resolved = path.resolve(vaultPath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new ObsidianExportError(404, `Vault path not reachable: ${resolved}`);
  }
  if (!stat.isDirectory()) throw new ObsidianExportError(404, `Vault path is not a directory: ${resolved}`);
  return resolved;
}

export function validateVaultPath(vaultPath: string): { ok: true; isVault: boolean } {
  const resolved = assertVaultDir(vaultPath);
  return { ok: true, isVault: fs.existsSync(path.join(resolved, ".obsidian")) };
}

/** 写入笔记；同名不覆盖、自动加序号（spec US-02 AC-2 / 决策 3）。返回实际文件名（不含 .md）。 */
export function exportNoteToVault(vaultPath: string, title: string, content: string): { fileName: string } {
  const vaultDir = assertVaultDir(vaultPath);
  if (typeof content !== "string") throw new ObsidianExportError(400, "content must be a string");

  const base = sanitizeNoteTitle(String(title ?? ""));
  for (let i = 0; ; i++) {
    const fileName = i === 0 ? base : `${base} (${i})`;
    const target = path.resolve(vaultDir, `${fileName}.md`);
    const relative = path.relative(vaultDir, target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || path.dirname(target) !== vaultDir) {
      throw new ObsidianExportError(400, "Path traversal detected");
    }
    try {
      fs.writeFileSync(target, content, { encoding: "utf-8", flag: "wx" });
      return { fileName };
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
    }
  }
}
