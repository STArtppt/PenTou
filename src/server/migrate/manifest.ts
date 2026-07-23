import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MIGRATION_SCHEMA_VERSION, type ManifestEntry, type MigrationManifest } from "./types.js";

const INCLUDED_ROOTS = new Set(["conversations", "documents", "ai-chats", "assets"]);
const EXCLUDED_ROOTS = new Set([".qmd", "bin", "ingest", ".migrate-tmp"]);
const EXCLUDED_FILES = new Set(["index.db", ".session-secret", "folders.json", "document-folders.json"]);

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function isMigrationPathAllowed(relativePath: string): boolean {
  if (!relativePath || relativePath.includes("\0")) return false;
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));
  if (normalized !== relativePath.replace(/\\/g, "/")) return false;
  if (normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) return false;
  const [root] = normalized.split("/");
  if (!root || EXCLUDED_ROOTS.has(root)) return false;
  if (!INCLUDED_ROOTS.has(root)) return false;
  if (EXCLUDED_FILES.has(path.posix.basename(normalized))) return false;
  return true;
}

export function resolveMigrationPath(dataDir: string, relativePath: string): string {
  if (!isMigrationPathAllowed(relativePath)) throw new Error(`path not allowed: ${relativePath}`);
  const base = path.resolve(dataDir);
  const resolved = path.resolve(base, relativePath);
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`path traversal detected: ${relativePath}`);
  return resolved;
}

export function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function hashFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function readManifestFile(dataDir: string, relativePath: string): { buffer: Buffer; entry: ManifestEntry } {
  const filePath = resolveMigrationPath(dataDir, relativePath);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`not a file: ${relativePath}`);
  const buffer = fs.readFileSync(filePath);
  return {
    buffer,
    entry: {
      path: relativePath,
      hash: hashBuffer(buffer),
      size: stat.size,
      mtime: stat.mtimeMs,
    },
  };
}

function walkFiles(root: string, dir: string, out: ManifestEntry[]): void {
  if (!fs.existsSync(dir)) return;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    const rel = toPosixPath(path.relative(root, full));
    if (item.isDirectory()) {
      const [top] = rel.split("/");
      if (EXCLUDED_ROOTS.has(top)) continue;
      walkFiles(root, full, out);
      continue;
    }
    if (!item.isFile() || !isMigrationPathAllowed(rel)) continue;
    const stat = fs.statSync(full);
    out.push({
      path: rel,
      hash: hashFile(full),
      size: stat.size,
      mtime: stat.mtimeMs,
    });
  }
}

export function createMigrationManifest(dataDir: string, pentouVersion = "0.0.0"): MigrationManifest {
  const root = path.resolve(dataDir);
  const entries: ManifestEntry[] = [];
  for (const included of INCLUDED_ROOTS) walkFiles(root, path.join(root, included), entries);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    pentouVersion,
    generatedAt: new Date().toISOString(),
    entries,
  };
}

export function compareMigrationManifests(source: MigrationManifest, target: MigrationManifest) {
  const targetByPath = new Map(target.entries.map((entry) => [entry.path, entry]));
  const sourceByPath = new Map(source.entries.map((entry) => [entry.path, entry]));
  const adds: string[] = [];
  const conflicts = [];
  let skips = 0;

  for (const sourceEntry of source.entries) {
    const targetEntry = targetByPath.get(sourceEntry.path);
    if (!targetEntry) {
      adds.push(sourceEntry.path);
      continue;
    }
    if (targetEntry.hash === sourceEntry.hash) {
      skips += 1;
      continue;
    }
    conflicts.push({
      path: sourceEntry.path,
      sourceHash: sourceEntry.hash,
      targetHash: targetEntry.hash,
      sourceMtime: sourceEntry.mtime,
      targetMtime: targetEntry.mtime,
      sourceSize: sourceEntry.size,
      targetSize: targetEntry.size,
    });
  }

  let targetOnly = 0;
  for (const targetEntry of target.entries) {
    if (!sourceByPath.has(targetEntry.path)) targetOnly += 1;
  }

  return { adds, conflicts, skips, targetOnly, sourceEntries: source.entries, targetEntries: target.entries };
}

