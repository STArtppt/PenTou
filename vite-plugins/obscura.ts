import { execFile } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import * as cheerio from "cheerio";
import { parseDeepSeekExport, parseChatGPTExport } from "../src/app/parsers.js";

const BIN_DIR = path.resolve(process.cwd(), "bin");
const OBSCURA_PATH = path.join(BIN_DIR, process.platform === "win32" ? "obscura.exe" : "obscura");

export async function fetchHtmlWithObscura(url: string): Promise<string> {
  // ── Native API Interception for specific platforms ──
  // DeepSeek
  if (url.includes("chat.deepseek.com/share/") || url.includes("chat.deepseek.com/a/chat/s/")) {
    const match = url.match(/\/s(hare|\/chat\/s)\/([a-zA-Z0-9_-]+)/);
    const shareId = match ? match[2] : url.split('/').pop();
    if (shareId) {
      try {
        const apiUrl = `https://chat.deepseek.com/api/v0/share/content?share_id=${shareId}`;
        const res = await fetch(apiUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        const data = await res.json();
        // Return a special JSON string that we can identify in parseSharedLinkData
        return JSON.stringify({ __DEEPSEEK_API_PAYLOAD__: data });
      } catch (e) {
        console.warn("Native DeepSeek API fetch failed", e);
      }
    }
  }

  if (!fs.existsSync(OBSCURA_PATH)) {
    throw new Error(`Obscura binary not found at ${OBSCURA_PATH}. Please run 'npm run postinstall' to download it.`);
  }

  return new Promise((resolve, reject) => {
    // We use execFile instead of exec to avoid shell injection vulnerabilities with the URL
    execFile(
      OBSCURA_PATH,
      ["fetch", url, "--stealth", "--wait-until", "networkidle0", "--dump", "html"],
      { maxBuffer: 1024 * 1024 * 50 }, // 50MB buffer for large HTML pages
      (error, stdout, stderr) => {
        if (error) {
          console.error("Obscura error stderr:", stderr);
          return reject(error);
        }
        resolve(stdout);
      }
    );
  });
}

function makeId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeMsg(role: "user" | "ai", content: string, timestamp: string) {
  return { id: `msg_${Math.random().toString(36).slice(2, 9)}`, role, content, timestamp };
}

function extractEnqueuedPayloads($: cheerio.CheerioAPI): string[] {
  const payloads: string[] = [];

  $("script").each((_, script) => {
    const content = $(script).html();
    if (!content || !content.includes("streamController.enqueue")) return;

    let idx = 0;
    while ((idx = content.indexOf('enqueue("', idx)) !== -1) {
      const startIdx = idx + 9;
      let endIdx = startIdx;
      let isEscaped = false;

      while (endIdx < content.length) {
        if (content[endIdx] === "\\" && !isEscaped) {
          isEscaped = true;
        } else if (content[endIdx] === '"' && !isEscaped) {
          break;
        } else {
          isEscaped = false;
        }
        endIdx++;
      }

      try {
        payloads.push(JSON.parse(content.substring(startIdx - 1, endIdx + 1)));
      } catch {}

      idx = endIdx + 1;
    }
  });

  return payloads;
}

function decodeReactRouterPayload(table: any[]): any {
  const memo = new Map<number, any>();

  const resolveRef = (ref: any): any => {
    if (typeof ref !== "number") return resolveValue(ref);
    if (ref < 0) return undefined;
    if (memo.has(ref)) return memo.get(ref);
    return resolveValue(table[ref], ref);
  };

  const resolveValue = (value: any, index?: number): any => {
    if (Array.isArray(value)) {
      const resolved: any[] = [];
      if (index !== undefined) memo.set(index, resolved);
      for (const item of value) resolved.push(resolveRef(item));
      return resolved;
    }

    if (value && typeof value === "object") {
      const resolved: Record<string, any> = {};
      if (index !== undefined) memo.set(index, resolved);
      for (const [keyRef, valueRef] of Object.entries(value)) {
        const key = keyRef.startsWith("_") ? resolveRef(Number(keyRef.slice(1))) : keyRef;
        if (typeof key === "string") resolved[key] = resolveRef(valueRef);
      }
      return resolved;
    }

    if (index !== undefined) memo.set(index, value);
    return value;
  };

  return resolveRef(0);
}

function extractChatGPTServerResponseData($: cheerio.CheerioAPI): any | null {
  for (const payload of extractEnqueuedPayloads($)) {
    for (const line of payload.split("\n")) {
      const jsonText = line.replace(/^P?\d+:/, "").trim();
      if (!jsonText.startsWith("[")) continue;

      try {
        const decoded = decodeReactRouterPayload(JSON.parse(jsonText));
        const routeData = decoded?.loaderData?.["routes/share.$shareId.($action)"];
        const data = routeData?.serverResponse?.data;
        if (data?.mapping || data?.linear_conversation) return data;
      } catch {}
    }
  }

  return null;
}

export async function parseSharedLinkData(url: string, html: string): Promise<any[]> {
  // Check if we intercepted an API payload directly (e.g. DeepSeek)
  if (html.startsWith('{"__DEEPSEEK_API_PAYLOAD__"')) {
    try {
      const payload = JSON.parse(html);
      const data = payload.__DEEPSEEK_API_PAYLOAD__.data;
      if (data && data.biz_data && data.biz_data.messages) {
        const messages = data.biz_data.messages.map((m: any) => {
          const content = m.fragments ? m.fragments.map((f: any) => f.content).join("\n") : m.content || m.text || "";
          return {
            id: makeId(),
            role: m.role.toLowerCase() === "user" ? "user" : "ai",
            content,
            timestamp: new Date().toISOString()
          };
        });
        
        let finalTitle = data.biz_data.title;
        // DeepSeek often returns generic "Shared Conversation" for share links
        if (!finalTitle || finalTitle === "Shared Conversation") {
          const firstUserMsg = messages.find((m: any) => m.role === "user");
          if (firstUserMsg && firstUserMsg.content) {
            finalTitle = firstUserMsg.content.slice(0, 80).split("\n")[0].trim();
          } else {
            finalTitle = "DeepSeek Shared Conversation";
          }
        }
        
        return [{
          id: makeId(),
          title: finalTitle,
          platform: "DeepSeek",
          date: new Date().toISOString(),
          folderId: null,
          messages
        }];
      }
    } catch (e) {
      console.warn("Failed to parse intercepted DeepSeek payload", e);
    }
  }

  const $ = cheerio.load(html);

  // 1. ChatGPT or DeepSeek (__NEXT_DATA__)
  const nextDataScript = $("#__NEXT_DATA__").html();
  if (nextDataScript) {
    try {
      const json = JSON.parse(nextDataScript);
      
      // Check if it's DeepSeek
      if (url.includes("chat.deepseek.com")) {
        // DeepSeek share payload shape might differ slightly from export, 
        // but typically the `props.pageProps` contains the data
        const pageProps = json.props?.pageProps;
        if (pageProps) {
           // We might need to map it if it's different from the export json
           // Let's try passing the whole props or just let parseDeepSeekExport try its best
           // Actually, sharing payload often has `props.pageProps.chat` or something.
           // Since we reuse `parseDeepSeekExport`, we need to simulate the export format `{mapping: ...}`
           // For DeepSeek share, the chat data is usually inside `props.pageProps.chatSession` 
           // Let's do a basic fallback parsing for DeepSeek HTML just in case
           
           // I'll try to find any conversation structure.
           const chatSession = pageProps.chatSession || pageProps.data;
           if (chatSession && chatSession.mapping) {
              return parseDeepSeekExport([chatSession]);
           }
        }
      } 
      else if (url.includes("chatgpt.com")) {
        // ChatGPT share
        // Usually inside props.pageProps.serverResponse.data
        const serverResponse = json.props?.pageProps?.serverResponse?.data;
        if (serverResponse && serverResponse.mapping) {
           return parseChatGPTExport([serverResponse]);
        }
      }
    } catch (e) {
      console.warn("Failed to parse __NEXT_DATA__", e);
    }
  }

  // Fallback to DOM parsing if __NEXT_DATA__ fails or isn't present
  
  const messages: any[] = [];
  const date = new Date().toISOString();
  let title = "Shared Conversation";
  let platform = "Unknown";

  if (url.includes("claude.ai")) {
    platform = "Claude";
    // Basic Claude DOM extraction
    // Claude typically has `.font-claude-message` for AI messages, and `.font-user-message` for user messages
    // Or we can just iterate over common message containers.
    // For Claude share pages, the layout contains items that can be distinguished by standard text or icons
    
    // A more generic approach for modern Claude share DOM:
    // User messages often have text inside specific rounded blocks, AI messages have the Claude avatar.
    // We can extract all elements that look like message blocks.
    
    // Let's find all `div` elements that contain message text.
    // In Claude's DOM, `.font-user-message` and `.font-claude-message` are frequently used classes.
    const messageNodes = $(".font-user-message, .font-claude-message");
    
    if (messageNodes.length > 0) {
      messageNodes.each((_, el) => {
        const classList = $(el).attr("class") || "";
        const role = classList.includes("font-user-message") ? "user" : "ai";
        // Claude text content is usually in <p> tags or just plain text
        // Let's extract text, preserving basic newlines if possible
        const content = $(el).text().trim();
        if (content) {
          messages.push(makeMsg(role, content, date));
        }
      });
    } else {
      // Very generic fallback for Claude if classes changed
      // Sometimes it's grid items, we can just grab all text
      // This is less accurate but better than nothing
      // We will refine this later if needed
    }
  } 
  else if (url.includes("gemini.google.com")) {
    platform = "Gemini";
    // Gemini has <message-content> elements or similar
    // Often user queries are in user-query elements
    const queryNodes = $("user-query, .user-query, message-content, .message-content");
    // Actually, a simpler way is to look for role indicators if we can't find specific tags.
    // We will do a generic DOM scrape if specific tags aren't found.
  }
  else if (url.includes("chatgpt.com")) {
    platform = "ChatGPT";

    const serverResponse = extractChatGPTServerResponseData($);
    if (serverResponse) {
      const parsed = parseChatGPTExport([serverResponse]);
      if (parsed.length > 0) return parsed;
    }
    
    // ChatGPT RSC extraction (fallback for Remix hydration data)
    try {
      const rscStrings: string[] = [];
      for (const payload of extractEnqueuedPayloads($)) {
        const innerMatches = [...payload.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
        for (const m of innerMatches) {
          try { rscStrings.push(JSON.parse(`"${m[1]}"`)); } catch {}
        }
      }

      const seenIds = new Set<string>();
      for (let i = 0; i < rscStrings.length; i++) {
        if (rscStrings[i] === "user" && i > 0) {
            let content = rscStrings[i-1];
            if (content === "role" && i > 1) content = rscStrings[i-2];
            
            if (content && typeof content === 'string' && content.length > 0 && !['text', 'parts', 'author', 'message'].includes(content) && !content.startsWith('turn')) {
              if (!seenIds.has(content)) {
                  messages.push(makeMsg("user", content, date));
                  seenIds.add(content);
              }
            }
        }
        
        if (rscStrings[i] === "assistant" && rscStrings[i-1] === "role" && i > 1) {
            let content = rscStrings[i-2];
            if (content === "text" || content === "parts" || content === "content_type") {
                content = rscStrings[i-3];
            }
            if (content && typeof content === 'string' && content.length > 0 && !['text', 'parts', 'author', 'message'].includes(content) && !content.startsWith('turn')) {
              if (!seenIds.has(content)) {
                  messages.push(makeMsg("ai", content, date));
                  seenIds.add(content);
              }
            }
        }
      }
      
      // RSC post-order serialization typically yields newest messages first, so we reverse it
      // to restore chronological order.
      messages.reverse();
      
    } catch (e) {
      console.warn("ChatGPT RSC extraction failed", e);
    }
  }

  // Generic fallback if we still have no messages
  if (messages.length === 0) {
    // Just dump all text as a single AI message if all else fails
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    if (bodyText) {
      messages.push(makeMsg("ai", bodyText.slice(0, 10000) + (bodyText.length > 10000 ? "..." : ""), date));
      title = "Generic Imported Link";
    } else {
       throw new Error("Could not extract any content from the provided URL.");
    }
  }

  // Use the page title for the conversation title
  const pageTitle = $("title").text().trim();
  if (pageTitle && pageTitle !== "Shared Conversation") {
    title = pageTitle;
  } else if (messages[0] && messages[0].role === "user") {
    title = messages[0].content.slice(0, 80).split("\n")[0];
  }

  return [{
    id: makeId(),
    title,
    platform,
    date,
    folderId: null,
    messages
  }];
}
