/**
 * ingest-documents.test.ts —— ingest 网关的 `format: "document"` 分支
 * （spec document-ingest）。覆盖：校验与整批 400 / token 闸门 / 逐 item 容错 /
 * 脱敏开关 / 覆盖版本与归属保全 / 项目自动创建与复用 / 不新增文件夹。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { handleApiRequest } from "./api-router";
import { getIngestToken, writeIngestConfig } from "./ingest-token";
import { _resetLimiter } from "./auth";

const cleanupDirs: string[] = [];

beforeEach(() => { _resetLimiter(); });
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeDataDir(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "pentou-ingest-docs-"));
  fs.mkdirSync(path.join(dir, "conversations"), { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

async function call(params: {
  dataDir: string;
  method?: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<{ status: number; body: any }> {
  const raw = params.body === undefined ? "" : JSON.stringify(params.body);
  const buf = Buffer.from(raw);
  const req: any = Readable.from(buf.length ? [buf] : []);
  req.method = params.method ?? "GET";
  req.url = params.url;
  req.headers = {
    ...(buf.length ? { "content-type": "application/json", "content-length": String(buf.length) } : {}),
    ...(params.headers ?? {}),
  };
  req.socket = { remoteAddress: "127.0.0.1" };

  let status = 0;
  let responseBody = "";
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  const res: any = {
    headersSent: false,
    writeHead(code: number) { status = code; this.headersSent = true; return this; },
    setHeader() {},
    end(chunk?: string) { if (chunk) responseBody += chunk.toString(); resolveDone(); return this; },
  };
  const handled = await handleApiRequest(req, res, { dataDir: params.dataDir });
  if (!handled) return { status: 404, body: undefined };
  await done;
  return { status, body: responseBody ? JSON.parse(responseBody) : undefined };
}

function authed(dataDir: string): Record<string, string> {
  return { authorization: `Bearer ${getIngestToken(dataDir)}` };
}

function docItem(overrides: Record<string, unknown> = {}) {
  const { data, ...rest } = overrides as any;
  return {
    platform: "docs",
    externalId: "pentou/guides/deploy.md",
    format: "document",
    filename: "deploy.md",
    data: {
      title: "部署指南",
      body: "# 部署指南\n\n第一段。\n\n尾部。",
      project: { key: "pentou", name: "pentou", rootPath: "/Users/x/proj/pentou/docs" },
      ...(data ?? {}),
    },
    ...rest,
  };
}

function push(dataDir: string, items: unknown[]) {
  return call({ dataDir, method: "POST", url: "/api/ingest", body: { source: "cli", items }, headers: authed(dataDir) });
}

function docsDir(dataDir: string): string {
  return path.join(dataDir, "documents");
}

function listDocs(dataDir: string): string[] {
  const dir = docsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
}

function readDoc(dataDir: string, id: string): string {
  return fs.readFileSync(path.join(docsDir(dataDir), `${id}.md`), "utf-8");
}

function readProjects(dataDir: string): any[] {
  const file = path.join(dataDir, "document-projects.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : [];
}

function readFolders(dataDir: string): any[] {
  const file = path.join(dataDir, "document-folders.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : [];
}

function versionTypes(dataDir: string, id: string): string[] {
  const index = JSON.parse(fs.readFileSync(path.join(docsDir(dataDir), `${id}.versions`, "index.json"), "utf-8"));
  return index.versions.map((v: any) => v.type);
}

// ── 校验与鉴权 ────────────────────────────────────────────────────────────────

describe("document ingest validation", () => {
  it("accepts a valid document item and lands it in the project's uncategorized", async () => {
    const dataDir = makeDataDir();
    const res = await push(dataDir, [docItem()]);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.results[0].error).toBeUndefined();
    expect(res.body.results[0].conversations).toEqual([]); // 老客户端读到的字段语义不变
    expect(res.body.results[0].documents).toHaveLength(1);
    expect(res.body.results[0].documents[0].action).toBe("created");

    const [file] = listDocs(dataDir);
    const id = file.replace(".md", "");
    const md = readDoc(dataDir, id);
    const [project] = readProjects(dataDir);
    expect(md).toContain(`projectId: ${project.id}`);
    expect(md).toContain("folderId: null"); // 一律落未分类
    expect(md).toContain('externalKey: "docs:pentou%2Fguides%2Fdeploy.md"');
    expect(md).toContain('ingestSource: "cli:docs"');
  });

  it("rejects the whole batch when the body is missing", async () => {
    const dataDir = makeDataDir();
    const res = await push(dataDir, [docItem(), docItem({ data: { body: undefined } })]);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("items[1]");
    expect(listDocs(dataDir)).toEqual([]); // 该批全部不落库
  });

  it("rejects a document item without a non-empty externalId", async () => {
    const dataDir = makeDataDir();
    const res = await push(dataDir, [docItem({ externalId: "   " })]);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("externalId");
    expect(listDocs(dataDir)).toEqual([]);
  });

  it("rejects a malformed project object", async () => {
    const dataDir = makeDataDir();
    const res = await push(dataDir, [docItem({ data: { project: { key: "" } } })]);
    expect(res.status).toBe(400);
    expect(listDocs(dataDir)).toEqual([]);
  });

  it("rejects a bad token with 401 and writes nothing", async () => {
    const dataDir = makeDataDir();
    const res = await call({
      dataDir,
      method: "POST",
      url: "/api/ingest",
      body: { source: "cli", items: [docItem()] },
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
    expect(listDocs(dataDir)).toEqual([]);
    expect(readProjects(dataDir)).toEqual([]);
  });

  it("reports an empty body as skipped rather than an error", async () => {
    const dataDir = makeDataDir();
    const res = await push(dataDir, [docItem({ data: { body: "   \n  " } })]);
    expect(res.status).toBe(200);
    expect(res.body.results[0].error).toBeUndefined();
    expect(res.body.results[0].skippedReason).toBeTruthy();
    expect(listDocs(dataDir)).toEqual([]);
  });

  it("isolates a per-item failure from the rest of the batch", async () => {
    const dataDir = makeDataDir();
    // 把项目清单变成目录：带 project 的 item 在写项目时必然抛错，不带的照常落库
    fs.mkdirSync(path.join(dataDir, "document-projects.json"));
    const res = await push(dataDir, [
      docItem({ externalId: "pentou/a.md", data: { project: undefined, body: "# A\n\naaa" } }),
      docItem({ externalId: "pentou/b.md", data: { body: "# B\n\nbbb" } }),
      docItem({ externalId: "pentou/c.md", data: { project: undefined, body: "# C\n\nccc" } }),
    ]);
    expect(res.status).toBe(200); // HTTP 仍是 200，失败只体现在该条 result 上
    expect(res.body.ok).toBe(false);
    expect(res.body.results[1].error).toBeTruthy();
    expect(res.body.results[1].documents).toEqual([]);
    expect(res.body.results[0].documents[0].action).toBe("created");
    expect(res.body.results[2].documents[0].action).toBe("created");
    expect(listDocs(dataDir)).toHaveLength(2);
  });

  it("creates no folders from the payload", async () => {
    const dataDir = makeDataDir();
    fs.writeFileSync(
      path.join(dataDir, "document-folders.json"),
      JSON.stringify([{ id: "df_x", name: "X", projectId: "dp_other" }]),
      "utf-8",
    );
    await push(dataDir, [docItem({ externalId: "pentou/guides/a.md" })]);
    expect(readFolders(dataDir).map((f: any) => f.id)).toEqual(["df_x"]);
  });
});

// ── 脱敏 ──────────────────────────────────────────────────────────────────────

describe("document redaction", () => {
  const SECRET_BODY = "# Config\n\nUse sk-ant-api03-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefgh to authenticate.";

  it("masks secrets when redact is on", async () => {
    const dataDir = makeDataDir();
    const res = await push(dataDir, [docItem({ data: { body: SECRET_BODY } })]);
    expect(res.body.results[0].redactions).toBeGreaterThan(0);
    const [file] = listDocs(dataDir);
    expect(readDoc(dataDir, file.replace(".md", ""))).not.toContain("sk-ant-api03-0123456789abcdef");
  });

  it("keeps the body byte-for-byte when redact is off", async () => {
    const dataDir = makeDataDir();
    writeIngestConfig(dataDir, { redact: false });
    const res = await push(dataDir, [docItem({ data: { body: SECRET_BODY } })]);
    expect(res.body.results[0].redactions).toBeUndefined();
    const [file] = listDocs(dataDir);
    expect(readDoc(dataDir, file.replace(".md", ""))).toContain("sk-ant-api03-0123456789abcdef");
  });
});

// ── 覆盖语义与项目归属 ────────────────────────────────────────────────────────

describe("document ingest upsert and project attribution", () => {
  it("creates the project on first push with rootPath as its description", async () => {
    const dataDir = makeDataDir();
    await push(dataDir, [docItem()]);
    const projects = readProjects(dataDir);
    expect(projects).toHaveLength(1);
    expect(projects[0].sourceKey).toBe("pentou");
    expect(projects[0].description).toBe("/Users/x/proj/pentou/docs");
  });

  it("reuses the project and never writes back the user's name/description", async () => {
    const dataDir = makeDataDir();
    await push(dataDir, [docItem()]);
    const project = readProjects(dataDir)[0];
    fs.writeFileSync(
      path.join(dataDir, "document-projects.json"),
      JSON.stringify([{ ...project, name: "笔头文档", description: "笔头的产品与部署文档" }]),
      "utf-8",
    );

    await push(dataDir, [docItem({ data: { body: "# 部署指南\n\n第一段。\n\n改过的尾部。" } })]);
    const after = readProjects(dataDir);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(project.id);
    expect(after[0].name).toBe("笔头文档");
    expect(after[0].description).toBe("笔头的产品与部署文档");
  });

  it("archives the old body and keeps filing plus annotations on overwrite", async () => {
    const dataDir = makeDataDir();
    await push(dataDir, [docItem()]);
    const id = listDocs(dataDir)[0].replace(".md", "");

    // 用户手动归类 + 加批注
    const project = readProjects(dataDir)[0];
    fs.writeFileSync(
      path.join(dataDir, "document-folders.json"),
      JSON.stringify([{ id: "df_guides", name: "指南", projectId: project.id }]),
      "utf-8",
    );
    const moved = await call({
      dataDir,
      method: "PUT",
      url: `/api/documents/${id}`,
      body: { folderId: "df_guides", projectId: project.id },
    });
    expect(moved.status).toBe(200);
    fs.writeFileSync(
      path.join(docsDir(dataDir), `${id}.annotations.json`),
      JSON.stringify({ version: 1, annotations: [{ id: "anno_1" }] }),
      "utf-8",
    );

    // 本地文件变更后重推
    const res = await push(dataDir, [docItem({ data: { body: "# 部署指南\n\n第一段。\n\n全新的尾部。" } })]);
    expect(res.body.results[0].documents[0].action).toBe("merged");
    expect(listDocs(dataDir)).toHaveLength(1); // 不产生第二份

    expect(versionTypes(dataDir, id)).toEqual(["import", "pre-import-overwrite", "import"]);
    const md = readDoc(dataDir, id);
    expect(md).toContain("全新的尾部");
    expect(md).toContain("folderId: df_guides"); // 归属不被打回未分类
    expect(md).toContain(`projectId: ${project.id}`);
    const annotations = JSON.parse(fs.readFileSync(path.join(docsDir(dataDir), `${id}.annotations.json`), "utf-8"));
    expect(annotations.annotations).toHaveLength(1);
  });

  it("skips an unchanged re-push", async () => {
    const dataDir = makeDataDir();
    await push(dataDir, [docItem()]);
    const res = await push(dataDir, [docItem()]);
    expect(res.body.results[0].documents[0].action).toBe("skipped");
    expect(listDocs(dataDir)).toHaveLength(1);
  });

  it("creates no folders even for deep sub-directories", async () => {
    const dataDir = makeDataDir();
    await push(dataDir, [
      docItem({ externalId: "pentou/README.md", data: { body: "# R\n\nr" } }),
      docItem({ externalId: "pentou/guides/deploy.md", data: { body: "# D\n\nd" } }),
      docItem({ externalId: "pentou/features/collector/spec.md", data: { body: "# S\n\ns" } }),
    ]);
    expect(listDocs(dataDir)).toHaveLength(3);
    expect(readFolders(dataDir)).toEqual([]);
    for (const file of listDocs(dataDir)) {
      expect(readDoc(dataDir, file.replace(".md", ""))).toContain("folderId: null");
    }
  });

  it("lands in the default project when no project is supplied", async () => {
    const dataDir = makeDataDir();
    await push(dataDir, [docItem({ data: { project: undefined } })]);
    expect(readProjects(dataDir)).toEqual([]);
    const md = readDoc(dataDir, listDocs(dataDir)[0].replace(".md", ""));
    expect(md).not.toContain("projectId:");
    expect(md).toContain("folderId: null");
  });

  it("leaves the existing conversation path untouched", async () => {
    const dataDir = makeDataDir();
    const res = await push(dataDir, [{
      platform: "claude-code",
      externalId: "sess-1",
      format: "raw",
      filename: "session.jsonl",
      data: [
        '{"type":"human","message":{"content":"hello"},"timestamp":"2026-07-01T00:00:00.000Z"}',
        '{"type":"assistant","message":{"content":"hi"},"timestamp":"2026-07-01T00:00:05.000Z"}',
      ].join("\n"),
    }]);
    expect(res.status).toBe(200);
    expect(res.body.results[0].conversations).toHaveLength(1);
    expect(res.body.results[0].documents).toBeUndefined();
    expect(listDocs(dataDir)).toEqual([]);
  });
});

// ── 路径拼串标题规范化（spec docs-path-title）────────────────────────────────

describe("document path-composed title on ingest", () => {
  it("overrides a stale client title for docs platform path externalIds", async () => {
    const dataDir = makeDataDir();
    const res = await push(dataDir, [
      docItem({
        externalId: "pentou/skills/foo/SKILL.md",
        data: { title: "My Skill", body: "# Skill\n\nbody text here." },
      }),
    ]);
    expect(res.status).toBe(200);
    expect(res.body.results[0].documents[0].title).toBe("foo-SKILL");
    const id = listDocs(dataDir)[0].replace(".md", "");
    expect(readDoc(dataDir, id)).toMatch(/title:\s*foo-SKILL/);
  });

  it("does not rewrite title when externalId has no path slash", async () => {
    const dataDir = makeDataDir();
    const res = await push(dataDir, [
      docItem({
        externalId: "legacy-doc-id",
        data: { title: "Keep Me", body: "# Keep\n\nbody." },
      }),
    ]);
    expect(res.body.results[0].documents[0].title).toBe("Keep Me");
  });

  it("does not rewrite title for non-docs platforms even with path externalIds", async () => {
    const dataDir = makeDataDir();
    const res = await push(dataDir, [
      docItem({
        platform: "notion",
        externalId: "workspace/page-id",
        data: { title: "Notion Page", body: "# Page\n\nbody." },
      }),
    ]);
    expect(res.body.results[0].documents[0].title).toBe("Notion Page");
  });

  it("does not rewrite title when last segment is not .md", async () => {
    const dataDir = makeDataDir();
    const res = await push(dataDir, [
      docItem({
        externalId: "workspace/page-id",
        data: { title: "Custom", body: "# C\n\nbody." },
      }),
    ]);
    expect(res.body.results[0].documents[0].title).toBe("Custom");
  });

  it("refreshes title on re-push without creating a version when body is unchanged", async () => {
    const dataDir = makeDataDir();
    // First push → server normalizes to guides-deploy
    const first = await push(dataDir, [docItem({ data: { title: "旧标题", body: "# Body\n\nstable body content." } })]);
    const id = first.body.results[0].documents[0].id as string;
    expect(versionTypes(dataDir, id)).toEqual(["import"]);
    expect(readDoc(dataDir, id)).toMatch(/title:\s*guides-deploy/);

    // Simulate a library that still has the pre-rule-switch title (or a hand-edited display name)
    const stale = readDoc(dataDir, id).replace(/title:\s*guides-deploy/, "title: SKILL");
    fs.writeFileSync(path.join(docsDir(dataDir), `${id}.md`), stale, "utf-8");
    const updatedAtBefore = stale.match(/updatedAt:\s*(\S+)/)?.[1];

    // Re-push same body with any client title → server re-normalizes, title-only path
    const second = await push(dataDir, [docItem({ data: { title: "Stale Client Title", body: "# Body\n\nstable body content." } })]);
    expect(second.body.results[0].documents[0].action).toBe("skipped");
    expect(second.body.results[0].documents[0].id).toBe(id);
    expect(second.body.results[0].documents[0].title).toBe("guides-deploy");
    expect(versionTypes(dataDir, id)).toEqual(["import"]); // no new versions
    const mdAfter = readDoc(dataDir, id);
    expect(mdAfter).toMatch(/title:\s*guides-deploy/);
    expect(mdAfter.match(/updatedAt:\s*(\S+)/)?.[1]).toBe(updatedAtBefore);
  });

  it("still merges with path title when body changes", async () => {
    const dataDir = makeDataDir();
    const first = await push(dataDir, [docItem({ data: { body: "# Body\n\nold content." } })]);
    const id = first.body.results[0].documents[0].id as string;
    const second = await push(dataDir, [docItem({ data: { title: "whatever", body: "# Body\n\nnew content." } })]);
    expect(second.body.results[0].documents[0].action).toBe("merged");
    expect(second.body.results[0].documents[0].title).toBe("guides-deploy");
    expect(versionTypes(dataDir, id)).toEqual(["import", "pre-import-overwrite", "import"]);
    expect(readDoc(dataDir, id)).toContain("new content");
    expect(readDoc(dataDir, id)).toMatch(/title:\s*guides-deploy/);
  });
});
