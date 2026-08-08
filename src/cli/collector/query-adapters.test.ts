/**
 * SQLite 查询型 adapter 测试（spec collector-source-expansion US-03/04/05/06）。
 * 用 node:sqlite 造临时库；运行环境即 CLI 的目标环境，无 node:sqlite 时跳过
 * （能力探测本身另有断言）。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOpencodeAdapter } from "./adapters/opencode";
import { createCopilotAdapter, parseSqliteUtc } from "./adapters/copilot";
import { createHermesAdapter } from "./adapters/hermes";
import { createCursorAdapter } from "./adapters/cursor";
import { isVirtualKey, makeSessionKey, parseSessionKey, sqliteAvailable } from "./sqlite";

const sqlite: any = (process as any).getBuiltinModule?.("node:sqlite");
const runIf = sqlite ? describe : describe.skip;

function tmpDb(name: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pentou-sql-")), name);
}

function createDb(file: string, ddlAndSeed: (db: any) => void): void {
  const db = new sqlite.DatabaseSync(file);
  ddlAndSeed(db);
  db.close();
}

describe("sqlite virtual keys", () => {
  it("roundtrips db path and session id (incl. # in id)", () => {
    const key = makeSessionKey("/tmp/a.db", "sess#1");
    expect(isVirtualKey(key)).toBe(true);
    expect(parseSessionKey(key)).toEqual({ dbPath: "/tmp/a.db", sessionId: "sess#1" });
    expect(parseSessionKey("/tmp/plain.jsonl")).toBeNull();
  });

  it("reports node:sqlite availability", () => {
    expect(sqliteAvailable()).toBe(Boolean(sqlite));
  });
});

runIf("opencode adapter (US-03)", () => {
  function seed(file: string): void {
    createDb(file, (db) => {
      db.exec(`create table session (id text primary key, title text, directory text, time_created integer, time_updated integer);
               create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
               create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);`);
      db.exec(`insert into session values ('s1','Fix bug','/proj',1700000000000,1700000100000);
               insert into session values ('s2','Empty','/proj',1700000000000,1700000000000);
               insert into message values ('m1','s1',1700000001000,1700000001000,'{"role":"user","time":{"created":1700000001000}}');
               insert into message values ('m2','s1',1700000002000,1700000002000,'{"role":"assistant","time":{"created":1700000002000}}');
               insert into part values ('p1','m1','s1',1700000001000,1700000001000,'{"type":"text","text":"你好"}');
               insert into part values ('p2','m2','s1',1700000002000,1700000002000,'{"type":"text","text":"hi"}');
               insert into part values ('p3','m2','s1',1700000002500,1700000002500,'{"type":"step-start"}');`);
    });
  }

  it("discovers only non-empty sessions and assembles the envelope", async () => {
    const file = tmpDb("opencode.db");
    seed(file);
    const adapter = createOpencodeAdapter(file);
    expect(adapter.kind).toBe("query");

    const files = await adapter.discover();
    expect(files).toHaveLength(1); // s2 无消息不上报
    expect(parseSessionKey(files[0].path)?.sessionId).toBe("s1");

    const snapshot = await adapter.snapshot!(files[0].path);
    expect(snapshot).toEqual({ mtimeMs: 1700000100000, size: 2 });

    const item = await adapter.toItem(files[0].path);
    expect(item).toMatchObject({ platform: "opencode", externalId: "s1", format: "raw" });
    const raw = item!.data;
    const envelope = typeof raw === "string" ? JSON.parse(raw) : raw;
    expect(envelope.schema).toBe("opencode-v1");
    expect(envelope.session.title).toBe("Fix bug");
    expect(envelope.messages).toHaveLength(2);
    expect(envelope.messages[0].parts).toEqual([{ type: "text", text: "你好" }]);
    expect(envelope.messages[1].parts).toEqual([{ type: "text", text: "hi" }]); // step-start 不入信封
  });

  it("missing db discovers nothing", async () => {
    const adapter = createOpencodeAdapter(path.join(os.tmpdir(), "nonexistent-opencode.db"));
    expect(await adapter.discover()).toEqual([]);
    expect(adapter.watchRoots()).toEqual([]);
  });
});

runIf("copilot adapter (US-04)", () => {
  it("assembles session-store turns; parses sqlite utc timestamps", async () => {
    const file = tmpDb("session-store.db");
    createDb(file, (db) => {
      db.exec(`create table sessions (id text primary key, cwd text, repository text, host_type text, branch text, summary text, created_at text, updated_at text);
               create table turns (id integer primary key autoincrement, session_id text, turn_index integer, user_message text, assistant_response text, timestamp text);`);
      db.exec(`insert into sessions (id, cwd, summary, created_at, updated_at) values ('c1','/proj','帮助与指南','2026-07-14 01:58:03','2026-07-14 02:00:00');
               insert into sessions (id, cwd, created_at, updated_at) values ('c2','/proj','2026-07-14 01:00:00','2026-07-14 01:00:00');
               insert into turns (session_id, turn_index, user_message, assistant_response, timestamp) values ('c1',0,'你好，我能做什么','我能帮你…','2026-07-14 01:58:10');`);
    });
    const adapter = createCopilotAdapter(file);
    const files = await adapter.discover();
    expect(files).toHaveLength(1); // c2 无 turns

    const snapshot = await adapter.snapshot!(files[0].path);
    expect(snapshot!.size).toBe(1);
    expect(snapshot!.mtimeMs).toBe(Date.parse("2026-07-14T02:00:00Z"));

    const copilotRaw = (await adapter.toItem(files[0].path))!.data;
    const envelope = typeof copilotRaw === "string" ? JSON.parse(copilotRaw) : copilotRaw;
    expect(envelope.schema).toBe("copilot-v1");
    expect(envelope.messages[0]).toMatchObject({ turn_index: 0, user_message: "你好，我能做什么" });
  });

  it("parseSqliteUtc handles both sqlite datetime and ISO strings", () => {
    expect(parseSqliteUtc("2026-07-14 01:58:03")).toBe(Date.parse("2026-07-14T01:58:03Z"));
    expect(parseSqliteUtc("2026-07-14T01:58:03.161Z")).toBe(Date.parse("2026-07-14T01:58:03.161Z"));
    expect(parseSqliteUtc(null)).toBe(0);
  });
});

runIf("hermes adapter (US-05)", () => {
  it("uses started_at seconds and message_count; filters non-dialogue rows", async () => {
    const file = tmpDb("state.db");
    createDb(file, (db) => {
      db.exec(`create table sessions (id text primary key, title text, cwd text, started_at real, ended_at real, message_count integer);
               create table messages (id integer primary key autoincrement, session_id text, role text, content text, timestamp real, active integer default 1);`);
      db.exec(`insert into sessions values ('h1','任务','/proj',1783931422.2,null,3);
               insert into sessions values ('h2','空会话','/proj',1783931000.0,null,0);
               insert into messages (session_id, role, content, timestamp, active) values ('h1','user','提主题',1783931422.23,1);
               insert into messages (session_id, role, content, timestamp, active) values ('h1','assistant','',1783931426.4,1);
               insert into messages (session_id, role, content, timestamp, active) values ('h1','assistant','已完成',1783931437.0,1);`);
    });
    const adapter = createHermesAdapter(file);
    const files = await adapter.discover();
    expect(files).toHaveLength(1);
    expect(await adapter.snapshot!(files[0].path)).toEqual({ mtimeMs: 1783931422200, size: 3 });

    const hermesRaw = (await adapter.toItem(files[0].path))!.data;
    const envelope = typeof hermesRaw === "string" ? JSON.parse(hermesRaw) : hermesRaw;
    expect(envelope.schema).toBe("hermes-v1");
    expect(envelope.messages).toHaveLength(2); // 空 content 的 assistant 行不入信封
  });
});

runIf("cursor adapter (US-06)", () => {
  it("assembles bubbles by header order, skips missing bubbles and empty composers", async () => {
    const file = tmpDb("state.vscdb");
    createDb(file, (db) => {
      db.exec("create table cursorDiskKV (key text primary key, value blob)");
      const insert = db.prepare("insert into cursorDiskKV values (?, ?)");
      insert.run("composerData:comp-1", JSON.stringify({
        _v: 16,
        composerId: "comp-1",
        name: "调研会话",
        createdAt: 1752108314664,
        lastUpdatedAt: 1752109000000,
        fullConversationHeadersOnly: [
          { bubbleId: "b1", type: 1 },
          { bubbleId: "b-missing", type: 2 },
          { bubbleId: "b2", type: 2 },
        ],
      }));
      insert.run("bubbleId:comp-1:b1", JSON.stringify({ bubbleId: "b1", type: 1, text: "MCP 能做什么？" }));
      insert.run("bubbleId:comp-1:b2", JSON.stringify({ bubbleId: "b2", type: 2, text: "可以…" }));
      insert.run("composerData:comp-empty", JSON.stringify({ _v: 16, composerId: "comp-empty", fullConversationHeadersOnly: [] }));
      insert.run("unrelated:key", "{}");
    });
    const adapter = createCursorAdapter(file);
    const files = await adapter.discover();
    expect(files).toHaveLength(1); // 空 composer 不上报
    expect(await adapter.snapshot!(files[0].path)).toEqual({ mtimeMs: 1752109000000, size: 3 });

    const item = await adapter.toItem(files[0].path);
    expect(item).toMatchObject({ platform: "cursor", externalId: "comp-1" });
    const cursorRaw = item!.data;
    const envelope = typeof cursorRaw === "string" ? JSON.parse(cursorRaw) : cursorRaw;
    expect(envelope.schema).toBe("cursor-v1");
    expect(envelope.session).toMatchObject({ composerId: "comp-1", name: "调研会话" });
    expect(envelope.messages).toEqual([
      { bubbleId: "b1", type: 1, text: "MCP 能做什么？" },
      { bubbleId: "b2", type: 2, text: "可以…" },
    ]);
  });
});
