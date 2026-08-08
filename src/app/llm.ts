import type { Conversation, Document, Annotation } from "./data";
import type { LLMConfig } from "./llm-settings";

export type { LLMConfig };

export const DEFAULT_PROMPT_CONVERT = `你是一个 Markdown 文档编辑助手。请把以下 AI 对话内容整理为结构化的 Markdown 文档。要求：
1. 提炼一个清晰的标题作为 H1
2. 把对话内容按主题归类为 H2 段落
3. 保留代码块、列表、表格等原始结构
4. 去掉寒暄、纠错等噪声轮次
5. 不要添加你自己的解释，直接输出 Markdown`.trim();

export const DEFAULT_PROMPT_REWRITE = `你是一个 Markdown 文档编辑助手。读者在阅读一份文档时给出了若干条批注，请你根据这些批注，输出修订后的完整 Markdown 文档。要求：
1. 保留原文档结构，仅按批注修改对应段落
2. 如果批注与原文矛盾，按批注优先
3. 不要附带解释，直接输出 Markdown 全文（不要只输出 diff）`.trim();

export const DEFAULT_PROMPT_AI_SIDEBAR = `你是嵌入文档阅读器的 AI 助手。请优先基于给定上下文回答，保持简洁、准确、可执行。若上下文不足，请明确说明，并可基于常识给出谨慎建议。回答使用 Markdown。`.trim();

/** Product default for new installs (DeepSeek). Prefer LLMSettings via llm-settings. */
export const DEFAULT_LLM_CONFIG: LLMConfig = {
  endpoint: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-v4-flash",
  systemPromptConvertConv: DEFAULT_PROMPT_CONVERT,
  systemPromptRewriteByAnnotations: DEFAULT_PROMPT_REWRITE,
};

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly context: { status: number; body: string; model?: string; endpoint?: string },
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** OpenAI 兼容的工具调用回执（把 assistant 的 tool_calls 原样带回下一轮）。 */
export interface ChatToolCallRef {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** role="tool" 时必填：对应的 tool call id。 */
  tool_call_id?: string;
  /** role="assistant" 且上一轮请求了工具时回带，供模型对齐自己的调用。 */
  tool_calls?: ChatToolCallRef[];
}

/** 向模型声明的工具（OpenAI 兼容形状）。目录本身由 `/api/tools` 手工维护。 */
export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type ToolChoice = "auto" | "none" | "required" | { type: "function"; function: { name: string } };

/** 模型请求的一次工具调用。`arguments` 保留模型原样输出的 JSON 字符串。 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** 对话请求的返回值：文本 + 模型请求的工具调用（无工具时 toolCalls 为空数组）。 */
export interface LLMResult {
  content: string;
  toolCalls: ToolCall[];
}

export interface ChatRequestOptions {
  onChunk?: (chunk: string) => void;
  signal?: AbortSignal;
  /** 非空时才会写进请求体 —— 不声明工具时请求与本次改动前逐字节一致。 */
  tools?: ToolDef[];
  toolChoice?: ToolChoice;
}

export function serializeConversation(conv: Conversation): string {
  if (!conv.messages.length) return "(empty conversation)";
  return conv.messages
    .map((m) => {
      const role = m.role === "user" ? "## User" : `## ${conv.platform}`;
      return `${role}\n\n${m.content}`;
    })
    .join("\n\n---\n\n");
}

export function buildRewritePrompt(doc: Document, annotations: Annotation[]): string {
  const annotationList = annotations
    .filter((a) => a.comment)
    .map((a, i) => {
      const ctxStart = Math.max(0, a.range.start - 20);
      const ctxEnd = Math.min(doc.body.length, a.range.end + 20);
      const context = doc.body.slice(ctxStart, ctxEnd);
      return `${i + 1}. 位置「${context}」: ${a.comment}`;
    })
    .join("\n");
  return `# 原文档\n\n${doc.body}\n\n# 读者批注（共 ${annotations.filter((a) => a.comment).length} 条）\n\n${annotationList}\n\n请输出修订后的完整 Markdown 文档。`;
}

export async function convertConversationToDocument(
  conv: Conversation,
  cfg: LLMConfig,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const userContent = serializeConversation(conv);
  return callLLM(cfg, cfg.systemPromptConvertConv, userContent, onChunk);
}

export async function rewriteByAnnotations(
  doc: Document,
  annotations: Annotation[],
  cfg: LLMConfig,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const userContent = buildRewritePrompt(doc, annotations);
  return callLLM(cfg, cfg.systemPromptRewriteByAnnotations, userContent, onChunk);
}

export async function testLLMConnection(cfg: LLMConfig): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(`${cfg.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function chatCompletion(
  cfg: LLMConfig,
  messages: ChatMessage[],
  opts: ChatRequestOptions = {},
): Promise<LLMResult> {
  return requestChatCompletions(cfg, messages, opts);
}

async function callLLM(
  cfg: LLMConfig,
  systemPrompt: string,
  userContent: string,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const { content } = await requestChatCompletions(cfg, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ], { onChunk });
  return content;
}

/**
 * 客户端对话请求（spec skill-runtime「客户端 LLM 通道支持工具调用」）。
 * 返回文本与模型请求的工具调用；`tools` 为空时请求体与返回行为与引入工具调用前一致。
 * 工具的**执行**由调用方在客户端完成，此处不引入任何服务端 LLM 通道。
 */
export async function requestChatCompletions(
  cfg: LLMConfig,
  messages: ChatMessage[],
  opts: ChatRequestOptions = {},
): Promise<LLMResult> {
  const { onChunk, signal, tools, toolChoice } = opts;
  let res: Response;
  try {
    res = await fetch(`${cfg.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      signal,
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: !!onChunk,
        ...(tools?.length ? { tools, ...(toolChoice ? { tool_choice: toolChoice } : {}) } : {}),
      }),
    });
  } catch (e: any) {
    if (e?.name === "AbortError") return { content: "", toolCalls: [] };
    throw e;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new LLMError(`HTTP ${res.status} ${res.statusText}`, {
      status: res.status,
      body: errText,
      model: cfg.model,
      endpoint: cfg.endpoint,
    });
  }

  if (!onChunk) {
    const json = await res.json();
    const message = json.choices[0].message;
    return {
      content: (message.content as string | null) ?? "",
      toolCalls: normalizeToolCalls(message.tool_calls),
    };
  }

  return parseSSE(res.body!, onChunk);
}

/** 把 OpenAI 形状的 `tool_calls` 收敛为 runner 消费的扁平结构；缺字段的条目丢弃。 */
function normalizeToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const item of raw) {
    const name = item?.function?.name;
    if (typeof name !== "string" || !name) continue;
    out.push({
      id: typeof item.id === "string" ? item.id : `call_${out.length}`,
      name,
      arguments: typeof item.function?.arguments === "string" ? item.function.arguments : "",
    });
  }
  return out;
}

/** 流式 tool_calls 按 `index` 分片下发，需按索引累加 name/arguments 后再收口。 */
interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

async function parseSSE(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: string) => void,
): Promise<LLMResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";
  const toolAcc: ToolCallAccumulator[] = [];

  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e: any) {
      if (e?.name === "AbortError") return { content: fullText, toolCalls: collectToolCalls(toolAcc) };
      throw e;
    }
    const { done, value } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) {
          fullText += delta.content;
          onChunk(delta.content);
        }
        if (Array.isArray(delta?.tool_calls)) accumulateToolCalls(toolAcc, delta.tool_calls);
      } catch {
        // ignore malformed chunks
      }
    }
  }
  return { content: fullText, toolCalls: collectToolCalls(toolAcc) };
}

function accumulateToolCalls(acc: ToolCallAccumulator[], deltas: any[]): void {
  for (const delta of deltas) {
    const index = typeof delta?.index === "number" ? delta.index : acc.length;
    const slot = (acc[index] ??= { id: "", name: "", arguments: "" });
    if (typeof delta?.id === "string" && delta.id) slot.id = delta.id;
    if (typeof delta?.function?.name === "string") slot.name += delta.function.name;
    if (typeof delta?.function?.arguments === "string") slot.arguments += delta.function.arguments;
  }
}

function collectToolCalls(acc: ToolCallAccumulator[]): ToolCall[] {
  return acc
    .filter((item): item is ToolCallAccumulator => !!item?.name)
    .map((item, i) => ({ id: item.id || `call_${i}`, name: item.name, arguments: item.arguments }));
}
