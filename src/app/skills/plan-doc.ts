/**
 * plan-doc.ts — 行动计划文档的格式与执行（spec agent-write-policy「计划文档批准协议」）。
 *
 * 计划是 AI 空间里的一篇普通 Markdown：正文每条挂 `- [ ]`，结构化绑定存 frontmatter 的 `aiPlan`。
 * 执行时**只读复选框、不解析条目文字**（design D4）—— 用户可以随便改写描述、加自己的注解，
 * 不影响执行语义；勾选即选择，解析只看一个字符。
 *
 * 执行前两道闸：文档快照（避免在陈旧计划上行动）与文件夹表基底（整表覆写的丢更新防护，D10）。
 * 任一失配都**中止并提示**，绝不静默覆盖或「尽力而为地执行一部分」。
 */
import { aiWorkspaceFolderId, projectKey } from "@/shared/ai-workspace";
import { WritePolicyError } from "./agent-write-policy";
import { cleanupFolderName } from "./project-taxonomy";
import { normalizeSkillLang, skillStrings, type SkillLang } from "./skill-i18n";

export const PLAN_FORMAT_VERSION = 1;

/** 归类条目：改 `folderId`，正文一个字不动。 */
export interface AssignFolderItem {
  kind: "assign-folder";
  docId: string;
  docTitle: string;
  folderName: string;
  /** 已存在的目标文件夹；缺省表示执行时需要先新建。 */
  folderId?: string | null;
  reason?: string;
}

/**
 * 清理提议（design D7）：可勾选、可执行，但执行语义是**归入待清理文件夹**，
 * MUST NOT 调任何删除。AI 把该清的挑出来堆到一起，「删不删」这个不可逆决定仍在用户手上。
 */
export interface SuggestCleanupItem {
  kind: "suggest-cleanup";
  docId: string;
  docTitle: string;
  reason?: string;
}

export type PlanItem = AssignFolderItem | SuggestCleanupItem;

const KNOWN_KINDS = new Set(["assign-folder", "suggest-cleanup"]);

export interface AgentPlan {
  version: number;
  projectId: string;
  createdAt: string;
  items: PlanItem[];
  /** 生成计划时所依据的数据快照，执行前逐条比对。 */
  snapshot: { docId: string; updatedAt: string }[];
  /** 文件夹表基底（D10）：执行前重读比对，变了即中止。 */
  folderBaseline: { id: string; name: string }[];
  /** 只报告不处置的数据异常（孤儿 / 重名文件夹等）。 */
  notes: string[];
  /** 项目类型判定与依据（spec project-type-taxonomy），写进正文供用户核对与推翻。 */
  projectType?: "dev" | "knowledge";
  typeReason?: string;
  /** 产出该计划时的界面语言，决定正文与待清理文件夹名。 */
  lang?: SkillLang;
}

const CHECKBOX_RE = /^\s*-\s*\[([ xX])\]/;

/**
 * 条目的渲染顺序：归类在前、清理在后（后果不同类必须分节，spec agent-write-policy）。
 * 渲染与执行**共用这一个顺序**，复选框与条目的对齐才不依赖生产端怎么排数组。
 */
export function orderedItems(plan: AgentPlan): PlanItem[] {
  return [
    ...plan.items.filter((i) => i.kind === "assign-folder"),
    ...plan.items.filter((i) => i.kind === "suggest-cleanup"),
  ];
}

/** 清理条目的落脚目录名。 */
export function targetFolderName(item: PlanItem, lang: SkillLang = "zh"): string {
  return item.kind === "suggest-cleanup" ? cleanupFolderName(lang) : item.folderName;
}

/**
 * 计划正文：条目 + 只报告不处置的异常。文字随便改，执行看的是复选框与 frontmatter。
 * 条目**默认全部勾选**（design D8）—— 语义是「AI 已给出建议，取消勾选表示不采纳」，
 * 因此开头的说明文字必须把这层反转讲清楚，否则用户会以为需要自己逐条勾。
 */
export function renderPlanBody(plan: AgentPlan): string {
  const lang = normalizeSkillLang(plan.lang);
  const s = skillStrings(lang).plan;
  const assigns = plan.items.filter((i): i is AssignFolderItem => i.kind === "assign-folder");
  const cleanups = plan.items.filter((i): i is SuggestCleanupItem => i.kind === "suggest-cleanup");

  const lines = [...s.preamble, ""];

  if (plan.projectType) {
    lines.push(
      s.projectTypeHeading,
      "",
      s.projectTypeLine(
        plan.projectType === "dev" ? s.projectTypeDev : s.projectTypeKnowledge,
        plan.typeReason,
      ),
      "",
    );
  }

  if (assigns.length) {
    lines.push(s.todoHeading, "");
    for (const item of assigns) {
      lines.push(`- [x] ${s.assignItem(item.docTitle, item.folderName, item.reason)}`);
    }
  }

  if (cleanups.length) {
    lines.push("", s.cleanupHeading, "", s.cleanupHint(cleanupFolderName(lang)), "");
    for (const item of cleanups) {
      lines.push(`- [x] ${s.cleanupItem(item.docTitle, item.reason)}`);
    }
  }

  if (plan.notes.length) {
    lines.push("", s.notesHeading, "");
    for (const note of plan.notes) lines.push(`- ${note}`);
  }
  return lines.join("\n") + "\n";
}

export function serializePlan(plan: AgentPlan): string {
  return JSON.stringify(plan);
}

/**
 * 未知 `kind` 的条目 MUST 跳过而非抛错（design Migration 1）：
 * 新客户端写的计划可能带旧客户端不认识的条目类型，此时执行已认识的那部分，
 * 而不是让整份计划变成一块砖。条数因此可能与正文复选框对不上 —— 那由
 * `selectApprovedItems` 报出并要求重新生成，仍然不会误执行。
 */
export function parsePlan(raw: string | undefined): AgentPlan | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AgentPlan;
    if (!Array.isArray(parsed?.items)) return null;
    return { ...parsed, items: parsed.items.filter((item) => KNOWN_KINDS.has((item as PlanItem)?.kind)) };
  } catch {
    return null;
  }
}

/**
 * 只读复选框的勾选状态，按出现顺序返回。刻意不看条目文字。
 * `## 只报告，不处置` 里的条目不带复选框，因此天然不会被算进来。
 */
export function readCheckedFlags(body: string): boolean[] {
  const flags: boolean[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(CHECKBOX_RE);
    if (m) flags.push(m[1].toLowerCase() === "x");
  }
  return flags;
}

/**
 * 按顺序把复选框与 frontmatter 里的条目对齐。
 * 条数对不上说明用户增删了条目行 —— 此时任何对齐都是猜测，宁可中止让人重新生成。
 */
export function selectApprovedItems(plan: AgentPlan, body: string): PlanItem[] {
  const flags = readCheckedFlags(body);
  const items = orderedItems(plan);
  if (flags.length !== items.length) {
    throw new WritePolicyError(
      `计划正文里有 ${flags.length} 个复选框，但记录的条目是 ${items.length} 条 —— ` +
        `条目被增删过，无法安全对齐。请让 AI 重新生成一份计划。`,
    );
  }
  return items.filter((_, i) => flags[i]);
}

export interface DocSnapshotProbe {
  (docId: string): Promise<{ updatedAt: string } | null>;
}

/** 执行前逐条比对快照；任一失配即中止，绝不在陈旧计划上行动。 */
export async function assertSnapshotFresh(
  plan: AgentPlan,
  items: PlanItem[],
  probe: DocSnapshotProbe,
): Promise<void> {
  const expected = new Map(plan.snapshot.map((entry) => [entry.docId, entry.updatedAt]));
  for (const item of items) {
    const want = expected.get(item.docId);
    const got = await probe(item.docId);
    if (!got) {
      throw new WritePolicyError(`《${item.docTitle}》已不存在，计划已过期。请让 AI 重新生成一份计划。`);
    }
    if (want !== got.updatedAt) {
      throw new WritePolicyError(
        `《${item.docTitle}》在计划生成之后被改过，计划已过期。请让 AI 重新生成一份计划。`,
      );
    }
  }
}

/**
 * 文件夹表的丢更新防护（design D10）：写前重读为基底，与计划记录的基底逐条比对。
 * 基底变了就中止 —— 用户在 AI 执行期间新建的文件夹绝不能被整表覆写抹掉。
 */
export function assertFolderBaselineIntact(
  plan: AgentPlan,
  current: { id: string; name: string }[],
): void {
  const before = new Map(plan.folderBaseline.map((f) => [f.id, f.name]));
  const now = new Map(current.map((f) => [f.id, f.name]));
  const changed =
    before.size !== now.size ||
    [...before].some(([id, name]) => now.get(id) !== name);
  if (changed) {
    throw new WritePolicyError(
      "文件夹在计划生成之后发生了变化（可能是你刚新建或改名了文件夹）。为避免覆盖你的改动，本次执行已中止 —— 请让 AI 重新生成一份计划。",
    );
  }
}

export interface PlanExecutorApi {
  /** 重读文件夹表，作为「只增不改删」写回的基底。 */
  listFolders: () => Promise<{ id: string; name: string; projectId?: string | null }[]>;
  /** 整表写回；调用方须保证只在基底上追加。 */
  saveFolders: (folders: { id: string; name: string; projectId?: string | null }[]) => Promise<void>;
  readDocMeta: DocSnapshotProbe;
  assignFolder: (docId: string, folderId: string, projectId: string | null) => Promise<void>;
  newFolderId: () => string;
}

export interface PlanExecutionResult {
  approved: number;
  skipped: number;
  createdFolders: { id: string; name: string }[];
  assigned: { docId: string; folderId: string }[];
  /** 被归入待清理文件夹的文档数（design D7）。执行结果提示要点明「没删」。 */
  cleaned: number;
}

/**
 * 执行一份被批准的计划。顺序刻意如此：先校验（快照 → 基底），再建文件夹，最后改归属。
 * 任何一步抛错都在**写入之前**，因此中止时数据零变更。
 */
export async function executePlan(
  plan: AgentPlan,
  body: string,
  api: PlanExecutorApi,
): Promise<PlanExecutionResult> {
  const approved = selectApprovedItems(plan, body);
  const lang = normalizeSkillLang(plan.lang);
  const result: PlanExecutionResult = {
    approved: approved.length,
    skipped: plan.items.length - approved.length,
    createdFolders: [],
    assigned: [],
    cleaned: 0,
  };
  if (!approved.length) return result;

  await assertSnapshotFresh(plan, approved, api.readDocMeta);

  const projectId = plan.projectId === projectKey(null) ? null : plan.projectId;
  const stored = await api.listFolders();
  // 基底比对只看该项目下的非 AI 空间文件夹 —— 别的项目改了什么与本计划无关。
  const scoped = stored.filter(
    (f) => (f.projectId ?? projectKey(null)) === plan.projectId && f.id !== aiWorkspaceFolderId(projectId),
  );
  assertFolderBaselineIntact(plan, scoped.map((f) => ({ id: f.id, name: f.name })));

  // 只增不改删：以重读到的最新版本为基底追加，绝不改动或移除既有条目。
  // 清理条目走的也是这条路：「归入 `_待清理`」就是一次普通的改归属（design D7）。
  // 这里没有、也永远不会有任何删除调用。
  const appended = [...stored];
  const idByName = new Map(scoped.map((f) => [f.name, f.id]));
  for (const item of approved) {
    const folderName = targetFolderName(item, lang);
    if ((item.kind === "assign-folder" && item.folderId) || idByName.has(folderName)) continue;
    const id = api.newFolderId();
    appended.push({ id, name: folderName, projectId });
    idByName.set(folderName, id);
    result.createdFolders.push({ id, name: folderName });
  }
  if (result.createdFolders.length) await api.saveFolders(appended);

  for (const item of approved) {
    const folderName = targetFolderName(item, lang);
    const folderId = (item.kind === "assign-folder" ? item.folderId : null) || idByName.get(folderName);
    if (!folderId) continue;
    await api.assignFolder(item.docId, folderId, projectId);
    result.assigned.push({ docId: item.docId, folderId });
    if (item.kind === "suggest-cleanup") result.cleaned++;
  }
  return result;
}
