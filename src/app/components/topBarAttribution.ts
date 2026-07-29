/**
 * 顶栏属性映射（spec content-topbar-attribution）。
 * 纯函数：采集方式 / 文档来源，与渲染组件分离便于单测。
 */

export type CaptureMethod = "web" | "terminal" | "manual";
export type DocumentOrigin = "conversation" | "terminal" | "import";

/** 对话采集方式：cli:<slug> → 终端；extension → 网页；其余（含缺省、旧值 "cli"）→ 手工。 */
export function resolveCaptureMethod(ingestSource?: string): CaptureMethod {
  if (typeof ingestSource === "string" && ingestSource.startsWith("cli:")) {
    const slug = ingestSource.slice(4);
    if (slug) return "terminal";
  }
  if (ingestSource === "extension") return "web";
  return "manual";
}

/** 文档来源三态（互斥）：sourceConversationId > cli:docs > 导入。 */
export function resolveDocumentOrigin(doc: {
  sourceConversationId?: string | null;
  ingestSource?: string | null;
}): DocumentOrigin {
  if (doc.sourceConversationId) return "conversation";
  if (doc.ingestSource === "cli:docs") return "terminal";
  return "import";
}
