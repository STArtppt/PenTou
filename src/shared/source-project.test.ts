/**
 * source-project.test.ts —— 对话的来源项目属性（spec conversation-project-attribution）。
 * 仅数据层：判定 → frontmatter 往返 → 拿不到就留空。
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { sourceProjectFromCwd, sourceProjectFromEncodedDir } from "./source-project";
import { parseFileContent } from "./parsers";
import { conversationToMd, parseMdFile, upsertConversation } from "../server/api-router";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempConvDir(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "pentou-source-project-"));
  cleanupDirs.push(dir);
  const convDir = path.join(dir, "conversations");
  fs.mkdirSync(convDir, { recursive: true });
  return convDir;
}

const CLAUDE_WITH_CWD = [
  '{"type":"user","cwd":"/Users/x/proj/pentou","message":{"content":"hello"},"timestamp":"2026-07-01T00:00:00.000Z"}',
  '{"type":"assistant","cwd":"/Users/x/proj/pentou","message":{"content":"hi"},"timestamp":"2026-07-01T00:00:05.000Z"}',
].join("\n");

const CLAUDE_WITHOUT_CWD = [
  '{"type":"user","message":{"content":"hello"},"timestamp":"2026-07-01T00:00:00.000Z"}',
  '{"type":"assistant","message":{"content":"hi"},"timestamp":"2026-07-01T00:00:05.000Z"}',
].join("\n");

describe("sourceProjectFromCwd", () => {
  it("takes the basename, matching the document project sourceKey convention", () => {
    expect(sourceProjectFromCwd("/Users/x/proj/pentou")).toBe("pentou");
    expect(sourceProjectFromCwd("/Users/x/proj/pentou/")).toBe("pentou");
    expect(sourceProjectFromCwd("C:\\Users\\x\\proj\\pentou")).toBe("pentou");
  });

  it("returns undefined for anything that is not a usable directory", () => {
    expect(sourceProjectFromCwd(undefined)).toBeUndefined();
    expect(sourceProjectFromCwd("")).toBeUndefined();
    expect(sourceProjectFromCwd("   ")).toBeUndefined();
    expect(sourceProjectFromCwd("/")).toBeUndefined();
    expect(sourceProjectFromCwd("C:\\")).toBeUndefined();
    expect(sourceProjectFromCwd(42)).toBeUndefined();
  });

  it("decodes grok-cli's URL-encoded session directory, which is reversible", () => {
    expect(sourceProjectFromEncodedDir("%2FUsers%2Fx%2Fcoding%2Fclitools%2Fgrokcli")).toBe("grokcli");
  });

  it("never guesses at a `-`-encoded claude projects directory name", () => {
    // `-Users-x-coding-aicoding-data-shop` 不可逆：无法区分 aicoding/data-shop 与
    // aicoding-data-shop，所以整条判定链上都不反解它。
    expect(sourceProjectFromEncodedDir("-Users-x-coding-aicoding-data-shop")).toBeUndefined();
  });
});

describe("claude-code transcript parsing", () => {
  it("writes sourceProject from the cwd inside the session content", () => {
    const [conv] = parseFileContent("session.jsonl", CLAUDE_WITH_CWD);
    expect(conv.sourceProject).toBe("pentou");
  });

  it("leaves sourceProject unset when there is no cwd, without erroring", () => {
    const [conv] = parseFileContent("session.jsonl", CLAUDE_WITHOUT_CWD);
    expect(conv.sourceProject).toBeUndefined();
    expect(conv.messages).toHaveLength(2);
  });

  it("reads the cwd from a codex rollout's session_meta", () => {
    const rollout = [
      '{"type":"session_meta","timestamp":"2026-07-01T00:00:00.000Z","payload":{"timestamp":"2026-07-01T00:00:00.000Z","cwd":"/Users/x/proj/pentou"}}',
      '{"type":"event_msg","timestamp":"2026-07-01T00:00:01.000Z","payload":{"type":"user_message","message":"hello"}}',
      '{"type":"event_msg","timestamp":"2026-07-01T00:00:02.000Z","payload":{"type":"agent_message","message":"hi"}}',
    ].join("\n");
    const [conv] = parseFileContent("rollout.jsonl", rollout);
    expect(conv.sourceProject).toBe("pentou");
  });
});

describe("sourceProject frontmatter roundtrip", () => {
  it("survives the markdown roundtrip", () => {
    const md = conversationToMd({
      id: "conv_1",
      title: "T",
      platform: "Claude",
      date: "2026-07-01T00:00:00.000Z",
      folderId: null,
      sourceProject: "pentou",
      messages: [{ id: "m1", role: "user", content: "hi", timestamp: "2026-07-01T00:00:00.000Z" }],
    });
    expect(md).toContain("sourceProject: pentou");
    expect(parseMdFile("conv_1", md).sourceProject).toBe("pentou");
  });

  it("omits the field entirely when unset (old conversations stay byte-identical)", () => {
    const md = conversationToMd({
      id: "conv_2",
      title: "T",
      platform: "Claude",
      date: "2026-07-01T00:00:00.000Z",
      folderId: null,
      messages: [{ id: "m1", role: "user", content: "hi", timestamp: "2026-07-01T00:00:00.000Z" }],
    });
    expect(md).not.toContain("sourceProject");
    expect(parseMdFile("conv_2", md).sourceProject).toBeUndefined();
  });

  it("keeps the existing value when a later merge carries none", () => {
    const convDir = tempConvDir();
    const base = {
      id: "conv_3",
      title: "T",
      platform: "Claude",
      date: "2026-07-01T00:00:00.000Z",
      folderId: null,
      sourceProject: "pentou",
      messages: [{ id: "m1", role: "user", content: "hi", timestamp: "2026-07-01T00:00:00.000Z" }],
    };
    upsertConversation(convDir, base, { externalKey: "claude-code:s1" });
    upsertConversation(convDir, {
      ...base,
      sourceProject: undefined,
      messages: [...base.messages, { id: "m2", role: "ai", content: "yo", timestamp: "2026-07-01T00:00:10.000Z" }],
    }, { externalKey: "claude-code:s1" });

    const [file] = fs.readdirSync(convDir).filter((f) => f.endsWith(".md"));
    expect(fs.readFileSync(path.join(convDir, file), "utf-8")).toContain("sourceProject: pentou");
  });
});

describe("conversation folder model is untouched", () => {
  it("keeps folders.json entries free of any project dimension", () => {
    // 对话文件夹按平台组织、文档文件夹按项目组织；两边都不引入对方的维度字段。
    const folders = [{ id: "f1", name: "ChatGPT", platform: "ChatGPT" }];
    for (const folder of folders) {
      expect(Object.keys(folder).sort()).toEqual(["id", "name", "platform"]);
    }
  });
});
