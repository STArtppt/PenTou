import type { Conversation, Document, Annotation, LLMConfig } from "./data";

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

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  endpoint: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
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

async function callLLM(
  cfg: LLMConfig,
  systemPrompt: string,
  userContent: string,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const res = await fetch(`${cfg.endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      stream: !!onChunk,
    }),
  });

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
    return json.choices[0].message.content as string;
  }

  return parseSSE(res.body!, onChunk);
}

async function parseSSE(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
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
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onChunk(delta);
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }
  return fullText;
}
