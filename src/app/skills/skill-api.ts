/**
 * skill-api.ts — plane B 技能访问 Pentou 数据的唯一通道。
 *
 * 技能里**不写死内部函数调用**，一律经 `/api/*`（AGENTS.md §7 / data/skills/README.md）——
 * 于是同一份技能既能被内部 runner 消费，也能被指向一个运行中实例的外部 agent 消费。
 * `fetchImpl` / `apiBase` 都从 `SkillDeps` 来，测试注入 mock 即可，无需起服务。
 */
import type { SkillDeps } from "../skill-runtime";

export async function apiGet<T>(deps: SkillDeps, path: string): Promise<T> {
  const res = await deps.fetchImpl(`${deps.apiBase}${path}`, { signal: deps.signal });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function apiSend<T>(
  deps: SkillDeps,
  method: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await deps.fetchImpl(`${deps.apiBase}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: deps.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${method} ${path} failed: ${res.status}${detail ? ` ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export interface DocMeta {
  id: string;
  title: string;
  folderId: string | null;
  projectId?: string;
  updatedAt: string;
  generatedBy?: string;
  sourceConversationId?: string;
  sourceAiChatId?: string;
}

export interface FolderRow {
  id: string;
  name: string;
  projectId?: string | null;
}

export function newDocId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function newFolderId(): string {
  return `df_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Markdown 首个 H1 作标题；没有就退回给定的兜底（与既有转文档口径一致）。 */
export function titleFromMarkdown(markdown: string, fallback: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

/** 从模型输出里抠出 JSON（允许它裹在 ```json 围栏或前后废话里）。 */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1), text];
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // 试下一个候选
    }
  }
  return null;
}
