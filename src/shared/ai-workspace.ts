/**
 * ai-workspace.ts — 「AI 空间」与双层记忆的身份约定（spec ai-workspace）。
 *
 * AI 空间**不落盘为可写行**：读文件夹表时按项目注入，写回时过滤掉 —— 与 `dp_default`
 * 同一套「虚拟 + 受保护」模式。这样即便文件夹表被整表覆写，保护行也不可能被抹掉。
 * id 由项目 id 确定性推导，客户端与服务端据此各自算出同一个答案，无需额外同步。
 */

export const DEFAULT_PROJECT_KEY = "dp_default";
export const AI_WORKSPACE_FOLDER_PREFIX = "df_ai_";
export const AI_WORKSPACE_FOLDER_NAME = "AI 空间";
export const MEMORY_DOC_PREFIX = "doc_memory_";
export const MEMORY_DOC_TITLE = "记忆";

/** `null` / `undefined` 一律归一为默认目录。 */
export function projectKey(projectId?: string | null): string {
  return projectId || DEFAULT_PROJECT_KEY;
}

export function aiWorkspaceFolderId(projectId?: string | null): string {
  return `${AI_WORKSPACE_FOLDER_PREFIX}${projectKey(projectId)}`;
}

export function isAiWorkspaceFolderId(folderId?: string | null): boolean {
  return !!folderId && folderId.startsWith(AI_WORKSPACE_FOLDER_PREFIX);
}

export function memoryDocId(projectId?: string | null): string {
  return `${MEMORY_DOC_PREFIX}${projectKey(projectId)}`;
}

export function isMemoryDocId(docId?: string | null): boolean {
  return !!docId && docId.startsWith(MEMORY_DOC_PREFIX);
}

/** 一个项目的 AI 空间条目（虚拟，读时注入）。 */
export function aiWorkspaceFolder(projectId?: string | null): {
  id: string;
  name: string;
  projectId: string | null;
} {
  return {
    id: aiWorkspaceFolderId(projectId),
    name: AI_WORKSPACE_FOLDER_NAME,
    projectId: projectId ?? null,
  };
}

export const MEMORY_DOC_TEMPLATE = `记录长期成立的事实与偏好。AI 会在这里读写，你也可以直接编辑 —— 它和普通文档一样有版本历史，改坏了可以回滚。

## 偏好

## 事实
`;

/**
 * AI 空间置顶于所属项目的文件夹列表首位（spec ai-workspace）。
 * 原数组不被修改；非 AI 空间的相对顺序保持不变。
 */
export function sortAiWorkspaceFirst<T extends { id: string }>(folders: T[]): T[] {
  const workspaces = folders.filter((f) => isAiWorkspaceFolderId(f.id));
  const rest = folders.filter((f) => !isAiWorkspaceFolderId(f.id));
  return [...workspaces, ...rest];
}

/**
 * 用户点名要的产物落哪个项目（spec ai-workspace 产物落位规则）：
 * 来源唯一且带项目属性 → 继承它；跨多个项目或没有项目属性 → 默认目录（`null`）。
 */
export function resolveProductProjectId(sourceProjectIds: (string | null | undefined)[]): string | null {
  const named = new Set(sourceProjectIds.filter((id): id is string => !!id && id !== DEFAULT_PROJECT_KEY));
  return named.size === 1 ? [...named][0] : null;
}

/**
 * 是否属于「整理文档目录」的归类候选（spec ai-workspace）。
 * 记忆与 AI 空间里的东西是 AI 为完成工作产生的，重新归类它们没有意义，
 * 更会让计划文档把自己也列进去。
 */
export function isOrganizeCandidate(doc: { id: string; folderId?: string | null }): boolean {
  return !isMemoryDocId(doc.id) && !isAiWorkspaceFolderId(doc.folderId);
}

/** 记忆置顶于所属 AI 空间首位（spec ai-workspace）。原数组不被修改。 */
export function sortMemoryFirst<T extends { id: string }>(documents: T[]): T[] {
  const memory = documents.filter((d) => isMemoryDocId(d.id));
  const rest = documents.filter((d) => !isMemoryDocId(d.id));
  return [...memory, ...rest];
}
