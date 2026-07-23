import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { handleApiRequest } from "./api-router";
import { DOCS_DIR, setDocsDataDir } from "../../vite-plugins/documentsPlugin";
import { refreshNow, _resetForTest, _setEmbedFnForTest } from "./search-service";

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRelativeTempDataDir(): { abs: string; rel: string } {
  const abs = fs.mkdtempSync(path.join(tmpdir(), "pentou-api-router-"));
  cleanupDirs.push(abs);
  return { abs, rel: path.relative(process.cwd(), abs) };
}

async function callApi(params: {
  dataDir: string;
  method?: string;
  url: string;
  body?: unknown;
  rawBody?: Buffer;
  headers?: Record<string, string>;
}): Promise<{ status: number; body: any }> {
  const rawBuffer = params.rawBody ?? Buffer.from(params.body === undefined ? "" : JSON.stringify(params.body));
  const req = Readable.from(rawBuffer.length ? [rawBuffer] : []) as any;
  req.method = params.method ?? "GET";
  req.url = params.url;
  req.headers = params.headers ?? (rawBuffer.length ? { "content-type": "application/json", "content-length": String(rawBuffer.length) } : {});
  req.socket = { remoteAddress: "127.0.0.1" };

  let status = 200;
  let responseBody = "";
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  const res = {
    headersSent: false,
    writeHead(code: number) {
      status = code;
      this.headersSent = true;
      return this;
    },
    setHeader() {},
    end(chunk?: string | Buffer) {
      if (chunk) responseBody += chunk.toString();
      this.headersSent = true;
      resolveDone();
      return this;
    },
    write(chunk?: string | Buffer) {
      if (chunk) responseBody += chunk.toString();
      return true;
    },
  } as any;

  const handled = await handleApiRequest(req, res, { dataDir: params.dataDir });
  if (!handled) {
    status = 404;
    responseBody = JSON.stringify({ error: "not_found" });
    resolveDone();
  }
  await done;

  return { status, body: responseBody ? JSON.parse(responseBody) : undefined };
}

function multipartFiles(files: Array<{ name: string; content: string; type?: string }>): { rawBody: Buffer; headers: Record<string, string> } {
  const boundary = "----pentouApiRouterBoundary";
  const parts: Buffer[] = [];
  for (const file of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.type ?? "text/plain"}\r\n\r\n`,
    ));
    parts.push(Buffer.from(file.content));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const rawBody = Buffer.concat(parts);
  return {
    rawBody,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(rawBody.length) },
  };
}

describe("documents API dataDir handling", () => {
  it("normalizes relative document data dirs to absolute paths", () => {
    const { rel } = makeRelativeTempDataDir();

    expect(path.isAbsolute(rel)).toBe(false);
    setDocsDataDir(rel);

    expect(path.isAbsolute(DOCS_DIR)).toBe(true);
    expect(DOCS_DIR).toBe(path.join(path.resolve(rel), "documents"));
  });

  it("serves document detail routes when dataDir is relative", async () => {
    const { rel } = makeRelativeTempDataDir();
    const docId = "doc_1778662775895_reltest";

    const createRes = await callApi({
      dataDir: rel,
      method: "POST",
      url: "/api/documents",
      body: {
        id: docId,
        title: "Relative DATA_DIR regression",
        folderId: null,
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
        body: "# Hello\n\nContent",
      },
    });
    expect(createRes.status).toBe(201);

    const detailRes = await callApi({ dataDir: rel, url: `/api/documents/${docId}` });
    expect(detailRes.status).toBe(200);
    expect(detailRes.body).toMatchObject({ id: docId, body: "# Hello\n\nContent" });

    const annotationsRes = await callApi({ dataDir: rel, url: `/api/documents/${docId}/annotations` });
    expect(annotationsRes.status).toBe(200);
    expect(annotationsRes.body).toEqual({ version: 1, annotations: [] });
  });
});

describe("storage path API", () => {
  it("returns absolute markdown paths for conversations and documents", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    fs.mkdirSync(path.join(abs, "conversations"), { recursive: true });
    fs.mkdirSync(path.join(abs, "documents"), { recursive: true });
    fs.writeFileSync(path.join(abs, "conversations", "conv_1.md"), "---\nid: conv_1\n---\n", "utf-8");
    fs.writeFileSync(path.join(abs, "documents", "doc_1.md"), "---\nid: doc_1\n---\n", "utf-8");

    const conv = await callApi({ dataDir: rel, url: "/api/storage-paths/conversation/conv_1" });
    const doc = await callApi({ dataDir: rel, url: "/api/storage-paths/document/doc_1" });

    expect(conv).toEqual({ status: 200, body: { path: path.join(abs, "conversations", "conv_1.md") } });
    expect(doc).toEqual({ status: 200, body: { path: path.join(abs, "documents", "doc_1.md") } });
  });

  it("rejects invalid ids before resolving paths", async () => {
    const { rel } = makeRelativeTempDataDir();
    const res = await callApi({ dataDir: rel, url: "/api/storage-paths/conversation/../secret" });
    expect(res.status).toBe(400);
  });
});

describe("MinerU document import config and local converters", () => {
  it("GET/POST /api/mineru status/config keeps token server-side", async () => {
    const { rel, abs } = makeRelativeTempDataDir();

    const initial = await callApi({ dataDir: rel, url: "/api/mineru/status" });
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ configured: false, hasKey: false });

    const saved = await callApi({
      dataDir: rel,
      method: "POST",
      url: "/api/mineru/config",
      body: { apiToken: "mineru-secret" },
    });
    expect(saved.body).toEqual({ configured: true, hasKey: true });
    expect(saved.body.apiToken).toBeUndefined();

    await callApi({ dataDir: rel, method: "POST", url: "/api/mineru/config", body: { apiToken: "" } });
    expect(fs.readFileSync(path.join(abs, ".config", "mineru.json"), "utf-8")).toContain("mineru-secret");

    const cleared = await callApi({ dataDir: rel, method: "POST", url: "/api/mineru/config", body: { clear: true } });
    expect(cleared.body).toEqual({ configured: false, hasKey: false });
  });

  it("imports csv and xml locally without MinerU token", async () => {
    const { rel } = makeRelativeTempDataDir();
    const mp = multipartFiles([
      { name: "people.csv", content: 'name,city\n"Ada, A.","New York"\nBob,Shanghai\n' },
      { name: "feed.xml", content: "<root><item>ok</item></root>", type: "application/xml" },
    ]);

    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/import/document", ...mp });

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(2);
    expect(res.body.results[0].document.body).toContain("| name | city |");
    expect(res.body.results[0].document.body).toContain("| Ada, A. | New York |");
    expect(res.body.results[1].document.body).toContain("```xml\n<root><item>ok</item></root>\n```");
  });

  it("fails only MinerU formats when token is missing in a mixed batch", async () => {
    const { rel } = makeRelativeTempDataDir();
    const mp = multipartFiles([
      { name: "notes.md", content: "# Local" },
      { name: "scan.pdf", content: "%PDF" },
    ]);

    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/import/document", ...mp });

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);
    expect(res.body.failedCount).toBe(1);
    const byName = new Map(res.body.results.map((item: any) => [item.originalName, item]));
    expect(byName.get("notes.md")).toMatchObject({ originalName: "notes.md", success: true });
    expect(byName.get("scan.pdf")).toMatchObject({ originalName: "scan.pdf", success: false });
    expect(byName.get("scan.pdf").error).toContain("需配置 MinerU Token");
  });
});

describe("AI sidebar chat sessions API", () => {
  it("creates, lists, reads, and deletes AI chat markdown sessions", async () => {
    const { rel, abs } = makeRelativeTempDataDir();
    const session = {
      id: "chat_1778662775895_test",
      title: "Sidebar chat",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:01:00.000Z",
      model: "gpt-test",
      contextType: "doc",
      contextId: "doc_20260610_abcd",
      messages: [
        { id: "m1", role: "user", status: "done", content: "## user\n\nreal content" },
        { id: "m2", role: "assistant", status: "aborted", content: "partial answer" },
      ],
    };

    const save = await callApi({ dataDir: rel, method: "PUT", url: `/api/ai-chats/${session.id}`, body: session });
    expect(save.status).toBe(200);
    expect(fs.existsSync(path.join(abs, "ai-chats", `${session.id}.md`))).toBe(true);

    const list = await callApi({ dataDir: rel, url: "/api/ai-chats" });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject(session);

    const detail = await callApi({ dataDir: rel, url: `/api/ai-chats/${session.id}` });
    expect(detail.status).toBe(200);
    expect(detail.body.messages[0].content).toBe("## user\n\nreal content");

    const invalid = await callApi({ dataDir: rel, url: "/api/ai-chats/../secret" });
    expect(invalid.status).toBe(400);

    const deleted = await callApi({ dataDir: rel, method: "DELETE", url: `/api/ai-chats/${session.id}` });
    expect(deleted.status).toBe(200);
    expect(fs.existsSync(path.join(abs, "ai-chats", `${session.id}.md`))).toBe(false);
  });
});

describe("conversation import dedup + versioning", () => {
  const base = (over: any = {}) => ({
    id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: "Trip plan",
    platform: "ChatGPT",
    date: "2026-06-01T00:00:00.000Z",
    folderId: null,
    messages: [
      { id: "m1", role: "user", content: "Plan a trip to Kyoto", timestamp: "2026-06-01T00:00:00.000Z" },
      { id: "m2", role: "ai", content: "Sure, here is a plan...", timestamp: "2026-06-01T00:00:01.000Z" },
    ],
    ...over,
  });

  it("creates a new conversation with v1 import version", async () => {
    const { rel } = makeRelativeTempDataDir();
    const conv = base();
    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: conv });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ action: "created", id: conv.id });

    const versions = await callApi({ dataDir: rel, url: `/api/conversations/${conv.id}/versions` });
    expect(versions.status).toBe(200);
    expect(versions.body.versions).toHaveLength(1);
    expect(versions.body.versions[0].type).toBe("import");
  });

  it("returns the normalized created conversation so imported state matches reload", async () => {
    const { rel } = makeRelativeTempDataDir();
    const conv = base({
      messages: [
        { id: "m1", role: "user", content: "新手如何使用hermes", timestamp: "2026-06-17T02:25:00.000Z" },
        { id: "m2", role: "ai", content: "好的！让我先看看你的 Hermes 当前状态。", timestamp: "2026-06-17T02:26:00.000Z" },
        { id: "m3", role: "ai", content: "你已经安装好了 Hermes v0.16.0。", timestamp: "2026-06-17T02:26:30.000Z" },
      ],
    });

    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: conv });

    expect(res.status).toBe(201);
    expect(res.body.conversation.messages.map((m: any) => [m.role, m.content])).toEqual([
      ["user", "新手如何使用hermes"],
      ["ai", "好的！让我先看看你的 Hermes 当前状态。\n\n你已经安装好了 Hermes v0.16.0。"],
    ]);

    const detail = await callApi({ dataDir: rel, url: `/api/conversations/${conv.id}` });
    expect(res.body.conversation.messages).toEqual(detail.body.messages);
  });

  it("merges an incremental re-export into the existing conversation (new version, no new entry)", async () => {
    const { rel } = makeRelativeTempDataDir();
    const conv = base();
    await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: conv });

    // Same U1/title/platform, more turns, different id → should merge into existing
    const grown = base({
      id: `conv_grown_${Math.random().toString(36).slice(2, 7)}`,
      messages: [
        ...conv.messages,
        { id: "m3", role: "user", content: "Add day 2", timestamp: "2026-06-02T00:00:00.000Z" },
        { id: "m4", role: "ai", content: "Day 2: ...", timestamp: "2026-06-02T00:00:01.000Z" },
      ],
    });
    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: grown });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ action: "merged", id: conv.id, mergedIntoExisting: true });

    // List shows exactly 1 entry
    const list = await callApi({ dataDir: rel, url: "/api/conversations" });
    expect(list.body).toHaveLength(1);

    // Versions: v1 (import) + pre-import-overwrite + import = 3
    const versions = await callApi({ dataDir: rel, url: `/api/conversations/${conv.id}/versions` });
    expect(versions.body.versions.map((v: any) => v.type)).toEqual([
      "import",
      "pre-import-overwrite",
      "import",
    ]);

    // Current conversation now has 4 messages
    const detail = await callApi({ dataDir: rel, url: `/api/conversations/${conv.id}` });
    expect(detail.body.messages).toHaveLength(4);
    expect(detail.body.updatedAt).toBeTruthy();
  });

  it("single-round conversation merges into its later multi-round re-export", async () => {
    const { rel } = makeRelativeTempDataDir();
    const oneRound = base({
      messages: [{ id: "m1", role: "user", content: "Plan a trip to Kyoto", timestamp: "2026-06-01T00:00:00.000Z" }],
    });
    await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: oneRound });

    const multi = base({
      id: `conv_multi_${Math.random().toString(36).slice(2, 7)}`,
      messages: [
        { id: "m1", role: "user", content: "Plan a trip to Kyoto", timestamp: "2026-06-01T00:00:00.000Z" },
        { id: "m2", role: "ai", content: "Sure...", timestamp: "2026-06-01T00:00:01.000Z" },
      ],
    });
    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: multi });
    expect(res.body).toMatchObject({ action: "merged", id: oneRound.id });
    const list = await callApi({ dataDir: rel, url: "/api/conversations" });
    expect(list.body).toHaveLength(1);
  });

  it("skips re-import of identical content (no new version)", async () => {
    const { rel } = makeRelativeTempDataDir();
    const conv = base();
    await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: conv });
    const again = base({ id: `conv_again_${Math.random().toString(36).slice(2, 7)}` });
    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: again });
    expect(res.body).toMatchObject({ action: "skipped", id: conv.id });

    const versions = await callApi({ dataDir: rel, url: `/api/conversations/${conv.id}/versions` });
    expect(versions.body.versions).toHaveLength(1);
  });

  it("skips re-import when adjacent same-role chunks normalize to the saved conversation", async () => {
    const { rel } = makeRelativeTempDataDir();
    const conv = base({
      messages: [
        { id: "m1", role: "user", content: "新手如何使用hermes", timestamp: "2026-06-17T02:25:00.000Z" },
        { id: "m2", role: "ai", content: "好的！让我先看看你的 Hermes 当前状态。", timestamp: "2026-06-17T02:26:00.000Z" },
        { id: "m3", role: "ai", content: "你已经安装好了 Hermes v0.16.0。", timestamp: "2026-06-17T02:26:30.000Z" },
      ],
    });
    await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: conv });

    const again = base({
      id: `conv_again_${Math.random().toString(36).slice(2, 7)}`,
      messages: conv.messages,
    });
    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: again });

    expect(res.body).toMatchObject({ action: "skipped", id: conv.id });
    const versions = await callApi({ dataDir: rel, url: `/api/conversations/${conv.id}/versions` });
    expect(versions.body.versions).toHaveLength(1);
  });

  it("does not merge same-title conversations with a different opening question", async () => {
    const { rel } = makeRelativeTempDataDir();
    const a = base();
    const b = base({
      id: `conv_b_${Math.random().toString(36).slice(2, 7)}`,
      messages: [{ id: "m1", role: "user", content: "Completely different question", timestamp: "x" }],
    });
    await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: a });
    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: b });
    expect(res.body.action).toBe("created");
    const list = await callApi({ dataDir: rel, url: "/api/conversations" });
    expect(list.body).toHaveLength(2);
  });

  it("rolls back to a historical version", async () => {
    const { rel } = makeRelativeTempDataDir();
    const conv = base();
    await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: conv });
    const grown = base({
      id: `conv_g_${Math.random().toString(36).slice(2, 7)}`,
      messages: [...conv.messages, { id: "m3", role: "user", content: "Add day 2", timestamp: "x" }],
    });
    await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: grown });

    const versions = await callApi({ dataDir: rel, url: `/api/conversations/${conv.id}/versions` });
    const v1 = versions.body.versions.find((v: any) => v.version === 1);

    const rollback = await callApi({
      dataDir: rel,
      method: "POST",
      url: `/api/conversations/${conv.id}/rollback`,
      body: { targetVersionId: v1.id },
    });
    expect(rollback.status).toBe(200);

    const detail = await callApi({ dataDir: rel, url: `/api/conversations/${conv.id}` });
    expect(detail.body.messages).toHaveLength(2); // back to v1's 2 messages
  });

  it("deleting a conversation removes its versions directory", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    const conv = base();
    await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: conv });
    expect(fs.existsSync(path.join(abs, "conversations", `${conv.id}.versions`))).toBe(true);
    await callApi({ dataDir: rel, method: "DELETE", url: `/api/conversations/${conv.id}` });
    expect(fs.existsSync(path.join(abs, "conversations", `${conv.id}.versions`))).toBe(false);
  });
});

describe("import auto-classify (spec import-auto-classify)", () => {
  const base = (over: any = {}) => ({
    id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: `Auto classify ${Math.random().toString(36).slice(2, 7)}`,
    platform: "Claude",
    date: "2026-07-01T00:00:00.000Z",
    folderId: null,
    messages: [
      { id: "m1", role: "user", content: `hello ${Math.random().toString(36).slice(2, 7)}`, timestamp: "2026-07-01T00:00:00.000Z" },
      { id: "m2", role: "ai", content: "hi there", timestamp: "2026-07-01T00:00:05.000Z" },
    ],
    ...over,
  });

  const foldersPath = (abs: string) => path.join(abs, "folders.json");
  const writeFolders = (abs: string, folders: unknown) =>
    fs.writeFileSync(foldersPath(abs), JSON.stringify(folders, null, 2));
  const readFolders = (abs: string) => JSON.parse(fs.readFileSync(foldersPath(abs), "utf-8"));

  it("reuses an existing folder matched by folder.platform (US-01 AC1)", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    writeFolders(abs, [{ id: "f4", name: "Claude", platform: "Claude" }]);
    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: base() });
    expect(res.status).toBe(201);
    expect(res.body.conversation.folderId).toBe("f4");
    expect(readFolders(abs)).toHaveLength(1);
  });

  it("creates a missing product folder with platform tag (US-01 AC2)", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    writeFolders(abs, []);
    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: base({ platform: "Grok" }) });
    const folders = readFolders(abs);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ name: "Grok", platform: "Grok" });
    expect(res.body.conversation.folderId).toBe(folders[0].id);
  });

  it("keeps platforms outside the product list uncategorized (US-01 AC3)", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    writeFolders(abs, []);
    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: base({ platform: "Foo" }) });
    expect(res.body.conversation.folderId).toBeNull();
    expect(readFolders(abs)).toHaveLength(0);
  });

  it("maps alias platform Qianwen into the canonical Qwen folder (§4.3)", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    writeFolders(abs, []);
    const first = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: base({ platform: "Qianwen" }) });
    const folders = readFolders(abs);
    expect(folders[0]).toMatchObject({ name: "Qwen", platform: "Qwen" });
    const second = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: base({ platform: "Qwen" }) });
    expect(second.body.conversation.folderId).toBe(first.body.conversation.folderId);
    expect(readFolders(abs)).toHaveLength(1);
  });

  it("falls back to matching by folder name when platform tag is absent (§5 边界 2)", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    writeFolders(abs, [{ id: "f_manual", name: "Claude" }]);
    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: base() });
    expect(res.body.conversation.folderId).toBe("f_manual");
    expect(readFolders(abs)).toHaveLength(1);
  });

  it("merge keeps the existing folderId untouched (US-01 AC4)", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    writeFolders(abs, [{ id: "f4", name: "Claude", platform: "Claude" }]);
    const conv = base();
    await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: conv });
    const grown = base({
      id: `conv_grown_${Math.random().toString(36).slice(2, 7)}`,
      title: conv.title,
      messages: [
        ...conv.messages,
        { id: "m3", role: "user", content: "more", timestamp: "2026-07-01T00:01:00.000Z" },
      ],
    });
    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: grown });
    expect(res.body.action).toBe("merged");
    const detail = await callApi({ dataDir: rel, url: `/api/conversations/${conv.id}` });
    expect(detail.body.folderId).toBe("f4");
  });

  it("degrades to uncategorized when folders.json is corrupted (§5 异常 1)", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    fs.writeFileSync(foldersPath(abs), "not json {");
    const res = await callApi({ dataDir: rel, method: "POST", url: "/api/conversations", body: base() });
    expect(res.status).toBe(201);
    expect(res.body.conversation.folderId).toBeNull();
  });
});

describe("/api/search route (spec hybrid-search §4.4)", () => {
  afterEach(() => _resetForTest());

  it("returns ready + BM25 hits once the index is built", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    fs.mkdirSync(path.join(abs, "conversations"), { recursive: true });
    fs.writeFileSync(
      path.join(abs, "conversations", "conv_1.md"),
      "---\nid: conv_1\ntitle: Kyoto trip\nplatform: ChatGPT\ndate: 2026-05-30T00:00:00.000Z\nfolderId: null\n---\n\n## User\n\nPlan a trip to Kyoto with full text search notes\n",
    );
    // First call configures the dir (returns building); build synchronously, then query.
    await callApi({ dataDir: rel, url: "/api/search?q=kyoto" });
    refreshNow();

    const res = await callApi({ dataDir: rel, url: "/api/search?q=kyoto" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.mode).toBe("lex");
    expect(typeof res.body.took_ms).toBe("number");
    expect(res.body.hits).toHaveLength(1);
    expect(res.body.hits[0]).toMatchObject({ type: "conversation", id: "conv_1" });
  });

  it("returns building (empty hits) before the index is warm", async () => {
    const { rel } = makeRelativeTempDataDir();
    const res = await callApi({ dataDir: rel, url: "/api/search?q=anything" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("building");
    expect(res.body.hits).toEqual([]);
  });

  it("short-circuits empty / whitespace query to ready + empty without hitting the engine", async () => {
    const { rel } = makeRelativeTempDataDir();
    const res = await callApi({ dataDir: rel, url: "/api/search?q=" });
    expect(res.body).toMatchObject({ status: "ready", hits: [], mode: "lex" });
    const res2 = await callApi({ dataDir: rel, url: "/api/search?q=%20%20" });
    expect(res2.body).toMatchObject({ status: "ready", hits: [] });
  });

  it("clamps limit to [1,50], defaults non-integer/absent to 30, and forces mode=lex", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    fs.mkdirSync(path.join(abs, "documents"), { recursive: true });
    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(
        path.join(abs, "documents", `doc_${i}.md`),
        `---\nid: doc_${i}\ntitle: Note ${i}\nfolderId: null\ncreatedAt: 2026-05-28T00:00:00.000Z\nupdatedAt: 2026-05-29T00:00:00.000Z\ncurrentVersionId: ver_1\n---\n\nshared apple keyword\n`,
      );
    }
    await callApi({ dataDir: rel, url: "/api/search?q=apple" });
    refreshNow();

    // limit clamped to min 1
    const r1 = await callApi({ dataDir: rel, url: "/api/search?q=apple&limit=0" });
    expect(r1.body.hits).toHaveLength(1);
    // limit clamped to max 50 (we have 6) → all 6
    const r50 = await callApi({ dataDir: rel, url: "/api/search?q=apple&limit=999" });
    expect(r50.body.hits).toHaveLength(6);
    // hybrid mode forced to lex
    const rmode = await callApi({ dataDir: rel, url: "/api/search?q=apple&mode=hybrid" });
    expect(rmode.body.mode).toBe("lex");
    expect(rmode.body.hits.length).toBeGreaterThan(0);
  });

  it("truncates queries longer than 200 chars without erroring", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    fs.mkdirSync(path.join(abs, "documents"), { recursive: true });
    fs.writeFileSync(
      path.join(abs, "documents", "doc_long.md"),
      "---\nid: doc_long\ntitle: Long\nfolderId: null\ncreatedAt: 2026-05-28T00:00:00.000Z\nupdatedAt: 2026-05-29T00:00:00.000Z\ncurrentVersionId: ver_1\n---\n\napple content\n",
    );
    await callApi({ dataDir: rel, url: "/api/search?q=apple" });
    refreshNow();
    const longQ = "apple" + "x".repeat(300);
    const res = await callApi({ dataDir: rel, url: `/api/search?q=${encodeURIComponent(longQ)}` });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
  });

  it("mode=hybrid with embeddings disabled returns lex (no degraded)", async () => {
    const { abs, rel } = makeRelativeTempDataDir();
    fs.mkdirSync(path.join(abs, "documents"), { recursive: true });
    fs.writeFileSync(
      path.join(abs, "documents", "doc_a.md"),
      "---\nid: doc_a\ntitle: Apple\nfolderId: null\ncreatedAt: 2026-05-28T00:00:00.000Z\nupdatedAt: 2026-05-29T00:00:00.000Z\ncurrentVersionId: ver_1\n---\n\napple content\n",
    );
    await callApi({ dataDir: rel, url: "/api/search?q=apple&mode=hybrid" });
    refreshNow();
    const res = await callApi({ dataDir: rel, url: "/api/search?q=apple&mode=hybrid" });
    expect(res.body.mode).toBe("lex");
    expect(res.body.degraded).toBeUndefined();
    expect(res.body.hits.length).toBeGreaterThan(0);
  });
});

describe("/api/search/config route (spec hybrid-search §4.7)", () => {
  afterEach(() => _resetForTest());

  it("GET returns embedding state without exposing the api key", async () => {
    const { rel } = makeRelativeTempDataDir();
    const res = await callApi({ dataDir: rel, url: "/api/search/config" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, phase: "disabled", hasKey: false });
    expect(res.body.apiKey).toBeUndefined();
  });

  it("PUT saves config, never echoes the key; GET reports hasKey only", async () => {
    const { rel } = makeRelativeTempDataDir();
    _setEmbedFnForTest(async (_c, texts) => texts.map(() => [1, 0, 0, 0]));
    const put = await callApi({
      dataDir: rel,
      method: "PUT",
      url: "/api/search/config",
      body: { enabled: true, endpoint: "https://e.example/v1", model: "m", apiKey: "sk-secret" },
    });
    expect(put.status).toBe(200);
    expect(put.body.apiKey).toBeUndefined();
    expect(put.body.hasKey).toBe(true);

    const get = await callApi({ dataDir: rel, url: "/api/search/config" });
    expect(get.body.hasKey).toBe(true);
    expect(get.body.apiKey).toBeUndefined();
  });
});
