/**
 * agent-write-policy.ts — AI 对既有数据的写权限边界（spec agent-write-policy）。
 *
 * 权限按**出身**划、不按**位置**划：AI 可改自己生成的文档与 AI 空间里的一切，
 * 不可改用户导入或手写文档的正文。这么划是因为产物落位规则要求「转文档的结果落用户的项目」——
 * 若按位置划（只有 AI 空间可写），两者直接打架。判据全部已存在于既有元数据里，不需要新字段。
 *
 * 拒绝一律抛 `WritePolicyError`，消息是给**用户**看的中文原因，不是内部代码。
 */
import { isAiWorkspaceFolderId, isMemoryDocId } from "@/shared/ai-workspace";

export class WritePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WritePolicyError";
  }
}

export interface WritableDoc {
  id: string;
  title?: string;
  folderId?: string | null;
  generatedBy?: string;
  sourceConversationId?: string;
  sourceAiChatId?: string;
}

/** 出身判据：带生成血缘的文档就是 AI 自己的产物。 */
export function isAiGenerated(doc: WritableDoc): boolean {
  return !!(doc.generatedBy || doc.sourceConversationId || doc.sourceAiChatId);
}

export function isInAiWorkspace(doc: WritableDoc): boolean {
  return isAiWorkspaceFolderId(doc.folderId) || isMemoryDocId(doc.id);
}

export function canRewriteBody(doc: WritableDoc): boolean {
  return isAiGenerated(doc) || isInAiWorkspace(doc);
}

/**
 * 改写正文前必须过这一关。允许时**调用方仍须走 `commitVersion`** —— 见 `assertBodyRewrite`，
 * 那是「可回滚」这条前提得以成立的唯一保证。
 */
export function assertCanRewriteBody(doc: WritableDoc): void {
  if (canRewriteBody(doc)) return;
  throw new WritePolicyError(
    `《${doc.title ?? doc.id}》是你自己导入或手写的文档，AI 不改它的正文。` +
      `如果想让 AI 改，可以先把它转成 AI 产物，或把批注意见交给「根据批注重写」。`,
  );
}

/**
 * 改写正文的唯一合法形态（spec agent-write-policy）：过权限 + 走 `commitVersion`。
 * 「转文档再转一次会覆盖既有正文」正是靠这条才可被接受 —— 覆盖前留下可回滚的版本。
 */
export function assertBodyRewrite(doc: WritableDoc, endpoint: string): void {
  assertCanRewriteBody(doc);
  if (!endpoint.includes("/commit-version")) {
    throw new WritePolicyError(
      `AI 改写正文必须落为新版本（commit-version），否则旧版本无法回滚。当前写入走的是 ${endpoint}。`,
    );
  }
}

/** 改归属元数据（folderId / projectId）不受出身限制 —— 它不动正文。 */
export function assertCanAssignFolder(doc: WritableDoc): void {
  if (isMemoryDocId(doc.id)) {
    throw new WritePolicyError("记忆固定在 AI 空间里，不参与归类。");
  }
}

/** AI 不删数据：删除只能作为计划条目提议，由用户自己执行。 */
export function assertNotDeleting(target: "document" | "folder"): never {
  throw new WritePolicyError(
    target === "document"
      ? "AI 不删除文档。如果某篇确实该删，它会写进计划里由你来决定。"
      : "AI 不删除文件夹。如果某个文件夹确实该删，它会写进计划里由你来决定。",
  );
}

/** 会话的 `folderId` 存的是采集来源平台身份，不是用户分类，改它等同篡改来源。 */
export function assertNotWritingConversation(): never {
  throw new WritePolicyError(
    "AI 不改动任何会话（包括它的归类）—— 会话按来源平台归类，那是采集来源而非分类。" +
      "会话的整理只会以产出一篇新文档的方式表达。",
  );
}

/**
 * 遇到不一致的既有数据（孤儿文件夹、重名文件夹）时保持保守（spec agent-write-policy）。
 * 返回给模型的是「如实报告用的句子」，不是可执行的清理动作 —— 一个「聪明」的 agent
 * 最容易在这里顺手把用户的数据清理掉。
 */
export function auditFolderAnomalies(params: {
  folders: { id: string; name: string; projectId?: string | null }[];
  projectIds: string[];
}): string[] {
  const known = new Set([...params.projectIds, null as unknown as string]);
  const notes: string[] = [];

  for (const folder of params.folders) {
    const project = folder.projectId ?? null;
    if (project !== null && !known.has(project)) {
      notes.push(`文件夹「${folder.name}」(${folder.id}) 的所属项目 ${project} 已不存在 —— 只报告，未做任何处置。`);
    }
  }

  const byName = new Map<string, string[]>();
  for (const folder of params.folders) {
    if (isAiWorkspaceFolderId(folder.id)) continue; // 每个项目各一个同名 AI 空间，是设计如此
    byName.set(folder.name, [...(byName.get(folder.name) ?? []), folder.id]);
  }
  for (const [name, ids] of byName) {
    if (ids.length > 1) notes.push(`有 ${ids.length} 个同名文件夹「${name}」(${ids.join(", ")}) —— 只报告，未做合并。`);
  }

  return notes;
}
