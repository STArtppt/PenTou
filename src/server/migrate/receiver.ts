import fs from "node:fs";
import path from "node:path";
import { configureSearch, markStale } from "../search-service.js";
import { hashBuffer, resolveMigrationPath } from "./manifest.js";
import { mergeFolderBundleIntoDataDir } from "./merge-folders.js";
import type { FolderBundle, MigrationFailure } from "./types.js";

export interface ReceiveFileInput {
  path: string;
  data: Buffer;
  expectedHash: string;
}

export interface ReceiveFileResult {
  path: string;
  ok: boolean;
  reason?: string;
}

export function cleanupMigrationTmp(dataDir: string): void {
  const tmpRoot = path.join(dataDir, ".migrate-tmp");
  try {
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

export function receiveMigrationFile(dataDir: string, taskId: string, input: ReceiveFileInput): ReceiveFileResult {
  try {
    const actualHash = hashBuffer(input.data);
    if (actualHash !== input.expectedHash) {
      return { path: input.path, ok: false, reason: "received hash mismatch" };
    }
    const finalPath = resolveMigrationPath(dataDir, input.path);
    const tmpPath = path.join(dataDir, ".migrate-tmp", taskId, input.path);
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, input.data);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.renameSync(tmpPath, finalPath);
    markStale();
    return { path: input.path, ok: true };
  } catch (e: any) {
    return { path: input.path, ok: false, reason: String(e?.message ?? e) };
  }
}

export function mergeMigrationFolders(dataDir: string, source: FolderBundle) {
  const result = mergeFolderBundleIntoDataDir(dataDir, source);
  markStale();
  return result;
}

export function finalizeMigrationReceiver(dataDir: string): { ok: true; rebuiltIndex: boolean; failures: MigrationFailure[] } {
  cleanupMigrationTmp(dataDir);
  configureSearch(dataDir);
  markStale();
  return { ok: true, rebuiltIndex: true, failures: [] };
}

