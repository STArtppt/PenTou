import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { handleApiRequest } from "./api-router";
import { DOCS_DIR, setDocsDataDir } from "../../vite-plugins/documentsPlugin";

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
}): Promise<{ status: number; body: any }> {
  const rawBody = params.body === undefined ? "" : JSON.stringify(params.body);
  const req = Readable.from(rawBody ? [rawBody] : []) as any;
  req.method = params.method ?? "GET";
  req.url = params.url;
  req.headers = rawBody ? { "content-type": "application/json" } : {};
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
