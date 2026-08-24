import { defaultCursorDb, resolveUserPath } from "../config.js";
import { createQueryAdapter } from "../sqlite.js";
import type { CollectorAdapter } from "../types.js";

const COMPOSER_PREFIX = "composerData:";

/**
 * Cursor 会话库（globalStorage/state.vscdb 的 cursorDiskKV 表，spec US-06）。
 * composerData:<uuid> 持会话与消息头清单，消息体在 bubbleId:<uuid>:<bubbleId>。
 * 查询一律按 key 前缀走索引，禁止全表扫描 value（spec §5 边界 6）；
 * 信封只投影 bubbleId/type/text，会话内嵌的代码块缓存等大块数据不出库。
 */
export function createCursorAdapter(db = defaultCursorDb()): CollectorAdapter {
  const dbPath = resolveUserPath(db);
  return createQueryAdapter({
    platform: "cursor",
    dbPath,
    listSessions(database) {
      const rows = database
        .prepare(
          `select key,
                  coalesce(json_extract(value, '$.lastUpdatedAt'), json_extract(value, '$.createdAt'), 0) as updated,
                  json_array_length(coalesce(json_extract(value, '$.fullConversationHeadersOnly'), '[]')) as count
           from cursorDiskKV where key like '${COMPOSER_PREFIX}%'`,
        )
        .all();
      return rows
        .filter((row: any) => Number(row.count) > 0)
        .map((row: any) => ({
          id: String(row.key).slice(COMPOSER_PREFIX.length),
          mtimeMs: Number(row.updated) || 0,
          size: Number(row.count),
        }));
    },
    buildEnvelope(database, sessionId) {
      const row = database
        .prepare("select value from cursorDiskKV where key = ?")
        .get(`${COMPOSER_PREFIX}${sessionId}`);
      if (!row?.value) return null;
      let composer: any;
      try {
        composer = JSON.parse(String(row.value));
      } catch {
        return null;
      }
      const headers: any[] = Array.isArray(composer?.fullConversationHeadersOnly)
        ? composer.fullConversationHeadersOnly
        : [];
      const bubbleStmt = database.prepare("select value from cursorDiskKV where key = ?");
      const messages: any[] = [];
      for (const header of headers) {
        if (!header?.bubbleId) continue;
        const bubbleRow = bubbleStmt.get(`bubbleId:${sessionId}:${header.bubbleId}`);
        if (!bubbleRow?.value) continue; // 老会话的气泡可能已被清理：跳过缺失项
        let bubble: any;
        try {
          bubble = JSON.parse(String(bubbleRow.value));
        } catch {
          continue;
        }
        messages.push({ bubbleId: String(header.bubbleId), type: bubble?.type, text: bubble?.text ?? "" });
      }
      if (messages.length === 0) return null;
      const session = {
        composerId: composer?.composerId ?? sessionId,
        name: composer?.name,
        createdAt: composer?.createdAt,
        lastUpdatedAt: composer?.lastUpdatedAt,
        _v: composer?._v,
      };
      return { schema: "cursor-v1", session, messages };
    },
    resolveCwd(database, sessionId) {
      const row = database.prepare("select value from cursorDiskKV where key = ?").get(`${COMPOSER_PREFIX}${sessionId}`) as { value?: unknown } | undefined;
      if (!row?.value) return undefined;
      try {
        const composer = JSON.parse(String(row.value));
        const cwd = composer?.cwd ?? composer?.directory;
        return typeof cwd === "string" ? cwd : undefined;
      } catch {
        return undefined;
      }
    },
  });
}
