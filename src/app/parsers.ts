/**
 * parsers.ts
 * Converts various AI platform export formats into the internal Conversation type.
 * All parsers are pure functions — no side effects.
 */
import type { Conversation, Message, Platform } from "./data.js";

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

export function parseChatGPTExport(json: any): Conversation[] {
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
        const content = cleanChatGPTContent(
          parts
            .filter((p: any) => typeof p === "string")
            .join("\n")
            .trim()
        );

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

// ── 3. CLI JSONL ──────────────────────────────────────────────────────────────

export function parseJsonl(jsonlText: string): Conversation | null {
  const lines = jsonlText.split("\n").filter((l) => l.trim());
  const messages: Message[] = [];
  let title = "";
  let date = new Date().toISOString();
  let platform: Platform = "CLI";

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);

      // Claude Code format
      if (obj.type === "human" || obj.type === "assistant") {
        platform = "Claude";
        const role = obj.type === "human" ? "user" : "ai";
        const content =
          typeof obj.message?.content === "string"
            ? obj.message.content
            : Array.isArray(obj.message?.content)
            ? obj.message.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n")
            : "";
        if (content.trim()) {
          const ts = obj.timestamp ?? date;
          if (!title && role === "user") title = content.slice(0, 80).split("\n")[0];
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

// ── 4. Markdown Transcript (ai-chat-md-export, WayLog, waylog-cli) ────────────

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
  else if (providerStr.includes("codex")) platform = "Codex";

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

// ── 5. Main Dispatcher ────────────────────────────────────────────────────────

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
      
      // Determine if it is DeepSeek or ChatGPT by checking mapping structure
      // DeepSeek has fragments array, ChatGPT has parts array
      let isDeepSeek = false;
      const firstItem = Array.isArray(json) ? json[0] : json;
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
