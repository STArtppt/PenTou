/**
 * document-projects.ts —— 文档平面项目维度的纯逻辑（spec document-projects）。
 *
 * 与平面无关的过滤 / 目标树 / 归属不变量已抽到 `projects.ts`，两平面共用；
 * 本文件保留文档专属部分（时间排序）并转发共用函数，避免既有 import 分叉。
 */
import type { Document, DocumentFolder } from "./data";
import {
  filterByProject,
  uncategorizedInProject as uncategorizedItemsInProject,
} from "./projects";

export {
  projectKeyOf,
  filterFoldersByProject,
  buildMoveTargetGroups,
  moveGroupRowCount,
  resolveMoveProjectId,
  type MoveTarget,
  type MoveTargetGroup,
} from "./projects";

export function filterDocumentsByProject(documents: Document[], projectId: string | null): Document[] {
  return filterByProject(documents, projectId);
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
  return uncategorizedItemsInProject(documents, folders, projectId);
}
