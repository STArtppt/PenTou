export interface Heading {
  level: number;
  text: string;
  slug: string;
}

export interface ExcerptMessage {
  id?: string;
  role: string;
  content: string;
}

export interface ExcerptConversation {
  title?: string;
  date?: string;
  messages: ExcerptMessage[];
}

export interface ExcerptDocument {
  id?: string;
  body: string;
}

export type ExcerptStatus = "created" | "appended" | "already-excerpted";

export interface ExcerptResult {
  docId: string;
  status: ExcerptStatus;
}

export const EXCERPT_HEADING_RE = /^##\s+原文摘录\s+#\d+\s+\S+/m;
const EXCERPT_HEADING_GLOBAL_RE = /^##\s+原文摘录\s+#(\d+)\s+\S+/gm;

export function extractHeadings(body: string): Heading[] {
  const lines = body.split("\n");
  const headings: Heading[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith("```")) inCodeBlock = !inCodeBlock;
    if (inCodeBlock) continue;
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) {
      headings.push({
        level: m[1].length,
        text: m[2].trim(),
        slug: slugify(m[2].trim()),
      });
    }
  }
  return headings;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s]+/g, "-")
    .replace(/[^\w一-龥-]/g, "")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "");
}

const DOC_ID_RE = /^doc_[a-zA-Z0-9_]+$/;
const VER_ID_RE = /^ver_[a-zA-Z0-9_]+$/;

export function assertValidDocId(id: string): void {
  if (!id || !DOC_ID_RE.test(id)) {
    throw new Error(`Invalid document id: "${id}"`);
  }
}

export function assertValidVersionId(id: string): void {
  if (!id || !VER_ID_RE.test(id)) {
    throw new Error(`Invalid version id: "${id}"`);
  }
}

export function isValidDocId(id: string): boolean {
  return DOC_ID_RE.test(id);
}

export function generateDocId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function generateVersionId(): string {
  return `ver_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function generateAnnotationId(): string {
  return `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function hasExcerptSection(docBody: string): boolean {
  return EXCERPT_HEADING_RE.test(docBody);
}

export function hasExcerptedMessage(docBody: string, messageId: string): boolean {
  return docBody.includes(excerptMessageMarker(messageId));
}

export function normalizeHeadings(body: string): string {
  const lines = body.split("\n");
  const headingLevels: number[] = [];

  walkMarkdownLines(lines, (line) => {
    const heading = matchAtxHeading(line);
    if (heading) headingLevels.push(heading.level);
  });

  const minLevel = headingLevels.length ? Math.min(...headingLevels) : Infinity;
  const delta = minLevel === 1 ? 2 : minLevel === 2 ? 1 : 0;
  if (!delta) return body;

  return mapMarkdownLines(lines, (line) => {
    const heading = matchAtxHeading(line);
    if (!heading) return line;
    const nextLevel = Math.min(6, heading.level + delta);
    return `${heading.indent}${"#".repeat(nextLevel)}${heading.rest}`;
  }).join("\n");
}

export function buildExcerptSections(
  messages: ExcerptMessage[],
  options: { startIndex?: number; includeMessageMarkers?: boolean } = {},
): string {
  const excerptable = messages.filter((msg) => isExcerptableRole(msg.role));
  const startIndex = options.startIndex ?? 1;
  return excerptable
    .map((msg, index) => {
      const role = excerptRoleLabel(msg.role);
      const content = normalizeHeadings(msg.content ?? "").trim();
      const marker = options.includeMessageMarkers && msg.id ? excerptMessageMarker(msg.id) : "";
      return [`## 原文摘录 #${startIndex + index} ${role}`, marker, content].filter(Boolean).join("\n\n");
    })
    .join("\n\n");
}

export function getNextExcerptNumber(docBody: string): number {
  let max = 0;
  for (const match of docBody.matchAll(EXCERPT_HEADING_GLOBAL_RE)) {
    max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

export function appendExcerptToBody(body: string, excerpt: string): string {
  const existing = body.trimEnd();
  return existing ? `${existing}\n\n${excerpt}` : excerpt;
}

export function mergeRewriteWithExistingBody(existingBody: string, rewriteBody: string): string {
  const excerptStart = existingBody.search(EXCERPT_HEADING_RE);
  const rewrite = rewriteBody.trim();
  if (excerptStart === -1) return rewrite;

  const excerptTail = existingBody.slice(excerptStart).trimStart();
  return rewrite ? `${rewrite}\n\n${excerptTail}` : excerptTail;
}

export function fallbackConversationTitle(conversation: Pick<ExcerptConversation, "title" | "date">): string {
  const title = conversation.title?.trim();
  if (title) return title;

  const date = conversation.date ? new Date(conversation.date) : new Date();
  const stamp = Number.isNaN(date.getTime()) ? new Date() : date;
  return `未命名对话 · ${stamp.toISOString().slice(0, 10)}`;
}

export async function excerptConversationToDoc<TDoc extends ExcerptDocument>(params: {
  conversation: ExcerptConversation;
  message?: ExcerptMessage;
  existingDoc?: TDoc;
  createDoc: (body: string, title: string) => Promise<{ id: string }>;
  appendToDoc: (body: string) => Promise<void>;
}): Promise<ExcerptResult> {
  if (params.existingDoc && params.message?.id && hasExcerptedMessage(params.existingDoc.body, params.message.id)) {
    return { docId: getDocId(params.existingDoc), status: "already-excerpted" };
  }

  const messages = params.message ? [params.message] : params.conversation.messages;
  const excerpt = buildExcerptSections(messages, {
    startIndex: getNextExcerptNumber(params.existingDoc?.body ?? ""),
    includeMessageMarkers: !!params.message,
  });
  if (!excerpt) throw new Error("对话无内容可摘录");

  if (!params.existingDoc) {
    const doc = await params.createDoc(excerpt, fallbackConversationTitle(params.conversation));
    return { docId: doc.id, status: "created" };
  }

  await params.appendToDoc(appendExcerptToBody(params.existingDoc.body, excerpt));
  return { docId: getDocId(params.existingDoc), status: "appended" };
}

function getDocId(doc: ExcerptDocument): string {
  return typeof doc.id === "string" ? doc.id : "";
}

function excerptMessageMarker(messageId: string): string {
  return `<!-- pentou:excerpt-message-id=${messageId} -->`;
}

function isExcerptableRole(role: string): boolean {
  return role === "user" || role === "assistant" || role === "ai";
}

function excerptRoleLabel(role: string): string {
  return role === "ai" ? "assistant" : role;
}

function matchAtxHeading(line: string): { indent: string; level: number; rest: string } | null {
  const m = line.match(/^( {0,3})(#{1,6})(?=\s|$)(.*)$/);
  if (!m) return null;
  return { indent: m[1], level: m[2].length, rest: m[3] };
}

function walkMarkdownLines(lines: string[], visit: (line: string) => void): void {
  let inFence = false;
  for (const line of lines) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) visit(line);
  }
}

function mapMarkdownLines(lines: string[], mapLine: (line: string) => string): string[] {
  let inFence = false;
  return lines.map((line) => {
    if (isFenceLine(line)) {
      inFence = !inFence;
      return line;
    }
    return inFence ? line : mapLine(line);
  });
}

function isFenceLine(line: string): boolean {
  return /^ {0,3}(```+|~~~+)/.test(line);
}
