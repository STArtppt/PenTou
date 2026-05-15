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
