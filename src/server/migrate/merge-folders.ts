import fs from "node:fs";
import path from "node:path";
import type { FolderBundle } from "./types.js";

function readJsonArray(filePath: string): unknown[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeFolders(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function mergeFolderArrays(source: unknown[], target: unknown[]): unknown[] {
  const byId = new Map<string, unknown>();
  const anonymous: unknown[] = [];

  for (const item of target) {
    const id = typeof (item as any)?.id === "string" ? (item as any).id : "";
    if (id) byId.set(id, item);
    else anonymous.push(item);
  }
  for (const item of source) {
    const id = typeof (item as any)?.id === "string" ? (item as any).id : "";
    if (id) byId.set(id, item);
    else anonymous.push(item);
  }
  return [...byId.values(), ...anonymous];
}

export function readFolderBundle(dataDir: string): FolderBundle {
  return {
    folders: readJsonArray(path.join(dataDir, "folders.json")),
    documentFolders: readJsonArray(path.join(dataDir, "document-folders.json")),
    // 项目清单与文件夹同批搬运。wire 字段名保持 documentProjects：它承载的是
    // 两平面共用的项目表（物理文件名是历史命名债），改名会让旧版本对端静默丢项目。
    // 对话文件夹条目里的 projectId 随 folders 数组一并搬运，不单独拆字段。
    documentProjects: readJsonArray(path.join(dataDir, "document-projects.json")),
  };
}

export function mergeFolderBundleIntoDataDir(dataDir: string, source: FolderBundle) {
  const foldersFile = path.join(dataDir, "folders.json");
  const documentFoldersFile = path.join(dataDir, "document-folders.json");
  const documentProjectsFile = path.join(dataDir, "document-projects.json");
  const mergedFolders = mergeFolderArrays(normalizeFolders(source.folders), readJsonArray(foldersFile));
  const mergedDocumentFolders = mergeFolderArrays(normalizeFolders(source.documentFolders), readJsonArray(documentFoldersFile));
  // 按 id 并集，与文件夹同口径：id 是文档 projectId 的指向，改 id 会让文档失去归属。
  // 代价是两端各自推送过同一个仓库时，会并排出现两个 sourceKey 相同的项目——
  // 这与两端各有一个同名文件夹的既有行为一致，交给用户在界面上合并。
  const mergedDocumentProjects = mergeFolderArrays(normalizeFolders(source.documentProjects), readJsonArray(documentProjectsFile));
  fs.writeFileSync(foldersFile, JSON.stringify(mergedFolders, null, 2), "utf-8");
  fs.writeFileSync(documentFoldersFile, JSON.stringify(mergedDocumentFolders, null, 2), "utf-8");
  fs.writeFileSync(documentProjectsFile, JSON.stringify(mergedDocumentProjects, null, 2), "utf-8");
  return {
    folders: { source: normalizeFolders(source.folders).length, result: mergedFolders.length },
    documentFolders: { source: normalizeFolders(source.documentFolders).length, result: mergedDocumentFolders.length },
    documentProjects: { source: normalizeFolders(source.documentProjects).length, result: mergedDocumentProjects.length },
  };
}

