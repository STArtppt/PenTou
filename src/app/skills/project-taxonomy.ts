/**
 * project-taxonomy.ts — 项目类型与典型目录结构（spec project-type-taxonomy / design D5 · D6）。
 *
 * 两套典型结构是**提议的基底**，不是要被无条件创建出来的骨架：只有确实有文档被提议归入的
 * 典型目录才会进计划。空目录对用户没有价值。
 *
 * 数量约束（新增 ≤3、执行后总数 ≤10）在**客户端强制**。写进 prompt 只是让模型往这个方向努力，
 * LLM 对计数约束的遵守率经验上就不可靠 —— 与 doc-folder-organize 里「模型编造的 docId 由客户端
 * 最后过滤」是同一条纪律。
 */

import { skillStrings, type SkillLang } from "./skill-i18n";

export type ProjectType = "dev" | "knowledge";

/** 开发项目：来自一位重度使用 AI 编程的开发者手工整理的真实项目目录（design Context）。 */
export const DEV_FOLDERS = [
  "设计文档",
  "开发记录",
  "部署运维",
  "常见问题",
  "运营文档",
  "接口文档",
  "宣传文档",
] as const;

/** 知识工作项目：文档是产出物而非源代码，目录围绕「对话资产沉淀」。 */
export const KNOWLEDGE_FOLDERS = ["1_输入原料", "2_输出产物", "3_数字藏馆"] as const;

export const DEV_FOLDERS_EN = [
  "Design Docs",
  "Dev Log",
  "Deploy & Ops",
  "FAQ",
  "Operations",
  "API Docs",
  "Marketing",
] as const;

export const KNOWLEDGE_FOLDERS_EN = ["1_Inputs", "2_Outputs", "3_Archive"] as const;

/** 「建议清理」的落脚点。普通文件夹，用户可改名 / 可删 / 可搬东西出来（design D7）。 */
export const CLEANUP_FOLDER_NAME = "_待清理";
export const CLEANUP_FOLDER_NAME_EN = "_Pending Cleanup";

/** 本次计划最多新增的目录数。 */
export const MAX_NEW_FOLDERS = 3;
/** 执行完成后该项目的目录总数上限。 */
export const MAX_TOTAL_FOLDERS = 10;

export function typicalFoldersFor(type: ProjectType, lang: SkillLang = "zh"): readonly string[] {
  if (lang === "en") return type === "dev" ? DEV_FOLDERS_EN : KNOWLEDGE_FOLDERS_EN;
  return type === "dev" ? DEV_FOLDERS : KNOWLEDGE_FOLDERS;
}

export function cleanupFolderName(lang: SkillLang = "zh"): string {
  return lang === "en" ? CLEANUP_FOLDER_NAME_EN : CLEANUP_FOLDER_NAME;
}

export function isProjectType(value: unknown): value is ProjectType {
  return value === "dev" || value === "knowledge";
}

export interface FolderProposal {
  folderName: string;
  [key: string]: unknown;
}

export interface FolderBudgetResult<T extends FolderProposal> {
  /** 通过数量约束的提议条目。 */
  kept: T[];
  /** 被裁掉的提议条目（整条丢弃，不改塞进别的目录）。 */
  dropped: T[];
  /** 被裁掉的目录名，按裁剪顺序。 */
  droppedFolders: string[];
  /** 裁剪说明；无裁剪时为 null。调用方写进 plan.notes，MUST NOT 静默吞掉。 */
  note: string | null;
}

/**
 * 数量约束的强制执行（design D6）。
 *
 * 允许目录集合 = 该类型的典型结构 ∪ 项目已有文件夹；不在其中的即「新增目录」。
 * 新增目录按其承载的文档条目数降序保留，超出 `MAX_NEW_FOLDERS` 或会让总数超过
 * `MAX_TOTAL_FOLDERS` 的一律裁掉，对应条目**整条丢弃** —— 强行塞进别的目录是替模型瞎猜。
 *
 * 已有文件夹数已达上限时，本次零新增，只在既有目录内归类。
 */
export function enforceFolderBudget<T extends FolderProposal>(
  proposals: T[],
  existingFolders: readonly string[],
  typicalFolders: readonly string[],
  lang: SkillLang = "zh",
): FolderBudgetResult<T> {
  const allowed = new Set<string>([...typicalFolders, ...existingFolders]);
  const existingCount = new Set(existingFolders).size;

  // 新增目录按承载条目数降序；同数时按首次出现顺序，保证结果确定可测。
  const load = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  proposals.forEach((p, i) => {
    const name = p.folderName;
    if (allowed.has(name)) return;
    load.set(name, (load.get(name) ?? 0) + 1);
    if (!firstSeen.has(name)) firstSeen.set(name, i);
  });

  const headroom = Math.max(0, Math.min(MAX_NEW_FOLDERS, MAX_TOTAL_FOLDERS - existingCount));
  const ranked = [...load.keys()].sort(
    (a, b) => (load.get(b)! - load.get(a)!) || (firstSeen.get(a)! - firstSeen.get(b)!),
  );
  const acceptedNew = new Set(ranked.slice(0, headroom));
  const droppedFolders = ranked.slice(headroom);

  const kept: T[] = [];
  const dropped: T[] = [];
  for (const p of proposals) {
    if (allowed.has(p.folderName) || acceptedNew.has(p.folderName)) kept.push(p);
    else dropped.push(p);
  }

  return {
    kept,
    dropped,
    droppedFolders,
    note: dropped.length
      ? skillStrings(lang).plan.budgetNote(
          dropped.length,
          droppedFolders,
          MAX_NEW_FOLDERS,
          MAX_TOTAL_FOLDERS,
        )
      : null,
  };
}
