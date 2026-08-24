/**
 * conversation-projects.ts —— 存量对话按 sourceProject 一次性归集
 * （spec conversation-projects §存量对话按来源项目一次性归集）。
 *
 * 幂等：标记文件 + 「已有 projectId 就跳过」。失败不阻断服务端启动。
 * 只改 projectId / folderId，正文与其它 frontmatter 一个字节都不动。
 */
import fs from "node:fs";
import path from "node:path";
import { findOrCreateProjectByKey, setDocsDataDir } from "../../vite-plugins/documentsPlugin.js";
import {
  patchConversationProjectFields,
  readFrontmatter,
  resolveAutoFolderId,
} from "./conversation-folders.js";
import { log } from "./logger.js";

export const CONVERSATION_PROJECTS_MARKER = "conversation-projects.json";

export interface ConversationProjectsBackfillResult {
  at: string;
  processed: number;
  projects: number;
  skipped: boolean;
}

function markerPath(dataDir: string): string {
  return path.join(dataDir, ".migrations", CONVERSATION_PROJECTS_MARKER);
}

export function readConversationProjectsMarker(dataDir: string): ConversationProjectsBackfillResult | null {
  const file = markerPath(dataDir);
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return {
      at: typeof parsed.at === "string" ? parsed.at : "",
      processed: Number(parsed.processed) || 0,
      projects: Number(parsed.projects) || 0,
      skipped: false,
    };
  } catch {
    return null;
  }
}

function writeMarker(dataDir: string, processed: number, projects: number): void {
  const file = markerPath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    at: new Date().toISOString(),
    processed,
    projects,
  }, null, 2), "utf-8");
}

function fmValue(raw: string | undefined): string | null {
  if (!raw || raw === "null") return null;
  return raw;
}

/**
 * 服务端启动时调用一次。标记已在则直接跳过；单条失败记日志并继续；
 * 整体失败不写标记、由调用方吞掉，绝不阻断启动。
 */
export function backfillConversationProjects(dataDir: string): ConversationProjectsBackfillResult {
  const existing = readConversationProjectsMarker(dataDir);
  if (existing) return { ...existing, skipped: true };

  setDocsDataDir(dataDir);
  const convDir = path.join(dataDir, "conversations");
  if (!fs.existsSync(convDir)) {
    writeMarker(dataDir, 0, 0);
    return { at: new Date().toISOString(), processed: 0, projects: 0, skipped: false };
  }

  let processed = 0;
  const projectIds = new Set<string>();
  for (const name of fs.readdirSync(convDir).filter((file) => file.endsWith(".md"))) {
    try {
      const filePath = path.join(convDir, name);
      const content = fs.readFileSync(filePath, "utf-8");
      const meta = readFrontmatter(content);
      if (!meta) continue;
      if (fmValue(meta.projectId)) continue;
      const sourceProject = fmValue(meta.sourceProject);
      if (!sourceProject) continue;

      const project = findOrCreateProjectByKey(sourceProject, { name: sourceProject });
      const folderId = resolveAutoFolderId(convDir, meta.platform, project.id);
      const patched = patchConversationProjectFields(content, {
        projectId: project.id,
        folderId,
      });
      if (patched !== content) fs.writeFileSync(filePath, patched, "utf-8");
      processed += 1;
      projectIds.add(project.id);
    } catch (error) {
      log.warn(`conversation-projects backfill skip ${name}: ${String(error)}`);
    }
  }

  writeMarker(dataDir, processed, projectIds.size);
  return {
    at: new Date().toISOString(),
    processed,
    projects: projectIds.size,
    skipped: false,
  };
}
