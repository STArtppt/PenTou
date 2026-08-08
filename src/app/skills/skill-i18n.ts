/**
 * skill-i18n.ts — plane B 技能**产出物正文**的中英文案（spec 各产物格式要求）。
 *
 * 为什么不复用 `src/app/i18n.ts`：那份是 React hook（`useTranslation` 读 context），
 * 而技能是纯逻辑、要能被单测与外部 agent 直接调用。这里按 `lang` 取一张表，无任何 React 依赖。
 *
 * 语言从技能入参 `lang` 来，由调用方（AI 侧栏）带上当前界面语言；缺省 `zh`。
 */

export type SkillLang = "zh" | "en";

export function normalizeSkillLang(value: unknown): SkillLang {
  return value === "en" ? "en" : "zh";
}

export interface SkillStrings {
  plan: {
    /** 开头说明：默认全勾选的语义反转必须写清（design D8）。 */
    preamble: string[];
    todoHeading: string;
    cleanupHeading: string;
    /** 清理节前的显式提示：批准后归入待清理文件夹，不会删除。 */
    cleanupHint: (folderName: string) => string;
    notesHeading: string;
    assignItem: (docTitle: string, folderName: string, reason?: string) => string;
    cleanupItem: (docTitle: string, reason?: string) => string;
    projectTypeHeading: string;
    projectTypeLine: (typeLabel: string, reason?: string) => string;
    projectTypeDev: string;
    projectTypeKnowledge: string;
    /** 裁剪说明，写进 plan.notes。 */
    budgetNote: (droppedCount: number, folders: string[], maxNew: number, maxTotal: number) => string;
    typeFallbackNote: (raw: string) => string;
  };
  digest: {
    docTitle: (topic: string) => string;
    scopeHeading: string;
    statsHeading: string;
    /** 统计口径标注：MUST NOT 让读者以为是全库普查（design D2）。 */
    statsScopeNote: (n: number) => string;
    dimPlatform: string;
    dimIngestSource: string;
    dimProject: string;
    dimMonth: string;
    tableValue: string;
    tableCount: string;
    unknownBucket: string;
    deepReadHeading: string;
    sourcesHeading: string;
    /** 深读截断标记。 */
    truncated: (omittedMessages: number) => string;
    conversationLabel: string;
    documentLabel: string;
  };
}

const ZH: SkillStrings = {
  plan: {
    preamble: [
      "**下面的条目已默认全部勾选** —— 这是 AI 给出的建议，**取消勾选即表示不采纳该条**。",
      "确认无误后回到 AI 侧栏点「执行计划」；只有仍处于勾选状态的条目会被执行。",
      "条目的文字你可以随便改写或补注解，不影响执行结果 —— 执行只看复选框。",
    ],
    todoHeading: "## 待办",
    cleanupHeading: "## 建议清理",
    cleanupHint: (folderName) =>
      `以下文档 AI 认为已无保留价值。批准后**归入「${folderName}」文件夹，不会删除** —— 删不删由你自己决定。`,
    notesHeading: "## 只报告，不处置",
    assignItem: (docTitle, folderName, reason) =>
      `把《${docTitle}》归入「${folderName}」${reason ? ` —— ${reason}` : ""}`,
    cleanupItem: (docTitle, reason) => `《${docTitle}》${reason ? ` —— ${reason}` : ""}`,
    projectTypeHeading: "## 项目类型判定",
    projectTypeLine: (typeLabel, reason) =>
      `本项目被判定为**${typeLabel}**${reason ? `，依据：${reason}` : ""}。判错了就让 AI 重新生成一份计划。`,
    projectTypeDev: "开发项目",
    projectTypeKnowledge: "知识工作项目",
    budgetNote: (droppedCount, folders, maxNew, maxTotal) =>
      `因目录数量上限（新增不超过 ${maxNew} 个、总数不超过 ${maxTotal} 个），已略去 ${droppedCount} 条提议` +
      (folders.length ? `（涉及目录：${folders.join("、")}）` : "") +
      "。",
    typeFallbackNote: (raw) => `模型给出的项目类型「${raw}」不可识别，已按知识工作项目处理。`,
  },
  digest: {
    docTitle: (topic) => `主题汇总 · ${topic}`,
    scopeHeading: "## 主题界定",
    statsHeading: "## 分布统计",
    statsScopeNote: (n) =>
      `以下统计基于本次检索中**相关度最高的 ${n} 条**内容，不是该主题的全库普查。`,
    dimPlatform: "平台",
    dimIngestSource: "采集来源",
    dimProject: "所属项目",
    dimMonth: "时间分布（按月）",
    tableValue: "取值",
    tableCount: "条数",
    unknownBucket: "未标注",
    deepReadHeading: "## 深读",
    sourcesHeading: "## 来源",
    truncated: (omittedMessages) => `\n\n……（此处略去 ${omittedMessages} 条消息）……\n\n`,
    conversationLabel: "会话",
    documentLabel: "文档",
  },
};

const EN: SkillStrings = {
  plan: {
    preamble: [
      "**Every item below is checked by default** — these are the AI's suggestions; **unchecking one means you decline it**.",
      "When it looks right, go back to the AI sidebar and hit “Run plan”; only items still checked will run.",
      "Feel free to rewrite the item text or add your own notes — execution reads the checkbox, not the words.",
    ],
    todoHeading: "## To do",
    cleanupHeading: "## Suggested cleanup",
    cleanupHint: (folderName) =>
      `The AI thinks these documents are no longer worth keeping. Approving them **moves them into the “${folderName}” folder — nothing is deleted.** Whether to actually delete stays your call.`,
    notesHeading: "## Reported, not acted on",
    assignItem: (docTitle, folderName, reason) =>
      `Move “${docTitle}” into “${folderName}”${reason ? ` — ${reason}` : ""}`,
    cleanupItem: (docTitle, reason) => `“${docTitle}”${reason ? ` — ${reason}` : ""}`,
    projectTypeHeading: "## Project type",
    projectTypeLine: (typeLabel, reason) =>
      `This project was classified as a **${typeLabel}**${reason ? `, because: ${reason}` : ""}. If that's wrong, ask the AI to regenerate the plan.`,
    projectTypeDev: "development project",
    projectTypeKnowledge: "knowledge-work project",
    budgetNote: (droppedCount, folders, maxNew, maxTotal) =>
      `Folder budget (at most ${maxNew} new folders, ${maxTotal} folders in total) dropped ${droppedCount} proposal(s)` +
      (folders.length ? ` (folders: ${folders.join(", ")})` : "") +
      ".",
    typeFallbackNote: (raw) =>
      `The model returned an unrecognized project type “${raw}”; treated it as a knowledge-work project.`,
  },
  digest: {
    docTitle: (topic) => `Topic digest · ${topic}`,
    scopeHeading: "## What this topic covers",
    statsHeading: "## Distribution",
    statsScopeNote: (n) =>
      `These counts cover the **top ${n} most relevant** results of this search — not a full-library census of the topic.`,
    dimPlatform: "Platform",
    dimIngestSource: "Ingest source",
    dimProject: "Project",
    dimMonth: "Over time (by month)",
    tableValue: "Value",
    tableCount: "Count",
    unknownBucket: "Unlabeled",
    deepReadHeading: "## Close reading",
    sourcesHeading: "## Sources",
    truncated: (omittedMessages) => `\n\n… (${omittedMessages} message(s) omitted here) …\n\n`,
    conversationLabel: "conversation",
    documentLabel: "document",
  },
};

export function skillStrings(lang: SkillLang = "zh"): SkillStrings {
  return lang === "en" ? EN : ZH;
}
