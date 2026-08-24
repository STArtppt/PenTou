import { defaultOpencodeDb, resolveUserPath } from "../config.js";
import { createQueryAdapter } from "../sqlite.js";
import type { CollectorAdapter } from "../types.js";

/**
 * OpenCode 会话库（~/.local/share/opencode/opencode.db，spec US-03）。
 * session / message / part 三表按会话组装信封；part 仅取 text 类型
 * （工具输出等大块支线不进对话正文，控制信封体积）。
 */
export function createOpencodeAdapter(db = defaultOpencodeDb()): CollectorAdapter {
  const dbPath = resolveUserPath(db);
  return createQueryAdapter({
    platform: "opencode",
    dbPath,
    listSessions(database) {
      const rows = database
        .prepare(
          `select s.id as id, s.time_updated as updated,
                  (select count(*) from message m where m.session_id = s.id) as count
           from session s`,
        )
        .all();
      return rows
        .filter((row: any) => Number(row.count) > 0)
        .map((row: any) => ({ id: String(row.id), mtimeMs: Number(row.updated) || 0, size: Number(row.count) }));
    },
    buildEnvelope(database, sessionId) {
      const session = database
        .prepare("select id, title, directory, time_created, time_updated from session where id = ?")
        .get(sessionId);
      if (!session) return null;
      const messageRows = database
        .prepare("select id, data, time_created from message where session_id = ? order by time_created, id")
        .all(sessionId);
      if (messageRows.length === 0) return null;
      const partRows = database
        .prepare(
          `select message_id, data from part
           where session_id = ? and json_extract(data, '$.type') = 'text'
           order by time_created, id`,
        )
        .all(sessionId);
      const partsByMessage = new Map<string, any[]>();
      for (const row of partRows) {
        const list = partsByMessage.get(String(row.message_id)) ?? [];
        list.push(safeJson(row.data));
        partsByMessage.set(String(row.message_id), list);
      }
      const messages = messageRows.map((row: any) => ({
        ...safeJson(row.data),
        id: String(row.id),
        time_created: Number(row.time_created) || undefined,
        parts: partsByMessage.get(String(row.id)) ?? [],
      }));
      return { schema: "opencode-v1", session, messages };
    },
    resolveCwd(database, sessionId) {
      const session = database.prepare("select directory from session where id = ?").get(sessionId) as { directory?: unknown } | undefined;
      return typeof session?.directory === "string" ? session.directory : undefined;
    },
  });
}

function safeJson(text: unknown): any {
  try {
    return JSON.parse(String(text));
  } catch {
    return {};
  }
}
