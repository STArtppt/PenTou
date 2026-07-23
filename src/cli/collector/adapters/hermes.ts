import { defaultHermesDb, resolveUserPath } from "../config.js";
import { createQueryAdapter } from "../sqlite.js";
import type { CollectorAdapter } from "../types.js";

/**
 * Hermes 共库（~/.hermes/state.db，桌面与 CLI 同源，spec US-05）。
 * sessions.started_at / messages.timestamp 为 epoch 秒（REAL）。
 * 快照 size 用 message_count：会话增长即触发重传。
 */
export function createHermesAdapter(db = defaultHermesDb()): CollectorAdapter {
  const dbPath = resolveUserPath(db);
  return createQueryAdapter({
    platform: "hermes",
    dbPath,
    listSessions(database) {
      const rows = database
        .prepare("select id, started_at, message_count from sessions")
        .all();
      return rows
        .filter((row: any) => Number(row.message_count) > 0)
        .map((row: any) => ({
          id: String(row.id),
          mtimeMs: Math.round((Number(row.started_at) || 0) * 1000),
          size: Number(row.message_count),
        }));
    },
    buildEnvelope(database, sessionId) {
      const session = database
        .prepare("select id, title, cwd, started_at, ended_at, message_count from sessions where id = ?")
        .get(sessionId);
      if (!session) return null;
      const messages = database
        .prepare(
          `select role, content, timestamp from messages
           where session_id = ? and active = 1
             and role in ('user', 'assistant')
             and content is not null and content != ''
           order by timestamp, id`,
        )
        .all(sessionId);
      if (messages.length === 0) return null;
      return { schema: "hermes-v1", session, messages };
    },
  });
}
