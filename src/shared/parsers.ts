/**
 * parsers.ts
 * Converts various AI platform export formats into the internal Conversation type.
 * All parsers are pure functions — no side effects.
 *
 * 自 src/app/parsers.ts 抽出为前端与服务端共享模块（spec ingest-gateway §4.2 决策 5）；
 * 前端入口 src/app/parsers.ts 改为 re-export，import 图不变。
 */
import type { Conversation, Message, Platform } from "../app/data.js";

// ── Shared helper ─────────────────────────────────────────────────────────────

function makeId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeMsg(role: "user" | "ai", content: string, timestamp: string): Message {
  return { id: `msg_${Math.random().toString(36).slice(2, 9)}`, role, content, timestamp };
}

function cleanChatGPTContent(content: string): string {
  return content
    .replace(/\uE200entity\uE202([^\uE201]+)\uE201/g, (_match, rawJson) => {
      try {
        const entity = JSON.parse(rawJson);
        return typeof entity?.[1] === "string" ? entity[1] : "";
      } catch {
        return "";
      }
    })
    .replace(/\uE200[a-z_]+\uE202[^\uE201]*\uE201/g, "");
}

const ROLE_HEADER_NAMES = [
  "User",
  "Human",
  "You",
  "Assistant",
  "AI",
  "Claude",
  "ChatGPT",
  "DeepSeek",
  "Gemini",
  "Codex",
  "Cursor",
  "Copilot",
];

// ── 1. DeepSeek conversations.json ────────────────────────────────────────────

export function parseDeepSeekExport(json: any): Conversation[] {
  const items: any[] = Array.isArray(json) ? json : [json];
  const results: Conversation[] = [];

  for (const item of items) {
    try {
      if (!item.mapping || !item.id) continue;
      const mapping = item.mapping;
      const messages: Message[] = [];
      const title = item.title || "DeepSeek Conversation";
      
      // Find root node (parent === null)
      let currentNodeId = Object.keys(mapping).find(id => !mapping[id].parent) || "root";
      
      const visited = new Set<string>();
      while (currentNodeId && mapping[currentNodeId] && !visited.has(currentNodeId)) {
        visited.add(currentNodeId);
        const node = mapping[currentNodeId];
        
        if (node.message && Array.isArray(node.message.fragments)) {
          let role: "user" | "ai" = "ai";
          let content = "";
          let thinkContent = "";
          
          for (const frag of node.message.fragments) {
            if (frag.type === "REQUEST") {
              role = "user";
              content += frag.content;
            } else if (frag.type === "RESPONSE") {
              role = "ai";
              content += frag.content;
            } else if (frag.type === "THINK") {
              role = "ai";
              thinkContent += frag.content;
            }
          }
          
          let finalContent = "";
          if (thinkContent) {
            finalContent += `> [!NOTE]\n> **Thinking Process**\n${thinkContent.split('\n').map(l => '> ' + l).join('\n')}\n\n`;
          }
          finalContent += content;
          
          if (finalContent.trim()) {
            messages.push(makeMsg(
              role, 
              finalContent.trim(), 
              node.message.inserted_at || item.inserted_at || new Date().toISOString()
            ));
          }
        }
        
        // Traverse only the last child to take the active branch
        if (node.children && node.children.length > 0) {
          currentNodeId = node.children[node.children.length - 1];
        } else {
          break;
        }
      }
      
      if (messages.length > 0) {
        results.push({
          id: makeId(),
          title,
          platform: "DeepSeek",
          date: item.inserted_at || new Date().toISOString(),
          folderId: null,
          messages
        });
      }
    } catch {
      continue;
    }
  }
  return results;
}

// ── 2. ChatGPT conversations.json ─────────────────────────────────────────────

export interface ChatGPTParseOptions {
  /**
   * ZIP 导入时把消息中的图片指针（file-service:// / sediment:// 等 asset_pointer）
   * 解析为可嵌入的 URL；返回 null 表示找不到对应文件（插入占位，spec media-assets US-04 AC2）。
   * 未提供时图片 part 按原有行为忽略（纯 conversations.json 导入无图片文件可用）。
   */
  resolveAssetPointer?: (pointer: string) => string | null;
}

export function parseChatGPTExport(json: any, opts?: ChatGPTParseOptions): Conversation[] {
  const items: any[] = Array.isArray(json) ? json : [json];
  const results: Conversation[] = [];

  for (const item of items) {
    try {
      const mapping = item.mapping;
      const messages: Message[] = [];

      const addNodeMessage = (node: any) => {
        const msg = node?.message;
        if (!msg || !msg.content || msg.author?.role === "system") return;
        if (msg.metadata?.is_visually_hidden_from_conversation) return;

        const role = msg.author?.role === "user" ? "user" : "ai";
        const parts = msg.content?.parts ?? [];
        const segments: string[] = [];
        for (const p of parts) {
          if (typeof p === "string") {
            segments.push(p);
            continue;
          }
          // 图片指针 part（image_asset_pointer 等）：映射到文件 URL 或插入占位
          if (opts?.resolveAssetPointer && p && typeof p === "object" && typeof p.asset_pointer === "string") {
            const url = opts.resolveAssetPointer(p.asset_pointer);
            segments.push(url ? `![图片](${url})` : "[图片缺失]");
          }
        }
        const content = cleanChatGPTContent(segments.join("\n").trim());

        if (!content.trim()) return;

        const ts = msg.create_time
          ? new Date(msg.create_time * 1000).toISOString()
          : new Date().toISOString();
        messages.push(makeMsg(role, content.trim(), ts));
      };

      if (Array.isArray(item.linear_conversation)) {
        for (const node of item.linear_conversation) addNodeMessage(node);
      }

      function traverse(nodeId: string, visited = new Set<string>()) {
        if (!nodeId || visited.has(nodeId)) return;
        visited.add(nodeId);
        const node = mapping[nodeId];
        if (!node) return;
        addNodeMessage(node);
        // Traverse only the last child for the active branch
        const children = node.children ?? [];
        if (children.length > 0) {
          traverse(children[children.length - 1], visited);
        }
      }

      if (messages.length === 0 && mapping) {
        const rootNode = Object.values(mapping).find((n: any) => !n.parent);
        if (rootNode) traverse((rootNode as any).id);
      }

      if (messages.length === 0) continue;

      const date = item.create_time
        ? new Date(item.create_time * 1000).toISOString()
        : item.update_time 
          ? new Date(item.update_time * 1000).toISOString() 
          : new Date().toISOString();

      results.push({
        id: makeId(),
        title: item.title ?? "ChatGPT Conversation",
        platform: "ChatGPT",
        date,
        folderId: null,
        messages,
      });
    } catch {
      continue;
    }
  }

  return results;
}

// ── 3. Hermes session JSON ────────────────────────────────────────────────────

function normalizeTimestamp(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}

export function parseHermesExport(json: any): Conversation[] {
  const items: any[] = Array.isArray(json) ? json : [json];
  const results: Conversation[] = [];

  for (const item of items) {
    try {
      if (!Array.isArray(item?.messages)) continue;

      const defaultDate = normalizeTimestamp(item.exported_at ?? item.created_at ?? item.updated_at, new Date().toISOString());
      const messages: Message[] = [];

      for (const raw of item.messages) {
        const role: "user" | "ai" | null =
          raw?.role === "user" || raw?.role === "human"
            ? "user"
            : raw?.role === "assistant" || raw?.role === "ai"
            ? "ai"
            : null;
        if (!role) continue;

        const content = typeof raw.content === "string" ? raw.content.trim() : "";
        if (!content) continue;

        messages.push(makeMsg(role, content, normalizeTimestamp(raw.timestamp, defaultDate)));
      }

      if (messages.length === 0) continue;

      const firstUser = messages.find((m) => m.role === "user");
      results.push({
        id: makeId(),
        title: item.title || firstUser?.content.slice(0, 80).split("\n")[0] || "Hermes Conversation",
        platform: "Hermes",
        date: messages[0]?.timestamp || defaultDate,
        folderId: null,
        messages,
      });
    } catch {
      continue;
    }
  }

  return results;
}

// ── 4. CLI JSONL ──────────────────────────────────────────────────────────────

/**
 * Codex CLI / Desktop rollout-*.jsonl format.
 * Lines wrap everything under `payload`; the clean human↔AI dialogue lives in
 * `event_msg` entries (user_message / agent_message), free of system prompts and
 * tool-call noise. Falls back to `response_item` messages when no event_msg
 * dialogue is present.
 */
function parseCodexRollout(lines: string[]): Conversation | null {
  const messages: Message[] = [];
  const fallback: Message[] = [];
  let title = "";
  let date = "";

  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type === "session_meta" && obj.payload?.timestamp && !date) {
      date = obj.payload.timestamp;
    }

    const payload = obj.payload;
    if (!payload) continue;

    // Primary source: clean user/agent dialogue.
    if (obj.type === "event_msg" && (payload.type === "user_message" || payload.type === "agent_message")) {
      const role: "user" | "ai" = payload.type === "user_message" ? "user" : "ai";
      const content = typeof payload.message === "string" ? payload.message.trim() : "";
      if (!content) continue;
      const ts = obj.timestamp ?? date ?? new Date().toISOString();
      if (!date) date = ts;
      if (!title && role === "user") title = content.slice(0, 80).split("\n")[0];
      messages.push(makeMsg(role, content, ts));
    }

    // Fallback source: response_item messages (skip developer/system instructions).
    else if (obj.type === "response_item" && payload.type === "message" && (payload.role === "user" || payload.role === "assistant")) {
      const role: "user" | "ai" = payload.role === "user" ? "user" : "ai";
      const content = (Array.isArray(payload.content) ? payload.content : [])
        .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
        .join("\n")
        .trim();
      if (!content) continue;
      const ts = obj.timestamp ?? date ?? new Date().toISOString();
      fallback.push(makeMsg(role, content, ts));
    }
  }

  const finalMessages = messages.length > 0 ? messages : fallback;
  if (finalMessages.length === 0) return null;

  if (!title) {
    const firstUser = finalMessages.find((m) => m.role === "user");
    title = (firstUser?.content ?? finalMessages[0].content).slice(0, 80).split("\n")[0];
  }

  return {
    id: makeId(),
    title: title || "Codex Conversation",
    // Codex 归 ChatGPT 在解析层完成，手动导入与 ingest 两路一致
    // （spec collector-source-expansion §4.5 决策 2）
    platform: "ChatGPT",
    date: date || finalMessages[0].timestamp,
    folderId: null,
    messages: finalMessages,
  };
}

export function parseJsonl(jsonlText: string): Conversation | null {
  const lines = jsonlText.split("\n").filter((l) => l.trim());

  // Codex rollout files nest messages under `payload`; detect and route them.
  if (/"type"\s*:\s*"(?:session_meta|event_msg|response_item)"/.test(jsonlText)) {
    const conv = parseCodexRollout(lines);
    if (conv) return conv;
  }

  const messages: Message[] = [];
  let title = "";
  let date = new Date().toISOString();
  let platform: Platform = "CLI";

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);

      // Claude Code session format: { type: "user"|"assistant", message: { role, content } }
      // （旧导出格式用户侧为 type:"human"，保留兼容）
      if ((obj.type === "user" || obj.type === "human" || obj.type === "assistant") && obj.message) {
        // isMeta：本地命令 caveat 等元信息；isSidechain：子代理支线对话
        if (obj.isMeta || obj.isSidechain) continue;
        platform = "Claude";
        const role = obj.type === "assistant" ? "ai" : "user";
        const content =
          typeof obj.message?.content === "string"
            ? obj.message.content
            : Array.isArray(obj.message?.content)
            ? obj.message.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n")
            : "";
        const trimmed = content.trim();
        // 斜杠命令包裹与本地命令输出不是对话内容
        if (trimmed && !/^<(?:command-|local-command-)/.test(trimmed)) {
          const ts = obj.timestamp ?? date;
          // 标题取自 trim 后内容：首字符若是换行会让 split("\n")[0] 得到空串
          if (!title && role === "user") title = trimmed.slice(0, 80).split("\n")[0];
          if (messages.length === 0 && obj.timestamp) date = obj.timestamp;
          messages.push(makeMsg(role, content, ts));
        }
      }

      // Generic {role, content} format
      if ((obj.role === "user" || obj.role === "assistant") && obj.content) {
        const role = obj.role === "user" ? "user" : "ai";
        const content =
          typeof obj.content === "string"
            ? obj.content
            : Array.isArray(obj.content)
            ? obj.content.map((c: any) => c.text ?? c).join("\n")
            : "";
        if (content.trim()) {
          const ts = obj.timestamp ?? obj.created_at ?? date;
          if (!title && role === "user") title = content.slice(0, 80).split("\n")[0];
          messages.push(makeMsg(role, content, ts));
        }
      }
    } catch {
      continue;
    }
  }

  if (messages.length === 0) return null;

  return {
    id: makeId(),
    title: title || "CLI Conversation",
    platform,
    date,
    folderId: null,
    messages,
  };
}

// ── 5. Markdown Transcript (ai-chat-md-export, WayLog, waylog-cli) ────────────

export function parseMarkdown(mdText: string): Conversation | null {
  let providerStr = "";
  let frontmatterDate = "";
  let title = "";
  let platform: Platform = "CLI";
  
  // Extract frontmatter
  const frontmatterMatch = mdText.match(/^---\n([\s\S]*?)\n---/);
  let withoutFrontmatter = mdText;
  
  if (frontmatterMatch) {
    const fm = frontmatterMatch[1];
    withoutFrontmatter = mdText.slice(frontmatterMatch[0].length).trim();
    
    // Parse basic yaml
    const providerMatch = fm.match(/provider:\s*(.+)/i);
    if (providerMatch) providerStr = providerMatch[1].trim().toLowerCase();
    
    const dateMatch = fm.match(/started_at:\s*(.+)/i) || fm.match(/date:\s*(.+)/i);
    if (dateMatch) frontmatterDate = dateMatch[1].trim();
  }
  
  // Try to find the h1 Title
  const titleMatch = withoutFrontmatter.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    title = titleMatch[1].trim();
    withoutFrontmatter = withoutFrontmatter.replace(titleMatch[0], "").trim();
  }
  
  // Infer platform
  if (providerStr.includes("chatgpt") || providerStr.includes("openai")) platform = "ChatGPT";
  else if (providerStr.includes("claude") || providerStr.includes("anthropic")) platform = "Claude";
  else if (providerStr.includes("gemini")) platform = "Gemini";
  else if (providerStr.includes("deepseek")) platform = "DeepSeek";
  else if (providerStr.includes("cursor")) platform = "Cursor";
  else if (providerStr.includes("copilot")) platform = "Copilot";
  // Codex 归 ChatGPT（spec collector-source-expansion §4.5 决策 2）
  else if (providerStr.includes("codex")) platform = "ChatGPT";
  else if (providerStr.includes("grok")) platform = "Grok";
  else if (providerStr.includes("opencode")) platform = "OpenCode";
  else if (providerStr.includes("hermes")) platform = "Hermes";

  // Split only by recognized role headers. Normal Markdown headings inside
  // message bodies must not create new messages.
  const roleHeaderPattern = ROLE_HEADER_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const headerRegex = new RegExp(
    `^(?:##\\s+(?:👤|🤖)?\\s*(${roleHeaderPattern})(?:\\s*\\([^)]+\\))?\\s*$)|^(?:\\*\\*(${roleHeaderPattern}):\\*\\*)`,
    "gim"
  );
  const matches = [...withoutFrontmatter.matchAll(headerRegex)];

  const messages: Message[] = [];
  const defaultDate = frontmatterDate ? new Date(frontmatterDate).toISOString() : new Date().toISOString();

  if (matches.length === 0) {
    // If no strict pattern, fallback to treating entire body as a single AI message
    const trimmed = withoutFrontmatter.trim();
    if (!trimmed) return null;
    messages.push(makeMsg("ai", trimmed, defaultDate));
    if (!title) title = trimmed.slice(0, 60).split("\n")[0] || "Imported Note";
  } else {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const roleLabel = (match[1] || match[2] || "").trim().toLowerCase();
      const isUser = /user|human|you/i.test(roleLabel);
      const role = isUser ? "user" : "ai";

      // Try to extract timestamp like "(2026-04-03 01:34:15 UTC)"
      let msgDate = defaultDate;
      const headerLine = match[0];
      const timeMatch = headerLine.match(/\((.*?)\)/);
      if (timeMatch) {
         const parsed = new Date(timeMatch[1]);
         if (!isNaN(parsed.getTime())) {
            msgDate = parsed.toISOString();
         }
      }

      const startIdx = match.index! + match[0].length;
      const endIdx = i + 1 < matches.length ? matches[i + 1].index! : withoutFrontmatter.length;
      let content = withoutFrontmatter.slice(startIdx, endIdx).trim();
      
      content = content.replace(/\s*---$/, "").trim(); // strip arbitrary dividers

      if (!content) continue;

      if (!title && isUser) {
        title = content.slice(0, 80).split("\n")[0];
      }

      messages.push(makeMsg(role, content, msgDate));
    }
  }

  if (messages.length === 0) return null;

  return {
    id: makeId(),
    title: title || "Conversation",
    platform,
    date: messages[0]?.timestamp || defaultDate,
    folderId: null,
    messages,
  };
}

// ── 6. Main Dispatcher ────────────────────────────────────────────────────────

/**
 * Auto-detects the file format and returns parsed Conversations.
 */
export function parseFileContent(filename: string, text: string): Conversation[] {
  const results: Conversation[] = [];
  
  const lowerName = filename.toLowerCase();

  // 1. JSON Export (Platform bundles)
  if (lowerName.endsWith('.json')) {
    try {
      const json = JSON.parse(text);
      const firstItem = Array.isArray(json) ? json[0] : json;

      if (firstItem?.session_id && Array.isArray(firstItem?.messages)) {
        results.push(...parseHermesExport(json));
        return results;
      }
      
      // Determine if it is DeepSeek or ChatGPT by checking mapping structure
      // DeepSeek has fragments array, ChatGPT has parts array
      let isDeepSeek = false;
      if (firstItem?.mapping) {
        const firstNode: any = Object.values(firstItem.mapping)[0] || {};
        if (firstNode?.message?.fragments) {
          isDeepSeek = true;
        }
      }
      
      if (isDeepSeek) {
        results.push(...parseDeepSeekExport(json));
      } else {
        results.push(...parseChatGPTExport(json));
      }
    } catch (e) {
      console.warn("Failed to parse JSON file as export", e);
    }
  } 
  
  // 2. JSONL Logs (Claude Code, etc)
  else if (lowerName.endsWith('.jsonl')) {
     const conv = parseJsonl(text);
     if (conv) results.push(conv);
  } 
  
  // 3. Markdown Logs (ai-chat-md-export, WayLog, waylog-cli)
  else if (lowerName.endsWith('.md') || lowerName.endsWith('.txt')) {
     const conv = parseMarkdown(text);
     if (conv) results.push(conv);
  }
  
  return results;
}
