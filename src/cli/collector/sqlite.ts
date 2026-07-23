/**
 * sqlite.ts — SQLite 查询型 adapter 的共享基座（spec collector-source-expansion §4.2/§4.3）。
 *
 * 用 Node 内置 node:sqlite 只读打开（决策 3：零新依赖），Node < 22.5 无此模块时
 * 查询型 adapter 整体禁用并提示，文件型不受影响（US-03 AC3）。
 * 每个会话以虚拟键 sqlite://<db>#<sessionId> 进入引擎的快照/上报流程。
 */
import fs from "node:fs";
import path from "node:path";
import type { CollectorAdapter, FileSnapshot, IngestItem, SessionFile } from "./types.js";

type SqliteDatabase = {
  prepare(sql: string): { all(...args: unknown[]): any[]; get(...args: unknown[]): any };
  close(): void;
};

let sqliteModule: any | null | undefined;

function loadSqlite(): any | null {
  if (sqliteModule === undefined) {
    // process.getBuiltinModule：同步取内置模块，Node 22.3+；再往前的版本本身也没有 node:sqlite
    sqliteModule = (process as any).getBuiltinModule?.("node:sqlite") ?? null;
  }
  return sqliteModule;
}

export function sqliteAvailable(): boolean {
  return loadSqlite() !== null;
}

export const SQLITE_UNAVAILABLE_HINT =
  "node:sqlite unavailable (need Node >= 22.5); SQLite adapters (opencode/copilot/hermes/cursor) disabled";

function openReadOnly(dbPath: string): SqliteDatabase {
  const mod = loadSqlite();
  if (!mod) throw new Error(SQLITE_UNAVAILABLE_HINT);
  return new mod.DatabaseSync(dbPath, { readOnly: true });
}

export const VIRTUAL_KEY_PREFIX = "sqlite://";

export function isVirtualKey(fileOrKey: string): boolean {
  return fileOrKey.startsWith(VIRTUAL_KEY_PREFIX);
}

export function makeSessionKey(dbPath: string, sessionId: string): string {
  return `${VIRTUAL_KEY_PREFIX}${dbPath}#${encodeURIComponent(sessionId)}`;
}

export function parseSessionKey(key: string): { dbPath: string; sessionId: string } | null {
  if (!isVirtualKey(key)) return null;
  const rest = key.slice(VIRTUAL_KEY_PREFIX.length);
  const hash = rest.lastIndexOf("#");
  if (hash <= 0) return null;
  return { dbPath: rest.slice(0, hash), sessionId: decodeURIComponent(rest.slice(hash + 1)) };
}

export interface QuerySessionMeta {
  id: string;
  /** 会话更新时间（epoch ms），进快照 mtimeMs */
  mtimeMs: number;
  /** 消息数，进快照 size；任一变化触发重传 */
  size: number;
}

export interface QueryAdapterSpec {
  platform: string;
  dbPath: string;
  /** 列出所有非空会话的差量快照元信息（空会话不上报，US-06 AC2 类边界） */
  listSessions(db: SqliteDatabase): QuerySessionMeta[];
  /** 组装单会话 JSON 信封（SqliteSessionEnvelope）；无有效消息返回 null */
  buildEnvelope(db: SqliteDatabase, sessionId: string): object | null;
}

const LIST_CACHE_TTL_MS = 5_000;

export function createQueryAdapter(spec: QueryAdapterSpec): CollectorAdapter {
  // discover / snapshot 在同一轮同步中会反复查会话清单，做短 TTL 缓存避免每键开库
  let listCache: { atMs: number; byId: Map<string, QuerySessionMeta> } | null = null;

  function withDb<T>(fn: (db: SqliteDatabase) => T): T {
    const db = openReadOnly(spec.dbPath);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  function listMetas(): Map<string, QuerySessionMeta> {
    if (listCache && Date.now() - listCache.atMs < LIST_CACHE_TTL_MS) return listCache.byId;
    const byId = new Map<string, QuerySessionMeta>();
    for (const meta of withDb((db) => spec.listSessions(db))) {
      byId.set(meta.id, meta);
    }
    listCache = { atMs: Date.now(), byId };
    return byId;
  }

  return {
    platform: spec.platform,
    kind: "query",
    async discover(): Promise<SessionFile[]> {
      if (!fs.existsSync(spec.dbPath)) return [];
      return [...listMetas().keys()]
        .map((id) => ({ path: makeSessionKey(spec.dbPath, id), platform: spec.platform }))
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    watchRoots() {
      // 监听 db 所在目录：捕获 <db> / <db>-wal 的 mtime 变化（决策 3）
      return fs.existsSync(spec.dbPath) ? [path.dirname(spec.dbPath)] : [];
    },
    async snapshot(fileOrKey: string): Promise<FileSnapshot | null> {
      const parsed = parseSessionKey(fileOrKey);
      if (!parsed || !fs.existsSync(spec.dbPath)) return null;
      const meta = listMetas().get(parsed.sessionId);
      return meta ? { mtimeMs: meta.mtimeMs, size: meta.size } : null;
    },
    async toItem(fileOrKey: string): Promise<IngestItem | null> {
      const parsed = parseSessionKey(fileOrKey);
      if (!parsed || !fs.existsSync(spec.dbPath)) return null;
      const envelope = withDb((db) => spec.buildEnvelope(db, parsed.sessionId));
      if (!envelope) return null;
      return {
        platform: spec.platform,
        externalId: parsed.sessionId,
        format: "raw",
        data: JSON.stringify(envelope),
      };
    },
  };
}
