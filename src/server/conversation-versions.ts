/**
 * conversation-versions.ts
 * 会话版本历史存储，对齐文档范式（<id>.versions/index.json + vN.md）。
 * spec: import-dedup-versioning §4.2 决策5。
 *
 * 版本 body 为该时刻的会话 Markdown（conversationToMd 输出），读取时由 api-router
 * 用 parseMdFile 解析回会话对象。本模块只做不透明 body 的文件读写，避免与
 * api-router 形成循环依赖。convDir 显式透传（不用模块级状态）。
 */
import fs from "node:fs";
import path from "node:path";

export interface ConvVersionEntry {
  id: string;
  version: number;
  type: string;
  createdAt: string;
  fileName: string;
  rolledBackFromVersionId?: string;
}

export interface ConvVersionIndex {
  version: number;
  currentVersionId: string;
  versions: ConvVersionEntry[];
}

function versionsDir(convDir: string, id: string): string {
  return path.join(convDir, `${id}.versions`);
}

function indexPath(convDir: string, id: string): string {
  return path.join(versionsDir(convDir, id), "index.json");
}

function nanoid5(): string {
  return Math.random().toString(36).slice(2, 7);
}

function newVersionId(): string {
  return `cver_${Date.now()}_${nanoid5()}`;
}

export function hasConvVersions(convDir: string, id: string): boolean {
  return fs.existsSync(indexPath(convDir, id));
}

export function readConvVersionIndex(convDir: string, id: string): ConvVersionIndex {
  return JSON.parse(fs.readFileSync(indexPath(convDir, id), "utf-8"));
}

function writeConvVersionIndex(convDir: string, id: string, index: ConvVersionIndex): void {
  fs.writeFileSync(indexPath(convDir, id), JSON.stringify(index, null, 2), "utf-8");
}

/** 首次为会话建立版本历史（v1）。已存在则跳过。 */
export function initConvVersions(
  convDir: string,
  id: string,
  body: string,
  type: string,
): ConvVersionEntry {
  const dir = versionsDir(convDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const vId = newVersionId();
  const createdAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, "v1.md"), body, "utf-8");
  const entry: ConvVersionEntry = { id: vId, version: 1, type, createdAt, fileName: "v1.md" };
  const index: ConvVersionIndex = { version: 1, currentVersionId: vId, versions: [entry] };
  writeConvVersionIndex(convDir, id, index);
  return entry;
}

export function appendConvVersion(
  convDir: string,
  id: string,
  params: { body: string; type: string; rolledBackFromVersionId?: string },
): ConvVersionEntry {
  const index = readConvVersionIndex(convDir, id);
  const nextNum = (index.versions.at(-1)?.version ?? 0) + 1;
  const vId = newVersionId();
  const createdAt = new Date().toISOString();
  const fileName = `v${nextNum}.md`;
  fs.writeFileSync(path.join(versionsDir(convDir, id), fileName), params.body, "utf-8");
  const entry: ConvVersionEntry = { id: vId, version: nextNum, type: params.type, createdAt, fileName };
  if (params.rolledBackFromVersionId) entry.rolledBackFromVersionId = params.rolledBackFromVersionId;
  index.versions.push(entry);
  writeConvVersionIndex(convDir, id, index);
  return entry;
}

export function updateConvCurrentPointer(convDir: string, id: string, versionId: string): void {
  const index = readConvVersionIndex(convDir, id);
  index.currentVersionId = versionId;
  writeConvVersionIndex(convDir, id, index);
}

export function readConvVersionBody(convDir: string, id: string, entry: ConvVersionEntry): string {
  const filePath = path.join(versionsDir(convDir, id), entry.fileName);
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf-8");
}

export function deleteConvVersions(convDir: string, id: string): void {
  const dir = versionsDir(convDir, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
