/**
 * build-run-summary.ts — 从技能结构化 output 渲染执行总结（spec agent-run-visibility D5）。
 * MUST NOT 发起任何 LLM 调用：全部由模板拼出。
 */
import type { CompactRunTrace } from "./run-trace";

export type RunSummaryStrings = {
  /** 主题汇总成功：{title} {folder} {sourceCount} {convCount} {docCount} */
  topicDigest: (p: {
    title: string;
    folder: string;
    sourceCount: number;
    convCount: number;
    docCount: number;
  }) => string;
  /** 目录整理成功：{itemCount} {candidateCount} {title} {folder} */
  docFolderOrganize: (p: {
    itemCount: number;
    candidateCount: number;
    title: string;
    folder: string;
    notes: string[];
  }) => string;
  /** 会话转文档：{title} {created} */
  conversationToDoc: (p: { title: string; created: boolean; docId: string }) => string;
  /** 批注重写提案：{annotationCount} */
  annotationRewrite: (p: { annotationCount: number; docId: string }) => string;
  /** 通用成功：{skillId} + 可选 doc 链接字段 */
  generic: (p: { skillId: string; facts: string[] }) => string;
  /** 失败：{error} {stepHint} */
  failure: (p: { error: string; stepHint: string }) => string;
  /** 已终止 */
  aborted: (p: { stepHint: string }) => string;
  /** 步骤提示：推进到了 {stepId} */
  stepHint: (stepId: string | null) => string;
  folderAiWorkspace: string;
  folderUserSpace: string;
};

const ZH_STRINGS: RunSummaryStrings = {
  topicDigest: ({ title, folder, sourceCount, convCount, docCount }) =>
    `已从 ${sourceCount} 条相关内容生成《${title}》，落在「${folder}」。\n来源：${convCount} 条会话、${docCount} 篇文档。`,
  docFolderOrganize: ({ itemCount, candidateCount, title, folder, notes }) => {
    const base = `已为 ${candidateCount} 篇候选文档起草归类计划（${itemCount} 条建议），落在「${folder}」：《${title}》。`;
    if (!notes.length) return base;
    return `${base}\n\n备注：\n${notes.map((n) => `- ${n}`).join("\n")}`;
  },
  conversationToDoc: ({ title, created, docId }) =>
    created
      ? `已将会话整理为文档《${title}》（\`${docId}\`）。`
      : `已更新既有文档《${title}》（\`${docId}\`），旧版可通过版本历史回滚。`,
  annotationRewrite: ({ annotationCount, docId }) =>
    `已根据 ${annotationCount} 条批注生成重写提案（文档 \`${docId}\`）。请在确认框中审阅后落盘。`,
  generic: ({ skillId, facts }) => {
    if (facts.length) return [`技能 \`${skillId}\` 执行完成。`, ...facts.map((f) => `- ${f}`)].join("\n");
    return `技能 \`${skillId}\` 执行完成。`;
  },
  failure: ({ error, stepHint }) => `执行失败${stepHint}：${error}`,
  aborted: ({ stepHint }) => `执行已终止${stepHint}。`,
  stepHint: (stepId) => (stepId ? `（推进到步骤 \`${stepId}\`）` : ""),
  folderAiWorkspace: "AI 空间",
  folderUserSpace: "用户目录",
};

const EN_STRINGS: RunSummaryStrings = {
  topicDigest: ({ title, folder, sourceCount, convCount, docCount }) =>
    `Generated “${title}” from ${sourceCount} related items, saved under “${folder}”.\nSources: ${convCount} conversation(s), ${docCount} document(s).`,
  docFolderOrganize: ({ itemCount, candidateCount, title, folder, notes }) => {
    const base = `Drafted a folder plan for ${candidateCount} candidate docs (${itemCount} suggestions), saved under “${folder}”: “${title}”.`;
    if (!notes.length) return base;
    return `${base}\n\nNotes:\n${notes.map((n) => `- ${n}`).join("\n")}`;
  },
  conversationToDoc: ({ title, created, docId }) =>
    created
      ? `Turned the conversation into document “${title}” (\`${docId}\`).`
      : `Updated existing document “${title}” (\`${docId}\`); previous body is in version history.`,
  annotationRewrite: ({ annotationCount, docId }) =>
    `Drafted a rewrite from ${annotationCount} annotation(s) for document \`${docId}\`. Review it in the confirm dialog before saving.`,
  generic: ({ skillId, facts }) => {
    if (facts.length) return [`Skill \`${skillId}\` finished.`, ...facts.map((f) => `- ${f}`)].join("\n");
    return `Skill \`${skillId}\` finished.`;
  },
  failure: ({ error, stepHint }) => `Run failed${stepHint}: ${error}`,
  aborted: ({ stepHint }) => `Run stopped${stepHint}.`,
  stepHint: (stepId) => (stepId ? ` (reached step \`${stepId}\`)` : ""),
  folderAiWorkspace: "AI workspace",
  folderUserSpace: "user folders",
};

export function summaryStringsFor(language: "en" | "zh" = "zh"): RunSummaryStrings {
  return language === "en" ? EN_STRINGS : ZH_STRINGS;
}

const DEFAULT_STRINGS = ZH_STRINGS;

function lastReachedStep(trace?: CompactRunTrace | null): string | null {
  if (!trace?.steps.length) return null;
  const failed = [...trace.steps].reverse().find((s) => s.status === "error" || s.status === "running");
  if (failed) return failed.id;
  const done = [...trace.steps].reverse().find((s) => s.status === "done");
  return done?.id ?? trace.steps[trace.steps.length - 1]?.id ?? null;
}

function asRecord(output: unknown): Record<string, unknown> {
  return output && typeof output === "object" && !Array.isArray(output)
    ? (output as Record<string, unknown>)
    : {};
}

/**
 * 渲染执行总结 Markdown（不含轨迹围栏块）。
 * `status` 为终态；失败/终止时用 error + trace 拼原因。
 */
export function buildRunSummary(params: {
  skillId: string;
  output?: unknown;
  trace?: CompactRunTrace | null;
  status: "done" | "error" | "aborted";
  error?: string;
  strings?: Partial<RunSummaryStrings>;
}): string {
  const s: RunSummaryStrings = { ...DEFAULT_STRINGS, ...params.strings };
  const stepHint = s.stepHint(lastReachedStep(params.trace));

  if (params.status === "aborted") {
    return s.aborted({ stepHint });
  }
  if (params.status === "error") {
    return s.failure({ error: params.error || "unknown error", stepHint });
  }

  const out = asRecord(params.output);
  const skillId = params.skillId;

  if (skillId === "topic-digest") {
    const topic = String(out.topic ?? "");
    const title = topic ? `主题汇总 · ${topic}` : "主题汇总";
    const citations = Array.isArray(out.citations) ? out.citations : [];
    const convCount = citations.filter((c: any) => c?.type === "conversation").length;
    const docCount = citations.filter((c: any) => c?.type === "document").length;
    const sourceCount = typeof out.sourceCount === "number" ? out.sourceCount : citations.length;
    return s.topicDigest({
      title,
      folder: s.folderAiWorkspace,
      sourceCount,
      convCount,
      docCount,
    });
  }

  if (skillId === "doc-folder-organize") {
    const itemCount = typeof out.itemCount === "number" ? out.itemCount : 0;
    const candidateCount = typeof out.candidateCount === "number" ? out.candidateCount : 0;
    const notes = Array.isArray(out.notes) ? out.notes.map(String) : [];
    const planDocId = String(out.planDocId ?? "");
    const title = planDocId ? `整理计划（${planDocId}）` : "整理计划";
    return s.docFolderOrganize({
      itemCount,
      candidateCount,
      title,
      folder: s.folderAiWorkspace,
      notes,
    });
  }

  if (skillId === "conversation-to-doc") {
    return s.conversationToDoc({
      title: String(out.title ?? "文档"),
      created: out.created !== false,
      docId: String(out.docId ?? ""),
    });
  }

  if (skillId === "annotation-driven-rewrite") {
    return s.annotationRewrite({
      annotationCount: typeof out.annotationCount === "number" ? out.annotationCount : 0,
      docId: String(out.docId ?? ""),
    });
  }

  // 未知 skillId：通用总结，不得留空
  const facts: string[] = [];
  if (out.docId) facts.push(`文档 id：\`${out.docId}\``);
  if (out.planDocId) facts.push(`计划文档 id：\`${out.planDocId}\``);
  if (out.title) facts.push(`标题：${out.title}`);
  if (out.folderId) facts.push(`文件夹：\`${out.folderId}\``);
  if (typeof out.sourceCount === "number") facts.push(`来源数：${out.sourceCount}`);
  if (typeof out.itemCount === "number") facts.push(`条目数：${out.itemCount}`);
  return s.generic({ skillId: skillId || "unknown", facts });
}
