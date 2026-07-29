/**
 * docs-scan.ts —— 文档推送的**唯一**扫描/推导实现（spec collector-docs-push）。
 *
 * `docs` adapter（常驻，走引擎差量快照）与 `pentou push docs`（一次性全量）
 * 共用本模块，两个入口不得各写一套规则——否则会埋下"push 上去的和 watch 上去的
 * 不一样"的 bug（design 决策 11，同 src/shared/raw-dispatch.ts 的先例）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../config.js";
import type { IngestItem, SessionFile } from "../types.js";
import { walkFiles } from "./walk.js";

/** 文档来源的固定 platform slug；服务端据此走文档分支。 */
export const DOCS_PLATFORM = "docs";

/**
 * 内置跳过的目录：构建产物与依赖树里的 md 是噪音（README of node_modules 等），
 * 用户 exclude 规则在此之上叠加生效。
 */
export const DOCS_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-server",
  "build",
  ".next",
  "coverage",
  ".venv",
]);

export interface DocsDirEntry {
  /** 登记目录（可含 `~`，推导时统一展开为绝对路径）。 */
  path: string;
  /** 项目身份键；缺省取登记目录 basename。 */
  project?: string;
}

export interface ResolvedDocsEntry {
  /** 展开后的登记目录绝对路径，同时作为 project.rootPath 上报。 */
  root: string;
  /** 不可变的项目身份键（sourceKey）。 */
  projectKey: string;
}

export function isMarkdownFile(name: string): boolean {
  return path.extname(name).toLowerCase() === ".md";
}

/** 项目 key：显式 `project` 优先，缺省取登记目录 basename（design 决策 5）。 */
export function resolveDocsEntry(entry: DocsDirEntry): ResolvedDocsEntry {
  const root = resolveUserPath(entry.path);
  const explicit = (entry.project ?? "").trim();
  return { root, projectKey: explicit || path.basename(root) };
}

export async function discoverDocs(entries: DocsDirEntry[]): Promise<SessionFile[]> {
  const files: SessionFile[] = [];
  for (const entry of entries) {
    const { root } = resolveDocsEntry(entry);
    const found = await walkFiles(root, isMarkdownFile, {
      acceptDir: (name) => !DOCS_SKIP_DIRS.has(name),
    });
    files.push(...found.map((file) => ({ path: file, platform: DOCS_PLATFORM })));
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** 给定文件路径，找出登记它的条目（最长根路径优先，支持嵌套登记）。 */
export function entryForFile(entries: DocsDirEntry[], file: string): DocsDirEntry | null {
  const resolved = path.resolve(file);
  let best: { entry: DocsDirEntry; length: number } | null = null;
  for (const entry of entries) {
    const { root } = resolveDocsEntry(entry);
    if (resolved === root || resolved.startsWith(root + path.sep)) {
      if (!best || root.length > best.length) best = { entry, length: root.length };
    }
  }
  return best?.entry ?? null;
}

/** 标题：frontmatter `title` > 正文首个一级标题 > 文件名去扩展名。 */
export function deriveDocTitle(content: string, file: string): string {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter) {
    const line = frontmatter[1].split(/\r?\n/).find((candidate) => /^title:\s*/.test(candidate));
    if (line) {
      let value = line.slice(line.indexOf(":") + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  }
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading?.[1]?.trim()) return heading[1].trim();
  return path.basename(file, path.extname(file));
}

/**
 * externalId = `<项目 key>/<相对登记目录的路径>`，分隔符统一归一为 `/`，
 * 使同一份文件在 macOS / Windows 上生成完全相同的键。
 */
export function deriveDocExternalId(projectKey: string, root: string, file: string): string {
  const relative = path.relative(root, path.resolve(file)).split(path.sep).join("/");
  return `${projectKey}/${relative}`;
}

/**
 * 路径是否落在内置跳过的目录里。walk 阶段已剪枝，但 watch 事件是按路径直达的，
 * 必须在 toItem 再挡一次，否则 `node_modules/**` 的写入会被上报。
 */
export function isSkippedDocsPath(root: string, file: string): boolean {
  const relative = path.relative(root, path.resolve(file));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return true;
  const segments = relative.split(path.sep);
  return segments.slice(0, -1).some((segment) => DOCS_SKIP_DIRS.has(segment));
}

export async function toDocumentItem(file: string, entry: DocsDirEntry): Promise<IngestItem | null> {
  if (!isMarkdownFile(file)) return null;
  const { root, projectKey } = resolveDocsEntry(entry);
  if (isSkippedDocsPath(root, file)) return null;
  const body = await fs.readFile(file, "utf-8");
  return {
    platform: DOCS_PLATFORM,
    externalId: deriveDocExternalId(projectKey, root, file),
    format: "document",
    data: {
      title: deriveDocTitle(body, file),
      body,
      // rootPath 只在服务端**创建**项目那一刻被消费，用于初始化描述；
      // 命中已有项目时不回写，用户改过的描述不被覆盖（design 决策 5）。
      project: { key: projectKey, name: projectKey, rootPath: root },
    },
    filename: path.basename(file),
  };
}
