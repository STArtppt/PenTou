/**
 * 元数据面板纯函数层（spec content-metadata-panel）。
 * 字段映射与 frontmatter 剥离与 UI 分离，便于单测。
 */

import type { CaptureMethod, DocumentOrigin } from "./components/topBarAttribution";
import { resolveCaptureMethod, resolveDocumentOrigin } from "./components/topBarAttribution";
import { topBarSourceLabel } from "./components/topBarSourceLabel";
import type { Conversation, Document, DocumentFolder, DocumentProject, Folder } from "./data";
import { DEFAULT_DOCUMENT_PROJECT_ID } from "./data";

export type MetaField = {
  /** 稳定键，供 i18n 标签与测试断言 */
  key: string;
  value: string;
};

export type FrontmatterSplit = {
  /** 认定成功时按原顺序的键值；否则 null（不剥离） */
  entries: Array<[string, string]> | null;
  body: string;
};

/** 键名允许字词、点、连字符（含 source_sha256 / converted-at） */
const FRONTMATTER_LINE = /^([\w.-]+):\s*(.*)$/;

/**
 * 展示层剥离正文开头的 YAML frontmatter。
 * 保守判定：开头 `---` 与闭合 `---` 之间每一非空行都必须是 `键: 值`。
 * 未闭合或含非键值行 → entries null，body 原样。
 */
export function splitLeadingFrontmatter(body: string): FrontmatterSplit {
  if (!body.startsWith("---\n") && body !== "---" && !body.startsWith("---\r\n")) {
    // 允许 "---\n..." 或 Windows 换行；纯 "---" 单独一行也不够（无闭合）
    if (!body.startsWith("---")) {
      return { entries: null, body };
    }
  }

  // 统一按 \n 扫描（保留 \r 剥掉）
  const normalized = body.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n") && normalized !== "---") {
    return { entries: null, body };
  }

  const afterOpen = normalized.startsWith("---\n") ? normalized.slice(4) : "";
  if (!afterOpen) {
    return { entries: null, body };
  }

  // 闭合：空块时 afterOpen 以 --- 开头；否则找独立行 \n---
  let block: string;
  let afterCloseMarker: string;
  if (afterOpen.startsWith("---")) {
    block = "";
    afterCloseMarker = afterOpen;
  } else {
    const closeIdx = afterOpen.indexOf("\n---");
    if (closeIdx < 0) {
      return { entries: null, body };
    }
    block = afterOpen.slice(0, closeIdx);
    afterCloseMarker = afterOpen.slice(closeIdx + 1); // starts with ---
  }

  if (!afterCloseMarker.startsWith("---")) {
    return { entries: null, body };
  }
  const restAfterClose = afterCloseMarker.slice(3);
  if (restAfterClose.length > 0 && !restAfterClose.startsWith("\n")) {
    // e.g. ---foo 不算闭合
    return { entries: null, body };
  }
  const lines = block.split("\n");
  const entries: Array<[string, string]> = [];

  for (const line of lines) {
    if (line.trim() === "") continue;
    const m = line.match(FRONTMATTER_LINE);
    if (!m) {
      return { entries: null, body };
    }
    let val = m[2].trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1).replace(/\\"/g, '"');
    }
    entries.push([m[1], val]);
  }

  // 闭合后 body：跳过可选的单个换行
  let remainder = restAfterClose.startsWith("\n") ? restAfterClose.slice(1) : restAfterClose;
  return { entries, body: remainder };
}

function resolveName(
  id: string | null | undefined,
  items: Array<{ id: string; name: string }>,
): string | null {
  if (id == null || id === "") return null;
  const hit = items.find((x) => x.id === id);
  return hit ? hit.name : id;
}

export type ConversationMetaInput = Pick<
  Conversation,
  | "platform"
  | "ingestSource"
  | "date"
  | "updatedAt"
  | "folderId"
  | "sourceProject"
  | "messageCount"
  | "messages"
>;

/**
 * 对话固定字段。空值整行省略。
 * captureMethod 的 value 为 web|terminal|manual，由 UI 做 i18n。
 */
export function conversationMetaFields(
  conv: ConversationMetaInput,
  folders: Array<Pick<Folder, "id" | "name">>,
  options: { formatDateTime: (iso: string) => string },
): MetaField[] {
  const rows: MetaField[] = [];
  const platform = topBarSourceLabel(conv.platform, conv.ingestSource);
  if (platform) rows.push({ key: "platform", value: platform });

  const method: CaptureMethod = resolveCaptureMethod(conv.ingestSource);
  rows.push({ key: "captureMethod", value: method });

  if (conv.date) {
    const formatted = options.formatDateTime(conv.date);
    if (formatted) rows.push({ key: "sessionTime", value: formatted });
  }
  if (conv.updatedAt) {
    const formatted = options.formatDateTime(conv.updatedAt);
    if (formatted) rows.push({ key: "updatedAt", value: formatted });
  }

  const folderName = resolveName(conv.folderId, folders);
  if (folderName) rows.push({ key: "folder", value: folderName });

  if (conv.sourceProject) {
    rows.push({ key: "sourceProject", value: conv.sourceProject });
  }

  const count =
    typeof conv.messageCount === "number"
      ? conv.messageCount
      : Array.isArray(conv.messages)
        ? conv.messages.length
        : undefined;
  if (typeof count === "number") {
    rows.push({ key: "messageCount", value: String(count) });
  }

  return rows;
}

export type DocumentMetaInput = Pick<
  Document,
  | "sourceConversationId"
  | "ingestSource"
  | "projectId"
  | "folderId"
  | "createdAt"
  | "updatedAt"
  | "sourcePlatform"
  | "generatedBy"
  | "generatedAt"
  | "importedFrom"
  | "importedAt"
  | "aiPlan"
>;

/**
 * 文档固定字段。空值省略。aiPlan 永不产出。
 * origin 的 value 为 conversation|terminal|import，由 UI 做 i18n。
 */
export function documentMetaFields(
  doc: DocumentMetaInput,
  projects: Array<Pick<DocumentProject, "id" | "name">>,
  folders: Array<Pick<DocumentFolder, "id" | "name">>,
  options: {
    formatDateTime: (iso: string) => string;
    /** 默认项目展示名（projectId 空时） */
    defaultProjectName: string;
  },
): MetaField[] {
  const rows: MetaField[] = [];

  const origin: DocumentOrigin = resolveDocumentOrigin(doc);
  rows.push({ key: "origin", value: origin });

  const projectId = doc.projectId;
  if (projectId == null || projectId === "" || projectId === DEFAULT_DOCUMENT_PROJECT_ID) {
    // 空或内置默认：显示默认项目名
    if (projectId === DEFAULT_DOCUMENT_PROJECT_ID) {
      const named = projects.find((p) => p.id === DEFAULT_DOCUMENT_PROJECT_ID)?.name;
      rows.push({ key: "project", value: named ?? options.defaultProjectName });
    } else {
      rows.push({ key: "project", value: options.defaultProjectName });
    }
  } else {
    const name = resolveName(projectId, projects);
    if (name) rows.push({ key: "project", value: name });
  }

  const folderName = resolveName(doc.folderId, folders);
  if (folderName) rows.push({ key: "folder", value: folderName });

  if (doc.createdAt) {
    const formatted = options.formatDateTime(doc.createdAt);
    if (formatted) rows.push({ key: "createdAt", value: formatted });
  }
  if (doc.updatedAt) {
    const formatted = options.formatDateTime(doc.updatedAt);
    if (formatted) rows.push({ key: "updatedAt", value: formatted });
  }

  if (doc.sourcePlatform) {
    rows.push({ key: "sourcePlatform", value: doc.sourcePlatform });
  }

  if (doc.generatedBy || doc.generatedAt) {
    const parts: string[] = [];
    if (doc.generatedBy) parts.push(doc.generatedBy);
    if (doc.generatedAt) {
      const t = options.formatDateTime(doc.generatedAt);
      if (t) parts.push(t);
    }
    if (parts.length) rows.push({ key: "generatedBy", value: parts.join(" · ") });
  }

  if (doc.importedFrom || doc.importedAt) {
    const parts: string[] = [];
    if (doc.importedFrom) parts.push(doc.importedFrom);
    if (doc.importedAt) {
      const t = options.formatDateTime(doc.importedAt);
      if (t) parts.push(t);
    }
    if (parts.length) rows.push({ key: "importedFrom", value: parts.join(" · ") });
  }

  // aiPlan intentionally omitted
  return rows;
}

/** 技术细节区：仅非空原值。 */
export function technicalDetailFields(entity: {
  id?: string;
  currentVersionId?: string;
  externalKey?: string;
  sourceConversationId?: string | null;
  sourceAiChatId?: string;
  ingestSource?: string;
}): MetaField[] {
  const keys = [
    "id",
    "currentVersionId",
    "externalKey",
    "sourceConversationId",
    "sourceAiChatId",
    "ingestSource",
  ] as const;
  const rows: MetaField[] = [];
  for (const key of keys) {
    const raw = entity[key];
    if (raw != null && String(raw) !== "") {
      rows.push({ key, value: String(raw) });
    }
  }
  return rows;
}
