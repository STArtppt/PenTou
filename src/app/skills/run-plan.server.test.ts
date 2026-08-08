/**
 * run-plan 打通**真实服务端**的端到端（spec plan-run-status §6 验证）。
 *
 * 与 `run-plan.test.ts` 的分工：那份用 mock 的 `/api/*` 钉执行逻辑；这份把客户端执行链路
 * 直接接到 `documentsApiHandler` 与临时数据目录上，钉的是**落盘后的物理事实** ——
 * 单靠 mock 断言不了「磁盘上正文一个字没变」「版本历史没多一条」这类东西。
 *
 * 特别覆盖 design D7：回写 `aiPlanRun` 会刷新**计划文档自己**的 `updatedAt`，
 * 而快照只覆盖目标文档，因此不自伤 —— 这条只有跑真服务端才验得了。
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import {
  DOCS_DIR,
  setDocsDataDir,
  ensureDocDirs,
  upsertDocument,
  documentsApiHandler,
} from "../../../vite-plugins/documentsPlugin";
import { aiWorkspaceFolderId, projectKey } from "@/shared/ai-workspace";
import { runPlanDoc } from "./run-plan";
import { parsePlanRun, renderPlanBody, serializePlan, type AgentPlan } from "./plan-doc";
import { cleanupFolderName } from "./project-taxonomy";
import type { SkillDeps } from "../skill-runtime";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDataDir(): string {
  const abs = fs.mkdtempSync(path.join(tmpdir(), "pentou-run-plan-server-"));
  cleanupDirs.push(abs);
  setDocsDataDir(abs);
  ensureDocDirs(abs);
  return abs;
}

/** 把 `fetchImpl` 接到真实 handler 上：技能侧代码一行不改，走的是同一条 HTTP 语义。 */
function serverDeps(): SkillDeps {
  return {
    apiBase: "",
    fetchImpl: (async (url: string, init?: any) => {
      const method = init?.method ?? "GET";
      const req: any = Readable.from(init?.body ? [Buffer.from(init.body)] : []);
      req.headers = { "content-type": "application/json" };
      req.method = method;
      req.url = url;
      let status = 0;
      let payload = "";
      const res: any = {
        writeHead: (code: number) => {
          status = code;
        },
        end: (chunk?: string) => {
          payload = chunk ?? "";
        },
      };
      const handled = await documentsApiHandler(req, res);
      if (!handled) return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
      return { ok: status < 400, status, text: async () => payload, json: async () => JSON.parse(payload) };
    }) as unknown as typeof fetch,
    callLLM: async () => {
      throw new Error("执行计划不该调用 LLM");
    },
    llmConfig: {} as SkillDeps["llmConfig"],
  };
}

const PROJECT = projectKey(null);
const AI_FOLDER = aiWorkspaceFolderId(null);
const CLEANUP = cleanupFolderName("zh");

const readMd = (id: string) => fs.readFileSync(path.join(DOCS_DIR, `${id}.md`), "utf-8");
const bodyOf = (id: string) => readMd(id).split(/^---$/m)[2].replace(/^\n/, "");
/** 与服务端 `parseDocumentMd` 同口径地脱引号，否则拿到的是带引号的字面量。 */
const metaOf = (id: string) => {
  const fm = readMd(id).split(/^---$/m)[1];
  return Object.fromEntries(
    fm
      .split("\n")
      .map((l) => l.match(/^(\w+):\s*(.*)$/))
      .filter(Boolean)
      .map((m) => {
        const raw = m![2].trim();
        const val = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1).replace(/\\"/g, '"') : raw;
        return [m![1], val];
      }),
  ) as Record<string, string>;
};
const versionCount = (id: string) =>
  JSON.parse(fs.readFileSync(path.join(DOCS_DIR, `${id}.versions`, "index.json"), "utf-8")).versions.length;

/** 播下两篇归类目标 + 一篇待清理目标 + 一篇计划文档，快照取磁盘上的真实 updatedAt。 */
function seedWorld() {
  const dir = tempDataDir();
  fs.writeFileSync(
    path.join(dir, "document-folders.json"),
    JSON.stringify([{ id: "df_dev", name: "开发指南", projectId: null }]),
    "utf-8",
  );
  for (const [id, title] of [
    ["doc_a", "A"],
    ["doc_b", "B"],
    ["doc_c", "C"],
  ]) {
    upsertDocument({
      id,
      title,
      folderId: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      body: `# ${title}\n\n正文。\n`,
      versionType: "import",
    });
  }

  const plan: AgentPlan = {
    version: 1,
    projectId: PROJECT,
    createdAt: "2026-08-05T00:00:00.000Z",
    items: [
      { kind: "assign-folder", docId: "doc_a", docTitle: "A", folderName: "开发指南", folderId: "df_dev" },
      { kind: "assign-folder", docId: "doc_b", docTitle: "B", folderName: "读书笔记", folderId: null },
      { kind: "suggest-cleanup", docId: "doc_c", docTitle: "C", reason: "空壳" },
    ],
    snapshot: ["doc_a", "doc_b", "doc_c"].map((id) => ({ docId: id, updatedAt: metaOf(id).updatedAt })),
    folderBaseline: [{ id: "df_dev", name: "开发指南" }],
    notes: [],
    lang: "zh",
  };
  upsertDocument({
    id: "doc_plan",
    title: "整理计划",
    folderId: AI_FOLDER,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    body: renderPlanBody(plan),
    aiPlan: serializePlan(plan),
    versionType: "import",
  });
  return plan;
}

describe("执行计划打通真实服务端（spec plan-run-status）", () => {
  it("执行后磁盘上：终态进 frontmatter、正文逐字未变、版本历史没多一条", async () => {
    seedWorld();
    const bodyBefore = bodyOf("doc_plan");
    const versionsBefore = versionCount("doc_plan");

    const result = await runPlanDoc(serverDeps(), "doc_plan", "ai_sess_real");

    expect(result).toMatchObject({ approved: 3, skipped: 0, cleaned: 1 });
    expect(bodyOf("doc_plan")).toBe(bodyBefore);
    expect(versionCount("doc_plan")).toBe(versionsBefore);

    const run = parsePlanRun(metaOf("doc_plan").aiPlanRun)!;
    expect(run).toMatchObject({ status: "done", approved: 3, cleaned: 1, sessionId: "ai_sess_real" });
    expect(run.assigned.map((a) => a.docId)).toEqual(["doc_a", "doc_b", "doc_c"]);
  });

  it("归属真的改了，且待清理只是改归属 —— 一篇文档都没被删", async () => {
    seedWorld();
    const filesBefore = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md")).length;

    await runPlanDoc(serverDeps(), "doc_plan");

    expect(metaOf("doc_a").folderId).toBe("df_dev");
    const folders = JSON.parse(fs.readFileSync(path.join(path.dirname(DOCS_DIR), "document-folders.json"), "utf-8"));
    const cleanupFolder = folders.find((f: any) => f.name === CLEANUP);
    expect(cleanupFolder).toBeTruthy();
    expect(metaOf("doc_c").folderId).toBe(cleanupFolder.id);
    expect(fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"))).toHaveLength(filesBefore);
  });

  it("D7：回写刷新了计划文档自己的 updatedAt，但快照不含它，因此不自伤", async () => {
    const plan = seedWorld();
    const planUpdatedBefore = metaOf("doc_plan").updatedAt;
    expect(plan.snapshot.map((s) => s.docId)).not.toContain("doc_plan");

    await expect(runPlanDoc(serverDeps(), "doc_plan")).resolves.toBeTruthy();

    expect(metaOf("doc_plan").updatedAt).not.toBe(planUpdatedBefore);
  });

  it("存量计划（无 aiPlanRun）读回就是「未执行」，不报错", async () => {
    seedWorld();
    expect(metaOf("doc_plan").aiPlanRun).toBeUndefined();
    expect(parsePlanRun(undefined)).toBeNull();
  });
});
