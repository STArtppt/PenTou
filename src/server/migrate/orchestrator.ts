import { randomUUID } from "node:crypto";
import { compareMigrationManifests, createMigrationManifest, readManifestFile } from "./manifest.js";
import { finalizeMigrationReceiver, mergeMigrationFolders, receiveMigrationFile } from "./receiver.js";
import { readFolderBundle } from "./merge-folders.js";
import {
  MIGRATION_SCHEMA_VERSION,
  type ConflictResolution,
  type FolderBundle,
  type ManifestEntry,
  type MigrationManifest,
  type MigrationPeerRequest,
  type MigrationPlan,
  type MigrationProgress,
  type MigrationRunRequest,
  type MigrationRunResult,
} from "./types.js";

const BATCH_MAX_FILES = 200;
const BATCH_MAX_BYTES = 32 * 1024 * 1024;

let lastProgress: MigrationProgress = { stage: "idle", transferred: 0, total: 0, skipped: 0, failures: [] };

export function getMigrationProgress(): MigrationProgress {
  return lastProgress;
}

function setProgress(patch: Partial<MigrationProgress>): void {
  lastProgress = { ...lastProgress, ...patch };
}

function normalizeRemoteUrl(raw: string): string {
  const url = new URL(raw);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const m = host.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

export function getInsecureTransportWarning(remoteUrl: string): string | null {
  const parsed = new URL(remoteUrl);
  if (parsed.protocol !== "http:") return null;
  if (isPrivateHost(parsed.hostname)) return null;
  return "Data will be transferred in clear text. HTTPS is recommended.";
}

function assertSchemaCompatible(manifest: MigrationManifest): void {
  const major = Math.floor(manifest.schemaVersion);
  if (major !== MIGRATION_SCHEMA_VERSION) {
    throw new Error(`incompatible migration schema: ${manifest.schemaVersion}`);
  }
}

function cookieFromResponse(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return "";
  return setCookie.split(",").map((part) => part.split(";")[0].trim()).filter((part) => part.startsWith("pentou_session=")).join("; ");
}

class MigrationPeer {
  private cookie = "";

  constructor(private readonly baseUrl: string, private readonly password = "") {}

  async login(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: this.password }),
    });
    if (!res.ok && res.status !== 204) throw new Error(res.status === 401 ? "authentication failed" : `login failed: ${res.status}`);
    this.cookie = cookieFromResponse(res);
  }

  async request(path: string, init?: RequestInit): Promise<Response> {
    let res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 401 && this.password) {
      await this.login();
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(this.cookie ? { Cookie: this.cookie } : {}),
          ...(init?.headers ?? {}),
        },
      });
    }
    return res;
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path, init);
    if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }
}

function makePeer(req: MigrationPeerRequest): MigrationPeer {
  return new MigrationPeer(normalizeRemoteUrl(req.remoteUrl), req.password ?? "");
}

export async function testMigrationPeer(dataDir: string, req: MigrationPeerRequest, pentouVersion: string): Promise<any> {
  setProgress({ stage: "testing", transferred: 0, total: 0, skipped: 0, failures: [], startedAt: new Date().toISOString() });
  const warning = getInsecureTransportWarning(req.remoteUrl);
  if (warning && !req.allowInsecure) {
    setProgress({ stage: "error", message: warning, finishedAt: new Date().toISOString() });
    return { ok: false, error: "insecure_http", warning };
  }
  try {
    const peer = makePeer(req);
    await peer.login();
    const manifest = await peer.json<MigrationManifest>("/api/migrate/manifest");
    assertSchemaCompatible(manifest);
    const local = createMigrationManifest(dataDir, pentouVersion);
    assertSchemaCompatible(local);
    setProgress({ stage: "done", message: "Connection ready", finishedAt: new Date().toISOString() });
    return { ok: true, warning, remote: { schemaVersion: manifest.schemaVersion, pentouVersion: manifest.pentouVersion, entries: manifest.entries.length } };
  } catch (e: any) {
    const error = String(e?.message ?? e);
    setProgress({ stage: "error", message: error, finishedAt: new Date().toISOString() });
    return { ok: false, error };
  }
}

export async function createMigrationPlan(dataDir: string, req: MigrationPeerRequest, pentouVersion: string): Promise<MigrationPlan & { warning: string | null }> {
  setProgress({ stage: "planning", transferred: 0, total: 0, skipped: 0, failures: [], startedAt: new Date().toISOString() });
  const warning = getInsecureTransportWarning(req.remoteUrl);
  if (warning && !req.allowInsecure) throw new Error(warning);

  const peer = makePeer(req);
  await peer.login();
  const localManifest = createMigrationManifest(dataDir, pentouVersion);
  const remoteManifest = await peer.json<MigrationManifest>("/api/migrate/manifest");
  assertSchemaCompatible(localManifest);
  assertSchemaCompatible(remoteManifest);

  const source = req.direction === "push" ? localManifest : remoteManifest;
  const target = req.direction === "push" ? remoteManifest : localManifest;
  const plan = compareMigrationManifests(source, target);
  setProgress({ stage: "done", skipped: plan.skips, message: "Plan ready", finishedAt: new Date().toISOString() });
  return { ...plan, warning };
}

function entryMap(entries: ManifestEntry[]): Map<string, ManifestEntry> {
  return new Map(entries.map((entry) => [entry.path, entry]));
}

function selectedPaths(plan: MigrationPlan, resolutions: Map<string, ConflictResolution>): string[] {
  const paths = [...plan.adds];
  for (const conflict of plan.conflicts) {
    if (resolutions.get(conflict.path) === "overwrite") paths.push(conflict.path);
  }
  return paths;
}

function makeBatches(paths: string[], entries: Map<string, ManifestEntry>): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const item of paths) {
    const entry = entries.get(item);
    const nextSize = entry?.size ?? 0;
    if (current.length > 0 && (current.length >= BATCH_MAX_FILES || size + nextSize > BATCH_MAX_BYTES)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += nextSize;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function pushBatch(dataDir: string, peer: MigrationPeer, taskId: string, batch: string[], sourceEntries: Map<string, ManifestEntry>) {
  const files = [];
  const failures = [];
  for (const item of batch) {
    const planned = sourceEntries.get(item);
    if (!planned) {
      failures.push({ path: item, reason: "missing from source manifest" });
      continue;
    }
    try {
      const { buffer, entry } = readManifestFile(dataDir, item);
      if (entry.hash !== planned.hash) {
        failures.push({ path: item, reason: "source changed after preview" });
        continue;
      }
      files.push({ path: item, hash: planned.hash, data: buffer.toString("base64") });
    } catch (e: any) {
      failures.push({ path: item, reason: String(e?.message ?? e) });
    }
  }
  if (files.length === 0) return { ok: [], failures };
  const response = await peer.json<{ results: Array<{ path: string; ok: boolean; reason?: string }> }>("/api/migrate/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, files }),
  });
  return {
    ok: response.results.filter((item) => item.ok).map((item) => item.path),
    failures: [...failures, ...response.results.filter((item) => !item.ok).map((item) => ({ path: item.path, reason: item.reason ?? "write failed" }))],
  };
}

async function pullBatch(dataDir: string, peer: MigrationPeer, taskId: string, batch: string[], sourceEntries: Map<string, ManifestEntry>) {
  const response = await peer.json<{ files: Array<{ path: string; hash: string; data: string }>; failures?: Array<{ path: string; reason: string }> }>("/api/migrate/files/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths: batch }),
  });
  const failures = [...(response.failures ?? [])];
  const ok: string[] = [];
  for (const file of response.files) {
    const planned = sourceEntries.get(file.path);
    if (!planned || file.hash !== planned.hash) {
      failures.push({ path: file.path, reason: "source changed after preview" });
      continue;
    }
    const result = receiveMigrationFile(dataDir, taskId, {
      path: file.path,
      expectedHash: planned.hash,
      data: Buffer.from(file.data, "base64"),
    });
    if (result.ok) ok.push(file.path);
    else failures.push({ path: file.path, reason: result.reason ?? "write failed" });
  }
  return { ok, failures };
}

export async function runMigration(dataDir: string, req: MigrationRunRequest, pentouVersion: string): Promise<MigrationRunResult> {
  const started = Date.now();
  const taskId = randomUUID();
  const failures = [];
  try {
    const plan = await createMigrationPlan(dataDir, req, pentouVersion);
    const resolutions = new Map((req.conflicts ?? []).map((item) => [item.path, item.resolution]));
    const paths = selectedPaths(plan, resolutions);
    const sourceEntries = entryMap(plan.sourceEntries);
    const batches = makeBatches(paths, sourceEntries);
    setProgress({ stage: "transferring", transferred: 0, total: paths.length, skipped: plan.skips + plan.conflicts.length - paths.length + plan.adds.length, failures: [] });

    const peer = makePeer(req);
    await peer.login();
    let transferred = 0;
    for (const batch of batches) {
      const result = req.direction === "push"
        ? await pushBatch(dataDir, peer, taskId, batch, sourceEntries)
        : await pullBatch(dataDir, peer, taskId, batch, sourceEntries);
      transferred += result.ok.length;
      failures.push(...result.failures);
      setProgress({ transferred, failures: [...failures], message: `Transferred ${transferred}/${paths.length}` });
      if (failures.length >= 10) throw new Error("too many file failures");
    }

    setProgress({ stage: "merging-folders", message: "Merging folders" });
    if (req.direction === "push") {
      await peer.json("/api/migrate/merge-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readFolderBundle(dataDir)),
      });
      await peer.json("/api/migrate/finalize", { method: "POST" });
    } else {
      const remoteFolders = await peer.json<FolderBundle>("/api/migrate/folders");
      mergeMigrationFolders(dataDir, remoteFolders);
      setProgress({ stage: "finalizing", message: "Finalizing local library" });
      finalizeMigrationReceiver(dataDir);
    }

    const result: MigrationRunResult = {
      ok: failures.length === 0,
      stage: "done",
      transferred,
      total: paths.length,
      skipped: plan.skips + plan.conflicts.length - (paths.length - plan.adds.length),
      failures,
      message: failures.length === 0 ? "Migration completed" : "Migration completed with failures",
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    };
    lastProgress = result;
    return result;
  } catch (e: any) {
    const result: MigrationRunResult = {
      ok: false,
      stage: "error",
      transferred: lastProgress.transferred,
      total: lastProgress.total,
      skipped: lastProgress.skipped,
      failures,
      message: String(e?.message ?? e),
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    };
    lastProgress = result;
    return result;
  }
}

