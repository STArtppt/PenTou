/**
 * projects.ts —— 两平面共用的项目纯逻辑（spec conversation-projects / document-projects）。
 *
 * 过滤与目标树构造抽出为纯函数：Sidebar 的单项移动、批量移动与列表过滤共用同一份实现，
 * 避免"侧栏看到的"和"移动菜单里的"两套口径分叉。
 */
import type { DocumentProject } from "./data";

/** `null` 表示默认目录；归一化 `undefined` / `null` 两种缺省写法。 */
export function projectKeyOf(item: { projectId?: string | null }): string | null {
  return item.projectId ?? null;
}

export function filterByProject<T extends { projectId?: string | null }>(
  items: T[],
  projectId: string | null,
): T[] {
  return items.filter((item) => projectKeyOf(item) === projectId);
}

export function filterFoldersByProject<T extends { projectId?: string | null }>(
  folders: T[],
  projectId: string | null,
): T[] {
  return filterByProject(folders, projectId);
}

/** 项目内未分类：folderId 为空，或指向的文件夹不属于本项目（存量数据自愈）。 */
export function uncategorizedInProject<T extends { projectId?: string | null; folderId?: string | null }>(
  items: T[],
  folders: { id: string; projectId?: string | null }[],
  projectId: string | null,
): T[] {
  const ids = new Set(filterFoldersByProject(folders, projectId).map((folder) => folder.id));
  return filterByProject(items, projectId).filter((item) => !item.folderId || !ids.has(item.folderId));
}

/**
 * 手工导入的项目归属：跟随当前选中的项目（spec conversation-projects §切换项目过滤列表）。
 *
 * 不跟随的话，用户在项目 X 里导入，条目落进默认目录 —— 导入报"成功"、列表里当场找不着，
 * 只有正文区因为自动激活而显示着它。载荷自带 `projectId` 的（解析源已判定过）不覆盖；
 * 当前是默认目录时也不写键，缺键即默认目录。
 */
export function withImportProject<T extends { projectId?: string | null }>(
  item: T,
  activeProjectId: string | null,
): T {
  if (item.projectId !== undefined || !activeProjectId) return item;
  return { ...item, projectId: activeProjectId };
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
  folders: { id: string; name: string; projectId?: string | null }[];
  projects: Pick<DocumentProject, "id" | "name">[];
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
 * 移动后条目应归属的项目（design 决策 8 的不变量）：
 * folderId 非空时**必须**取该文件夹的项目，否则会出现"属于项目 A 却在项目 B 的
 * 文件夹里"的幽灵状态；folderId 为空时用显式指定的项目，未指定则保持原项目。
 */
export function resolveMoveProjectId(params: {
  folders: { id: string; projectId?: string | null }[];
  folderId: string | null;
  requestedProjectId?: string | null;
  currentProjectId?: string | null;
}): string | null {
  const folder = params.folderId ? params.folders.find((f) => f.id === params.folderId) : null;
  if (folder) return projectKeyOf(folder);
  if (params.requestedProjectId !== undefined) return params.requestedProjectId ?? null;
  return params.currentProjectId ?? null;
}
