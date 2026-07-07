/**
 * 资产路由与入库管线挂接测试（spec media-assets §6.1）。
 * - GET /api/assets：命中 / 404 / 路径穿越拒绝 / immutable 缓存头（边界 4）
 * - POST /api/assets：上传落盘 / 重复内容返回已有 URL / 非位图拒绝
 * - §4.4 挂接清单：每个 ✅ 端点经过本地化且 downloadRemote 取值正确；rollback 不调用
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

vi.mock("./media-assets.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./media-assets.js")>();
  return {
    ...actual,
    localizeMedia: vi.fn(actual.localizeMedia),
    localizeMessages: vi.fn(actual.localizeMessages),
  };
});

vi.mock("../../vite-plugins/obscura.js", () => ({
  fetchHtmlWithObscura: vi.fn(async () => "<html></html>"),
  parseSharedLinkData: vi.fn(async () => [
    {
      id: "conv_link_1",
      title: "Linked",
      platform: "Doubao",
      date: "2026-06-12T00:00:00.000Z",
      folderId: null,
      messages: [{ id: "m1", role: "user", content: "hi", timestamp: "2026-06-12T00:00:00.000Z" }],
    },
  ]),
}));

import { handleApiRequest } from "./api-router";
import { localizeMedia, localizeMessages } from "./media-assets";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BUF = Buffer.from(PNG_B64, "base64");

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(tmpdir(), "pentou-assets-api-"));
  vi.mocked(localizeMedia).mockClear();
  vi.mocked(localizeMessages).mockClear();
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function callApi(params: {
  method?: string;
  url: string;
  body?: unknown;
  rawBody?: Buffer;
  headers?: Record<string, string>;
}): Promise<{ status: number; headers: Record<string, any>; body: any; rawBody: Buffer }> {
  const raw = params.rawBody ?? Buffer.from(params.body === undefined ? "" : JSON.stringify(params.body));
  const req = Readable.from(raw.length ? [raw] : []) as any;
  req.method = params.method ?? "GET";
  req.url = params.url;
  req.headers = params.headers ?? (raw.length ? { "content-type": "application/json", "content-length": String(raw.length) } : {});
  req.socket = { remoteAddress: "127.0.0.1" };

  let status = 200;
  let resHeaders: Record<string, any> = {};
  const chunks: Buffer[] = [];
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  const res = {
    headersSent: false,
    writeHead(code: number, headers?: Record<string, any>) {
      status = code;
      if (headers) resHeaders = { ...resHeaders, ...headers };
      this.headersSent = true;
      return this;
    },
    setHeader(name: string, value: any) { resHeaders[name] = value; },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      this.headersSent = true;
      resolveDone();
      return this;
    },
    write(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
  } as any;

  const handled = await handleApiRequest(req, res, { dataDir });
  if (!handled) { status = 404; resolveDone(); }
  await done;

  const rawRes = Buffer.concat(chunks);
  let body: any;
  try { body = JSON.parse(rawRes.toString()); } catch { body = undefined; }
  return { status, headers: resHeaders, body, rawBody: rawRes };
}

function multipartUpload(fileName: string, content: Buffer, contentType = "image/png") {
  const boundary = "----pentouTestBoundary";
  const raw = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return callApi({
    method: "POST",
    url: "/api/assets",
    rawBody: raw,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(raw.length) },
  });
}

describe("GET /api/assets/:file（边界 4）", () => {
  it("命中返回图片二进制与 immutable 缓存头", async () => {
    const assetsDir = path.join(dataDir, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    const file = "0123456789abcdef.png";
    fs.writeFileSync(path.join(assetsDir, file), PNG_BUF);

    const res = await callApi({ url: `/api/assets/${file}` });
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/png");
    expect(res.headers["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(res.rawBody.equals(PNG_BUF)).toBe(true);
  });

  it("未命中返回 404", async () => {
    const res = await callApi({ url: "/api/assets/00000000deadbeef.png" });
    expect(res.status).toBe(404);
  });

  it("路径穿越与非法文件名拒绝", async () => {
    for (const file of ["../folders.json", "..%2Ffolders.json", "ABCDEF1234567890.png", "0123456789abcdef.png/x", "0123456789abcdef"]) {
      const res = await callApi({ url: `/api/assets/${file}` });
      expect(res.status, file).toBe(400);
    }
  });
});

describe("POST /api/assets（Phase 2 上传）", () => {
  it("上传落盘返回 URL；重复内容返回同一 URL 且只存一份", async () => {
    const first = await multipartUpload("a.png", PNG_BUF);
    expect(first.status).toBe(200);
    expect(first.body.url).toMatch(/^\/api\/assets\/[0-9a-f]{16}\.png$/);

    const second = await multipartUpload("b.png", PNG_BUF);
    expect(second.body.url).toBe(first.body.url);
    expect(fs.readdirSync(path.join(dataDir, "assets"))).toHaveLength(1);

    const fetched = await callApi({ url: first.body.url });
    expect(fetched.status).toBe(200);
  });

  it("非白名单位图拒绝（含 SVG，决策 10）", async () => {
    const res = await multipartUpload("a.svg", Buffer.from("<svg xmlns='x'/>"), "image/svg+xml");
    expect(res.status).toBe(415);
  });
});

describe("§4.4 挂接清单", () => {
  const dataUriMd = `![p](data:image/png;base64,${PNG_B64})`;

  it("POST /api/conversations：downloadRemote=true，且 data URI 实际落盘", async () => {
    const res = await callApi({
      method: "POST",
      url: "/api/conversations",
      body: {
        id: "conv_hook_1",
        title: "Hook",
        platform: "ChatGPT",
        date: "2026-06-12T00:00:00.000Z",
        folderId: null,
        messages: [{ id: "m1", role: "user", content: dataUriMd, timestamp: "2026-06-12T00:00:00.000Z" }],
      },
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(localizeMessages)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ downloadRemote: true }),
    );
    const saved = fs.readFileSync(path.join(dataDir, "conversations", "conv_hook_1.md"), "utf-8");
    expect(saved).toMatch(/\/api\/assets\/[0-9a-f]{16}\.png/);
    expect(saved).not.toContain("data:image/png");
  });

  it("PUT /api/conversations/:id：downloadRemote=false", async () => {
    await callApi({
      method: "PUT",
      url: "/api/conversations/conv_hook_2",
      body: {
        title: "Edited",
        platform: "ChatGPT",
        messages: [{ id: "m1", role: "user", content: dataUriMd, timestamp: "2026-06-12T00:00:00.000Z" }],
      },
    });
    expect(vi.mocked(localizeMessages)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ downloadRemote: false }),
    );
  });

  it("POST /api/conversations/:id/rollback：不做本地化（原样恢复历史字节）", async () => {
    await callApi({
      method: "POST",
      url: "/api/conversations/conv_hook_1",
      body: {},
    });
    // 先建一个带版本的对话再回滚
    await callApi({
      method: "POST",
      url: "/api/conversations",
      body: {
        id: "conv_rb_1",
        title: "RB",
        platform: "ChatGPT",
        date: "2026-06-12T00:00:00.000Z",
        folderId: null,
        messages: [{ id: "m1", role: "user", content: "v1 content", timestamp: "2026-06-12T00:00:00.000Z" }],
      },
    });
    const versions = await callApi({ url: "/api/conversations/conv_rb_1/versions" });
    const targetVersionId = versions.body.versions[0].id;

    vi.mocked(localizeMessages).mockClear();
    vi.mocked(localizeMedia).mockClear();
    const res = await callApi({
      method: "POST",
      url: "/api/conversations/conv_rb_1/rollback",
      body: { targetVersionId },
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(localizeMessages)).not.toHaveBeenCalled();
    expect(vi.mocked(localizeMedia)).not.toHaveBeenCalled();
  });

  it("POST /api/import/link：downloadRemote=true", async () => {
    const res = await callApi({ method: "POST", url: "/api/import/link", body: { url: "https://www.doubao.com/thread/x" } });
    expect(res.status).toBe(200);
    expect(vi.mocked(localizeMessages)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ downloadRemote: true }),
    );
  });

  it("PUT /api/ai-chats/:id：downloadRemote=false", async () => {
    const res = await callApi({
      method: "PUT",
      url: "/api/ai-chats/chat_1778662775895_img",
      body: {
        title: "AI chat",
        messages: [{ id: "aimsg_1", role: "user", status: "done", content: dataUriMd }],
      },
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(localizeMessages)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ downloadRemote: false }),
    );
    const file = fs.readFileSync(path.join(dataDir, "ai-chats", "chat_1778662775895_img.md"), "utf-8");
    expect(file).toMatch(/\/api\/assets\/[0-9a-f]{16}\.png/);
  });

  it("POST /api/documents：downloadRemote=false，正文落盘已本地化", async () => {
    const res = await callApi({
      method: "POST",
      url: "/api/documents",
      body: {
        id: "doc_1778662775895_img01",
        title: "Doc with image",
        folderId: null,
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
        body: dataUriMd,
      },
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(localizeMedia)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ downloadRemote: false }),
    );
    expect(res.body.document.body).toMatch(/\/api\/assets\/[0-9a-f]{16}\.png/);
  });

  it("PUT /api/documents/:id 与 commit-version：downloadRemote=false；rollback 不调用", async () => {
    await callApi({
      method: "POST",
      url: "/api/documents",
      body: {
        id: "doc_1778662775895_img02",
        title: "Doc",
        folderId: null,
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
        body: "v1",
      },
    });

    vi.mocked(localizeMedia).mockClear();
    const putRes = await callApi({
      method: "PUT",
      url: "/api/documents/doc_1778662775895_img02",
      body: { body: dataUriMd },
    });
    expect(putRes.status).toBe(200);
    expect(vi.mocked(localizeMedia)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ downloadRemote: false }),
    );

    vi.mocked(localizeMedia).mockClear();
    const commitRes = await callApi({
      method: "POST",
      url: "/api/documents/doc_1778662775895_img02/commit-version",
      body: { body: `${dataUriMd}\n\nmore`, type: "manual-edit" },
    });
    expect(commitRes.status).toBe(200);
    expect(vi.mocked(localizeMedia)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ downloadRemote: false }),
    );
    expect(commitRes.body.version.body).toMatch(/\/api\/assets\//);

    const versions = await callApi({ url: "/api/documents/doc_1778662775895_img02/versions" });
    const target = versions.body.versions[0].id;
    vi.mocked(localizeMedia).mockClear();
    vi.mocked(localizeMessages).mockClear();
    const rbRes = await callApi({
      method: "POST",
      url: "/api/documents/doc_1778662775895_img02/rollback",
      body: { targetVersionId: target },
    });
    expect(rbRes.status).toBe(200);
    expect(vi.mocked(localizeMedia)).not.toHaveBeenCalled();
    expect(vi.mocked(localizeMessages)).not.toHaveBeenCalled();
  });

  it("POST /api/import/document（.md 直读路径）：downloadRemote=true 且带 baseDir", async () => {
    const boundary = "----pentouDocBoundary";
    const mdContent = `# Doc\n\n${dataUriMd}\n`;
    const raw = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="imported.md"\r\nContent-Type: text/markdown\r\n\r\n`,
      ),
      Buffer.from(mdContent),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await callApi({
      method: "POST",
      url: "/api/import/document",
      rawBody: raw,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(raw.length) },
    });
    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);
    expect(vi.mocked(localizeMedia)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ downloadRemote: true, baseDir: expect.any(String) }),
    );
    expect(res.body.results[0].document.body).toMatch(/\/api\/assets\/[0-9a-f]{16}\.png/);
  });
});
