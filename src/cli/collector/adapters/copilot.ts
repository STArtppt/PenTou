import { defaultCopilotDb, resolveUserPath } from "../config.js";
import { createQueryAdapter } from "../sqlite.js";
import type { CollectorAdapter } from "../types.js";

/**
 * GitHub Copilot 共库（~/.copilot/session-store.db，桌面 app 与 CLI 同源，
 * spec US-04 / §4.5 决策 6-7）。主源 = sessions + turns（实施勘测决策：turns 是
 * 干净的 user/assistant 轮次对，events.jsonl 留作后续增强）。
 */
export function createCopilotAdapter(db = defaultCopilotDb()): CollectorAdapter {
  const dbPath = resolveUserPath(db);
  return createQueryAdapter({
    platform: "copilot",
    dbPath,
    listSessions(database) {
      const rows = database
        .prepare(
          `select s.id as id, s.updated_at as updated,
                  (select count(*) from turns t where t.session_id = s.id) as count
           from sessions s`,
        )
        .all();
      return rows
        .filter((row: any) => Number(row.count) > 0)
        .map((row: any) => ({
          id: String(row.id),
          mtimeMs: parseSqliteUtc(row.updated),
          size: Number(row.count),
        }));
    },
    buildEnvelope(database, sessionId) {
      const session = database
        .prepare("select id, cwd, repository, summary, created_at, updated_at from sessions where id = ?")
        .get(sessionId);
      if (!session) return null;
      const turns = database
        .prepare(
          `select turn_index, user_message, assistant_response, timestamp
           from turns where session_id = ? order by turn_index`,
        )
        .all(sessionId);
      if (turns.length === 0) return null;
      return { schema: "copilot-v1", session, messages: turns };
    },
    resolveCwd(database, sessionId) {
      const session = database.prepare("select cwd from sessions where id = ?").get(sessionId) as { cwd?: unknown } | undefined;
      return typeof session?.cwd === "string" ? session.cwd : undefined;
    },
  });
}

/** sqlite datetime('now') 产 "YYYY-MM-DD HH:MM:SS"（UTC 无时区标记）；ISO 串原样解析 */
export function parseSqliteUtc(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}
