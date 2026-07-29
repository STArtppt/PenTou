/**
 * document-projects.ts —— 文档平面项目维度的纯逻辑（spec document-projects）。
 *
 * 过滤与目标树构造抽出为纯函数：Sidebar 的单项移动、批量移动与列表过滤共用同一份实现，
 * 避免"侧栏看到的"和"移动菜单里的"两套口径分叉。
 */
import type { Document, DocumentFolder, DocumentProject } from "./data";

/** `null` 表示默认目录；归一化 `undefined` / `null` 两种缺省写法。 */
export function projectKeyOf(item: { projectId?: string | null }): string | null {
  return item.projectId ?? null;
}

export function filterDocumentsByProject(documents: Document[], projectId: string | null): Document[] {
  return documents.filter((doc) => projectKeyOf(doc) === projectId);
}

export function filterFoldersByProject(folders: DocumentFolder[], projectId: string | null): DocumentFolder[] {
  return folders.filter((folder) => projectKeyOf(folder) === projectId);
}

/**
 * 按时间排序文档，与会话列表同口径（spec conversation-time-and-sort US-03）：
 * 时间取更新时间、缺失时退回创建时间、都解析不出来算 0；同一时间以标题稳定兜底，
 * 否则同一秒批量入库的一批文档每次渲染顺序都可能不同。原数组不被修改。
 */
export function sortDocumentsByTime(documents: Document[], ascending: boolean): Document[] {
  const dir = ascending ? 1 : -1;
  const timeOf = (doc: Document) => {
    const raw = new Date(doc.updatedAt || doc.createdAt || "").getTime();
    return Number.isNaN(raw) ? 0 : raw;
  };
  return [...documents].sort((a, b) => {
    const va = timeOf(a);
    const vb = timeOf(b);
    if (va === vb) return (a.title ?? "").localeCompare(b.title ?? "");
    return (va - vb) * dir;
  });
}

/** 项目内未分类：folderId 为空，或指向的文件夹不属于本项目（存量数据自愈）。 */
export function uncategorizedInProject(
  documents: Document[],
  folders: DocumentFolder[],
  projectId: string | null,
): Document[] {
  const ids = new Set(filterFoldersByProject(folders, projectId).map((folder) => folder.id));
  return filterDocumentsByProject(documents, projectId).filter((doc) => !doc.folderId || !ids.has(doc.folderId));
}

export interface MoveTarget {
  id: string | null;
  name: string;
}

export interface MoveTargetGroup {
  key: string;
  /** 分组标题；对话视图不传（渲染成与本变更前一致的扁平列表）。 */
  label?: string;
  projectId: string | null;
  targets: MoveTarget[];
}

/**
 * 「项目 → 未分类/文件夹」两层目标树。这只是**如实呈现已有的两级归属**，
 * 不是给文件夹加嵌套——文件夹本身仍然是一层。
 */
export function buildMoveTargetGroups(params: {
  folders: DocumentFolder[];
  projects: DocumentProject[];
  defaultProjectLabel: string;
  uncategorizedLabel: string;
}): MoveTargetGroup[] {
  const group = (projectId: string | null, key: string, label: string): MoveTargetGroup => ({
    key,
    label,
    projectId,
    targets: [
      { id: null, name: params.uncategorizedLabel },
      ...filterFoldersByProject(params.folders, projectId).map((folder) => ({ id: folder.id, name: folder.name })),
    ],
  });
  return [
    group(null, "dp_default", params.defaultProjectLabel),
    ...params.projects.map((project) => group(project.id, project.id, project.name)),
  ];
}

/** 目标树的总行数（含分组标题），供子菜单定高。 */
export function moveGroupRowCount(groups: MoveTargetGroup[]): number {
  return groups.reduce((sum, group) => sum + group.targets.length + (group.label ? 1 : 0), 0);
}

/**
 * 移动后文档应归属的项目（design 决策 8 的不变量）：
 * folderId 非空时**必须**取该文件夹的项目，否则会出现"属于项目 A 却在项目 B 的
 * 文件夹里"的幽灵状态；folderId 为空时用显式指定的项目，未指定则保持原项目。
 */
export function resolveMoveProjectId(params: {
  folders: DocumentFolder[];
  folderId: string | null;
  requestedProjectId?: string | null;
  currentProjectId?: string | null;
}): string | null {
  const folder = params.folderId ? params.folders.find((f) => f.id === params.folderId) : null;
  if (folder) return projectKeyOf(folder);
  if (params.requestedProjectId !== undefined) return params.requestedProjectId ?? null;
  return params.currentProjectId ?? null;
}
