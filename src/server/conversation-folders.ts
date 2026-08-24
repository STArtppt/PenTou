/**
 * conversation-folders.ts —— 对话文件夹清单与项目归属的磁盘操作。
 *
 * 从 api-router 抽出，供对话 ingest、项目删除、存量归集共用，避免 documentsPlugin
 * 反向依赖 api-router（那会形成环）。
 *
 * 文件夹仍是扁平一层：`projectId` 是归属维度，不是父级。缺省（空 / 缺键）= 默认目录。
 */
import fs from "node:fs";
import path from "node:path";
import { matchAiProduct } from "../shared/ai-products.js";
import { log } from "./logger.js";

export interface ConversationFolder {
  id: string;
  name: string;
  platform?: string;
  /** 缺省 = 默认目录。扁平一层，projectId 是归属维度不是父级。 */
  projectId?: string | null;
}

function escapeFrontmatterValue(val: string): string {
  if (val.includes('"') || val.includes("\n") || val.includes(":")) {
    return `"${val.replace(/"/g, '\\"')}"`;
  }
  return val;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

/** 只读 frontmatter 键，不解析正文——归集 / 删除必须保证正文一个字节都不动。 */
export function readFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
    meta[kv[1]] = val;
  }
  return meta;
}

function fmValue(raw: string | undefined): string | null {
  if (!raw || raw === "null") return null;
  return raw;
}

/**
 * 只改 `projectId` / `folderId` 两行。`projectId` 空则删键（缺键即默认目录）；
 * `folderId` 空则写成 `null`。正文与其它 frontmatter 原样保留。
 */
export function patchConversationProjectFields(
  content: string,
  patch: { projectId?: string | null; folderId?: string | null },
): string {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return content;
  const lines = match[1].split("\n");

  const apply = (key: string, value: string | null | undefined, removeWhenEmpty: boolean) => {
    if (value === undefined) return;
    const idx = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (!value && removeWhenEmpty) {
      if (idx >= 0) lines.splice(idx, 1);
      return;
    }
    const line = value ? `${key}: ${escapeFrontmatterValue(value)}` : `${key}: null`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  };

  if ("projectId" in patch) apply("projectId", patch.projectId ?? null, true);
  if ("folderId" in patch) apply("folderId", patch.folderId ?? null, false);

  return `---\n${lines.join("\n")}\n---\n${match[2]}`;
}

export function projectKeyOf(item: { projectId?: string | null }): string | null {
  return item.projectId ?? null;
}

export function normalizeConversationFolders(data: unknown): ConversationFolder[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((folder: any) => folder && typeof folder.id === "string")
    .map((folder: any) => ({
      id: String(folder.id),
      name: typeof folder.name === "string" ? folder.name : String(folder.id),
      ...(folder.platform ? { platform: String(folder.platform) } : {}),
      // 读取时把缺失字段归一为 null（存量零迁移：不因读取而改写磁盘）
      projectId: folder.projectId ? String(folder.projectId) : null,
    }));
}

export function readConversationFolders(dataDir: string): ConversationFolder[] {
  const foldersFile = path.join(dataDir, "folders.json");
  try {
    if (!fs.existsSync(foldersFile)) return [];
    return normalizeConversationFolders(JSON.parse(fs.readFileSync(foldersFile, "utf-8")));
  } catch {
    return [];
  }
}

export function writeConversationFolders(dataDir: string, folders: unknown): void {
  const foldersFile = path.join(dataDir, "folders.json");
  fs.writeFileSync(foldersFile, JSON.stringify(normalizeConversationFolders(folders), null, 2), "utf-8");
}

/**
 * 导入自动归类（spec conversation-projects §项目内的平台文件夹自动归类）：
 * platform 命中 **且** projectId 相同 才复用；未命中则在该项目下新建平台文件夹。
 * 清单外平台或 folders.json 异常时返回 null → 未分类。
 */
export function resolveAutoFolderId(
  convDir: string,
  platform: unknown,
  projectId?: string | null,
): string | null {
  if (typeof platform !== "string" || !platform) return null;
  const product = matchAiProduct(platform);
  if (!product) return null;
  const dataDir = path.dirname(convDir);
  const foldersFile = path.join(dataDir, "folders.json");
  const scope = projectId ?? null;
  try {
    const raw = JSON.parse(fs.readFileSync(foldersFile, "utf-8"));
    if (!Array.isArray(raw)) return null;
    const folders = raw as ConversationFolder[];
    const inScope = (folder: ConversationFolder) => projectKeyOf(folder) === scope;
    // 标准名文件夹优先，alias 文件夹仅在无标准名文件夹时沿用，避免新旧两处分裂
    const existing =
      folders.find((f) => inScope(f) && f.platform === product.name) ??
      folders.find((f) => inScope(f) && (product.aliases ?? []).includes(f.platform ?? "")) ??
      folders.find((f) => inScope(f) && f.name === product.name);
    if (existing?.id) return existing.id;
    const folder: ConversationFolder = {
      id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: product.name,
      platform: product.name,
      ...(scope ? { projectId: scope } : {}),
    };
    fs.writeFileSync(foldersFile, JSON.stringify([...folders, folder], null, 2), "utf-8");
    return folder.id;
  } catch {
    return null;
  }
}

/**
 * 删除项目时清理对话平面：删该项目下的对话文件夹，清空受影响对话的
 * `projectId` / `folderId`。内容一条都不删。
 */
export function clearConversationsForDeletedProject(dataDir: string, projectId: string): void {
  const foldersFile = path.join(dataDir, "folders.json");
  const convDir = path.join(dataDir, "conversations");

  let folders: ConversationFolder[] = [];
  if (fs.existsSync(foldersFile)) {
    try {
      folders = normalizeConversationFolders(JSON.parse(fs.readFileSync(foldersFile, "utf-8")));
    } catch {
      folders = [];
    }
  }
  const removedFolderIds = new Set(
    folders.filter((folder) => projectKeyOf(folder) === projectId).map((folder) => folder.id),
  );
  const kept = folders.filter((folder) => projectKeyOf(folder) !== projectId);
  if (fs.existsSync(foldersFile) || removedFolderIds.size > 0) {
    fs.writeFileSync(foldersFile, JSON.stringify(kept, null, 2), "utf-8");
  }

  if (!fs.existsSync(convDir)) return;
  for (const name of fs.readdirSync(convDir).filter((file) => file.endsWith(".md"))) {
    try {
      const filePath = path.join(convDir, name);
      const content = fs.readFileSync(filePath, "utf-8");
      const meta = readFrontmatter(content);
      if (!meta) continue;
      const convProject = fmValue(meta.projectId);
      const convFolder = fmValue(meta.folderId);
      if (convProject !== projectId && !(convFolder && removedFolderIds.has(convFolder))) continue;
      const patched = patchConversationProjectFields(content, { projectId: null, folderId: null });
      if (patched !== content) fs.writeFileSync(filePath, patched, "utf-8");
    } catch (error) {
      log.warn(`skip conversation ${name} while deleting project ${projectId}: ${String(error)}`);
    }
  }
}
