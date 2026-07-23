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
  };
}

export function mergeFolderBundleIntoDataDir(dataDir: string, source: FolderBundle) {
  const foldersFile = path.join(dataDir, "folders.json");
  const documentFoldersFile = path.join(dataDir, "document-folders.json");
  const mergedFolders = mergeFolderArrays(normalizeFolders(source.folders), readJsonArray(foldersFile));
  const mergedDocumentFolders = mergeFolderArrays(normalizeFolders(source.documentFolders), readJsonArray(documentFoldersFile));
  fs.writeFileSync(foldersFile, JSON.stringify(mergedFolders, null, 2), "utf-8");
  fs.writeFileSync(documentFoldersFile, JSON.stringify(mergedDocumentFolders, null, 2), "utf-8");
  return {
    folders: { source: normalizeFolders(source.folders).length, result: mergedFolders.length },
    documentFolders: { source: normalizeFolders(source.documentFolders).length, result: mergedDocumentFolders.length },
  };
}

