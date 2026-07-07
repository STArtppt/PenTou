import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Readable } from "node:stream";
import * as cheerio from "cheerio";
import { parseDeepSeekExport, parseChatGPTExport } from "../src/app/parsers.js";

const DEFAULT_BIN_DIR = path.resolve(process.cwd(), "bin");
const OBSCURA_FILE = process.platform === "win32" ? "obscura.exe" : "obscura";
const OBSCURA_STDOUT_MAX_BYTES = 1024 * 1024 * 50;
const OBSCURA_STDERR_TAIL_BYTES = 1024 * 64;
const OBSCURA_TIMEOUT_MS = 45_000;
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

function appendTail(current: string, chunk: Buffer, maxBytes: number): string {
  const next = current + chunk.toString("utf-8");
  if (Buffer.byteLength(next) <= maxBytes) return next;
  return next.slice(-maxBytes);
}

// ── obscura 二进制解析与惰性下载（npx-launcher spec §4.5 决策 5）─────────────────
// npx 包不含 postinstall，obscura 在首次用到分享链接导入时下载到 <data-dir>/bin/，
// 失败沿用"功能降级、应用可用"语义。同路径并发下载用 in-flight Promise 去重。

export interface ObscuraOptions {
  /** obscura 所在目录；省略时用 <cwd>/bin（Docker / dev）。 */
  binDir?: string;
  /** 缺失时是否惰性下载（仅 npx 本地模式）。 */
  allowDownload?: boolean;
}

const downloadInFlight = new Map<string, Promise<boolean>>();

/** 按宿主平台/架构返回 obscura release 资产名；不支持的组合返回 null。 */
function obscuraAssetName(): string | null {
  const platform = os.platform();
  let arch: string = os.arch();
  if (arch === "amd64") arch = "x64";
  if (arch === "aarch64") arch = "arm64";

  if (platform === "win32") return "obscura-x86_64-windows.zip";
  if (platform === "darwin") return arch === "arm64" ? "obscura-aarch64-macos.tar.gz" : "obscura-x86_64-macos.tar.gz";
  if (platform === "linux") {
    // 上游暂无 linux-aarch64 构建；该平台分享链接导入降级不可用。
    if (arch === "arm64") return null;
    return "obscura-x86_64-linux.tar.gz";
  }
  return null;
}

/** 下载并解压 obscura 到 binDir；成功返回 true。失败仅警告并返回 false（优雅降级）。 */
async function downloadObscura(binDir: string, binPath: string): Promise<boolean> {
  const assetName = obscuraAssetName();
  if (!assetName) {
    console.warn(`[obscura] no prebuilt binary for ${os.platform()}/${os.arch()}; share-link import disabled.`);
    return false;
  }

  const releaseUrl = `https://github.com/h4ckf0r0day/obscura/releases/latest/download/${assetName}`;
  const isZip = assetName.endsWith(".zip");
  const tempFile = path.join(binDir, isZip ? "obscura-download.zip" : "obscura-download.tar.gz");

  try {
    fs.mkdirSync(binDir, { recursive: true });
    console.warn(`[obscura] downloading from ${releaseUrl} ...`);
    const response = await fetch(releaseUrl);
    if (!response.ok || !response.body) {
      console.warn(`[obscura] download failed: HTTP ${response.status}. Share-link import disabled.`);
      return false;
    }

    const fileStream = fs.createWriteStream(tempFile);
    await new Promise<void>((resolve, reject) => {
      Readable.fromWeb(response.body as any)
        .pipe(fileStream)
        .on("finish", () => resolve())
        .on("error", reject);
    });

    execFileSync("tar", [isZip ? "-xf" : "-xzf", tempFile, "-C", binDir], { stdio: "ignore" });
    try { fs.unlinkSync(tempFile); } catch { /* ignore */ }

    if (os.platform() !== "win32" && fs.existsSync(binPath)) {
      fs.chmodSync(binPath, 0o755);
    }

    if (fs.existsSync(binPath)) {
      console.warn(`[obscura] ready at ${binPath}`);
      return true;
    }
    console.warn("[obscura] archive extracted but binary not found; share-link import disabled.");
    return false;
  } catch (error: any) {
    console.warn("[obscura] download error (non-fatal):", error?.message ?? error);
    try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
    return false;
  }
}

/**
 * 解析 obscura 二进制路径：已存在则直接用；缺失且 allowDownload 时惰性下载。
 * 返回可执行路径，或 null（降级，调用方应抛出友好错误）。
 */
async function resolveObscuraPath(options?: ObscuraOptions): Promise<string | null> {
  const binDir = options?.binDir ?? DEFAULT_BIN_DIR;
  const binPath = path.join(binDir, OBSCURA_FILE);
  if (fs.existsSync(binPath)) return binPath;
  if (!options?.allowDownload) return null;

  let pending = downloadInFlight.get(binPath);
  if (!pending) {
    pending = downloadObscura(binDir, binPath).finally(() => downloadInFlight.delete(binPath));
    downloadInFlight.set(binPath, pending);
  }
  const ok = await pending;
  return ok ? binPath : null;
}

export async function fetchHtmlWithObscura(url: string, options?: ObscuraOptions): Promise<string> {
  // ── Native API Interception for specific platforms ──
  // Doubao embeds the public share payload in streamed router script attrs. Obscura
  // currently fails to execute that script, so prefer the raw HTML response.
  if (url.includes("doubao.com/thread/")) {
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS });
      const html = await res.text();
      if (html.includes("data-fn-args") && html.includes("message_snapshot")) {
        return html;
      }
    } catch (e) {
      console.warn("Native Doubao HTML fetch failed", e);
    }
  }

  if (url.includes("qianwen.com/share/chat/")) {
    const shareId = url.match(/\/share\/chat\/([^/?#]+)/)?.[1];
    if (shareId) {
      try {
        const apiUrl = "https://chat2-api.qianwen.com/api/v1/share/info?pr=qwen&fr=mac";
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            ...BROWSER_HEADERS,
            "Content-Type": "application/json",
            "Origin": "https://www.qianwen.com",
            "Referer": url,
          },
          body: JSON.stringify({ share_id: shareId, biz_id: "ai_qwen" }),
        });
        const data = await res.json();
        if (res.ok && data?.data?.session?.record_list) {
          return JSON.stringify({ __QIANWEN_API_PAYLOAD__: data.data });
        }
      } catch (e) {
        console.warn("Native Qianwen API fetch failed", e);
      }
    }
  }

  if (url.includes("metaso.cn/")) {
    try {
      const resolved = new URL(url);
      if (!resolved.pathname.startsWith("/chat/")) {
        const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
        resolved.href = res.url;
      }

      const conversationId = resolved.pathname.match(/\/chat\/([^/?#]+)/)?.[1];
      const shareKey = resolved.searchParams.get("ssi") || resolved.searchParams.get("shareKey");
      const shareType = resolved.searchParams.get("shareType") || "15";

      if (conversationId && shareKey) {
        const apiUrl = new URL(`/api/conversation/${conversationId}/branched-messages`, "https://metaso.cn");
        apiUrl.searchParams.set("shareKey", shareKey);
        apiUrl.searchParams.set("shareType", shareType);
        const res = await fetch(apiUrl, {
          headers: {
            ...BROWSER_HEADERS,
            "Accept": "application/json,text/plain,*/*",
            "Referer": resolved.href,
          },
        });
        const data = await res.json();
        if (res.ok && data?.errCode === 0 && data?.data?.activePathMessages) {
          return JSON.stringify({ __METASO_API_PAYLOAD__: data.data });
        }
      }
    } catch (e) {
      console.warn("Native Metaso API fetch failed", e);
    }
  }

  if (url.includes("gemini.google.com/share/")) {
    const shareId = url.match(/\/share\/([^/?#]+)/)?.[1];
    if (shareId) {
      try {
        const rpcPayload = [[["ujx1Bf", JSON.stringify([null, shareId, [4]]), null, "generic"]]];
        const apiUrl = new URL("https://gemini.google.com/_/BardChatUi/data/batchexecute");
        apiUrl.searchParams.set("rpcids", "ujx1Bf");
        apiUrl.searchParams.set("source-path", `/share/${shareId}`);
        apiUrl.searchParams.set("hl", "zh-CN");
        apiUrl.searchParams.set("rt", "c");

        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            ...BROWSER_HEADERS,
            "Accept": "application/json,text/plain,*/*",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "Origin": "https://gemini.google.com",
            "Referer": url,
          },
          body: new URLSearchParams({ "f.req": JSON.stringify(rpcPayload), at: "" }),
        });
        const text = await res.text();
        const data = parseGeminiBatchExecuteResponse(text);
        if (res.ok && data?.[0]?.[1]) {
          return JSON.stringify({ __GEMINI_API_PAYLOAD__: data });
        }
      } catch (e) {
        console.warn("Native Gemini API fetch failed", e);
      }
    }
  }

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

  const obscuraPath = await resolveObscuraPath(options);
  if (!obscuraPath) {
    throw new Error("Obscura binary unavailable; share-link import is disabled on this platform/network.");
  }

  const waitUntil = url.includes("metaso.cn") ? "domcontentloaded" : "networkidle0";

  return new Promise((resolve, reject) => {
    const child = spawn(
      obscuraPath,
      ["fetch", url, "--stealth", "--wait-until", waitUntil, "--dump", "html"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrTail = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`Obscura timed out after ${OBSCURA_TIMEOUT_MS}ms${stderrTail ? `\n${stderrTail}` : ""}`)));
    }, OBSCURA_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > OBSCURA_STDOUT_MAX_BYTES) {
        child.kill("SIGTERM");
        finish(() => reject(new Error(`Obscura stdout exceeded ${OBSCURA_STDOUT_MAX_BYTES} bytes`)));
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = appendTail(stderrTail, chunk, OBSCURA_STDERR_TAIL_BYTES);
    });

    child.on("error", (error) => {
      finish(() => reject(error));
    });

    child.on("close", (code, signal) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(`Obscura exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}${stderrTail ? `\n${stderrTail}` : ""}`));
          return;
        }
        resolve(Buffer.concat(stdoutChunks, stdoutBytes).toString("utf-8"));
      });
    });
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

function getPageTitle($: cheerio.CheerioAPI): string {
  return $("title").text().trim() || $("meta[property='og:title']").attr("content")?.trim() || "";
}

function tryParseJson(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 从图片对象按优先级取 URL（spec media-assets §4.5：原图 → 预览图 → 缩略图）。 */
function pickImageUrl(image: any, keys: string[]): string {
  for (const key of keys) {
    const url = image?.[key]?.url;
    if (typeof url === "string" && url) return url;
  }
  return "";
}

/**
 * Doubao 结构化图片 → markdown 图片（spec media-assets §4.5 / 决策 11）。
 * attachment_block 上传图、creation_block 生成图与参考图；URL 缺失插入占位（解析期兜底）。
 */
function extractDoubaoBlockImages(parsed: any): string[] {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (url: string, alt: string, missingText: string) => {
    if (!url) { parts.push(missingText); return; }
    if (seen.has(url)) return; // 同一消息内按展示顺序去重
    seen.add(url);
    parts.push(`![${alt}](${url})`);
  };

  for (const att of parsed?.attachment_block?.attachments ?? []) {
    push(pickImageUrl(att?.image, ["image_ori", "image_preview", "image_thumb"]), "附件图片", "[图片缺失]");
  }

  let genIndex = 0;
  for (const creation of parsed?.creation_block?.creations ?? []) {
    genIndex++;
    push(
      pickImageUrl(creation?.image, ["image_raw_b", "image_ori", "image_preview", "image_thumb"]),
      `生成图片 ${genIndex}`,
      "[生成图片缺失]",
    );
    for (const ref of creation?.gen_detail?.ref_images ?? []) {
      const refUrl = pickImageUrl(ref, ["image_ori", "image_preview", "image_thumb"])
        || pickImageUrl(ref?.image, ["image_ori", "image_preview", "image_thumb"]);
      if (refUrl && !seen.has(refUrl)) {
        seen.add(refUrl);
        parts.push(`![参考图](${refUrl})`);
      }
    }
  }

  return parts;
}

function extractDoubaoBlockText(block: any): string {
  const candidates = [block?.content_v2, block?.content];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = typeof candidate === "string" ? tryParseJson(candidate) : candidate;
    if (!parsed) continue;

    const segments: string[] = [];
    const text = parsed?.text_block?.text || parsed?.text;
    if (typeof text === "string" && text.trim()) segments.push(text.trim());
    segments.push(...extractDoubaoBlockImages(parsed));
    if (segments.length > 0) return segments.join("\n\n");
  }

  return "";
}

function extractDoubaoMessageText(message: any): string {
  const texts: string[] = [];

  for (const block of message?.content_block || []) {
    const text = extractDoubaoBlockText(block);
    if (text) texts.push(text);
  }

  if (texts.length === 0 && typeof message?.content === "string") {
    const blocks = tryParseJson(message.content);
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        const text = extractDoubaoBlockText(block);
        if (text) texts.push(text);
      }
    }
  }

  return Array.from(new Set(texts)).join("\n\n").trim();
}

function parseDoubaoShare($: cheerio.CheerioAPI): any[] | null {
  let shareData: any | null = null;

  $("script[data-fn-args]").each((_, script) => {
    if (shareData) return;
    const fnName = $(script).attr("data-fn-name");
    const argsText = $(script).attr("data-fn-args") || "";
    if (fnName !== "r" || !argsText.includes("message_snapshot")) return;

    const args = tryParseJson(argsText);
    const data = Array.isArray(args) ? args[2]?.data : null;
    if (data?.message_snapshot?.message_list) shareData = data;
  });

  const messageList = shareData?.message_snapshot?.message_list;
  if (!Array.isArray(messageList) || messageList.length === 0) return null;

  const date = new Date().toISOString();
  const messages = messageList
    .slice()
    .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
    .map((message: any) => {
      const content = extractDoubaoMessageText(message);
      if (!content) return null;
      const timestamp = typeof message.create_time === "number"
        ? new Date(message.create_time * 1000).toISOString()
        : date;
      return makeMsg(message.user_type === 1 ? "user" : "ai", content, timestamp);
    })
    .filter(Boolean);

  if (messages.length === 0) return null;

  return [{
    id: makeId(),
    title: shareData.share_info?.share_name || "Doubao Shared Conversation",
    platform: "Doubao",
    date,
    folderId: null,
    messages,
  }];
}

/**
 * Qianwen 结构化图片 → markdown 图片（spec media-assets §4.5）。
 * 优先 result_images 原图；layout_list 经 refer_id 指向 resource_infos，避免重复抓 watermark 资源。
 */
function extractQianwenMessageImages(message: any): string[] {
  const images: string[] = [];
  const seen = new Set<string>();
  let genIndex = 0;
  const push = (url: string) => {
    genIndex++;
    if (!url) { images.push("[生成图片缺失]"); return; }
    if (seen.has(url)) return;
    seen.add(url);
    images.push(`![生成图片 ${genIndex}](${url})`);
  };
  const resourceUrl = (resource: any) =>
    resource?.download_url || resource?.cdn_url || resource?.url || resource?.preview_url || resource?.thumbnail_url || "";

  for (const load of message?.meta_data?.multi_load ?? []) {
    const resultImages = load?.extra_info?.content?.extra?.result_images;
    if (Array.isArray(resultImages) && resultImages.length > 0) {
      for (const img of resultImages) {
        push(img?.download_url || img?.cdn_url || img?.preview_url || img?.thumbnail_url || "");
      }
      continue;
    }

    const resources = load?.content?.resource_infos;
    const layouts = load?.content?.layout_list;
    if (Array.isArray(layouts) && layouts.length > 0 && Array.isArray(resources)) {
      for (const layout of layouts) {
        const image = layout?.image;
        if (!image) continue;
        const referId = image?.refer_id ?? image?.referId;
        const resource = resources.find(
          (r: any) => r?.refer_id === referId || r?.id === referId || r?.resource_id === referId,
        );
        push(resourceUrl(resource) || (typeof image?.url === "string" ? image.url : ""));
      }
      continue;
    }

    if (Array.isArray(resources)) {
      for (const resource of resources) push(resourceUrl(resource));
    }
  }

  return images;
}

function parseQianwenApiPayload(data: any): any[] {
  const date = new Date().toISOString();
  const records = data?.session?.record_list;
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Qianwen API payload did not contain any messages.");
  }

  const messages: any[] = [];
  for (const record of records) {
    const timestamp = typeof record.created_at === "number"
      ? new Date(record.created_at).toISOString()
      : date;

    for (const request of record.request_messages || []) {
      if (typeof request.content === "string" && request.content.trim()) {
        messages.push(makeMsg("user", request.content.trim(), timestamp));
      }
    }

    const responseText = (record.response_messages || [])
      .map((message: any) => {
        const text = typeof message.content === "string" ? message.content.trim() : "";
        // 生成图紧随对应说明文字之后（spec media-assets §4.5）
        return [text, ...extractQianwenMessageImages(message)].filter(Boolean).join("\n\n");
      })
      .filter(Boolean)
      .join("\n\n");
    if (responseText) messages.push(makeMsg("ai", responseText, timestamp));
  }

  if (messages.length === 0) {
    throw new Error("Qianwen API payload did not contain any message text.");
  }

  return [{
    id: makeId(),
    title: data.title || data.session?.title || "Qianwen Shared Conversation",
    platform: "Qianwen",
    date,
    folderId: null,
    messages,
  }];
}

function extractMetasoMessageText(message: any): string {
  if (typeof message?.content?.text === "string") return message.content.text.trim();

  const stages = message?.content?.stages;
  if (!Array.isArray(stages)) return "";

  const finalTexts: string[] = [];
  const fallbackTexts: string[] = [];
  for (const stage of stages) {
    for (const item of stage?.texts || []) {
      if (typeof item?.text !== "string" || !item.text.trim()) continue;
      if (item.type === "text") finalTexts.push(item.text.trim());
      else if (item.type !== "action") fallbackTexts.push(item.text.trim());
    }
  }

  return (finalTexts.length > 0 ? finalTexts : fallbackTexts).join("\n\n").trim();
}

function parseMetasoApiPayload(data: any): any[] {
  const date = new Date().toISOString();
  const sourceMessages = data?.activePathMessages;
  if (!Array.isArray(sourceMessages) || sourceMessages.length === 0) {
    throw new Error("Metaso API payload did not contain any messages.");
  }

  const messages = sourceMessages
    .slice()
    .sort((a: any, b: any) => (a.depth ?? 0) - (b.depth ?? 0))
    .map((message: any) => {
      const content = extractMetasoMessageText(message);
      if (!content) return null;
      const role = message.role === "USER" ? "user" : "ai";
      const timestamp = typeof message.createTime === "string"
        ? new Date(message.createTime).toISOString()
        : date;
      return makeMsg(role, content, timestamp);
    })
    .filter(Boolean);

  if (messages.length === 0) {
    throw new Error("Metaso API payload did not contain any message text.");
  }

  return [{
    id: makeId(),
    title: data.title && data.title !== "新对话" ? data.title : messages[0].content.slice(0, 80).split("\n")[0],
    platform: "Metaso",
    date,
    folderId: null,
    messages,
  }];
}

function parseGeminiBatchExecuteResponse(text: string): any | null {
  for (const line of text.split("\n")) {
    if (!line.startsWith("[[")) continue;

    try {
      const envelope = JSON.parse(line);
      for (const entry of envelope) {
        if (entry?.[0] === "wrb.fr" && entry?.[1] === "ujx1Bf" && typeof entry?.[2] === "string") {
          return JSON.parse(entry[2]);
        }
      }
    } catch {}
  }

  return null;
}

function geminiTimestamp(value: any, fallback: string): string {
  if (!Array.isArray(value) || typeof value[0] !== "number") return fallback;
  const millis = value[0] * 1000 + Math.floor((typeof value[1] === "number" ? value[1] : 0) / 1_000_000);
  return new Date(millis).toISOString();
}

function extractGeminiUserText(request: any): string {
  const parts = request?.[0];
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part: any) => typeof part === "string" ? part.trim() : "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractGeminiResponseText(response: any): string {
  const candidates = [
    response?.[0]?.[0]?.[1],
    response?.[0]?.[1],
    response?.[0]?.[11]?.[0],
    response?.[11]?.[0],
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const text = candidate
        .map((part: any) => typeof part === "string" ? part.trim() : "")
        .filter(Boolean)
        .join("\n\n")
        .trim();
      if (text) return text;
    }

    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return "";
}

/** 深扫响应节点收集 lh3.googleusercontent.com 生成图 URL，按数组顺序去重（spec media-assets §4.5）。 */
function collectGeminiImageUrls(node: any, out: string[] = [], seen = new Set<string>()): string[] {
  if (typeof node === "string") {
    if (/^https:\/\/lh3\.googleusercontent\.com\//.test(node) && !seen.has(node)) {
      seen.add(node);
      out.push(node);
    }
  } else if (Array.isArray(node)) {
    for (const child of node) collectGeminiImageUrls(child, out, seen);
  } else if (node && typeof node === "object") {
    for (const child of Object.values(node)) collectGeminiImageUrls(child, out, seen);
  }
  return out;
}

/**
 * Gemini 正文内联 image_generation_content/<N> 占位 token 按序号替换为对应 lh3 生成图；
 * 无对应图片时删除 token 并插入占位；未被 token 引用的生成图按序补在正文末尾（spec §4.5）。
 */
function applyGeminiInlineImages(text: string, imageUrls: string[]): string {
  const usedIndices = new Set<number>();
  let result = text.replace(
    /https?:\/\/googleusercontent\.com\/image_generation_content\/(\d+)/g,
    (_match, n: string) => {
      const idx = Number(n);
      usedIndices.add(idx);
      const url = imageUrls[idx];
      return url ? `![生成图片 ${idx + 1}](${url})` : "[生成图片缺失]";
    },
  );
  const extra = imageUrls
    .map((url, i) => (usedIndices.has(i) ? null : `![生成图片 ${i + 1}](${url})`))
    .filter(Boolean) as string[];
  if (extra.length > 0) result = [result.trim(), ...extra].filter(Boolean).join("\n\n");
  return result;
}

function parseGeminiApiPayload(data: any): any[] {
  const date = new Date().toISOString();
  const conversation = data?.[0];
  const turns = conversation?.[1];
  if (!Array.isArray(turns) || turns.length === 0) {
    throw new Error("Gemini API payload did not contain any messages.");
  }

  const messages: any[] = [];
  for (const turn of turns) {
    const timestamp = geminiTimestamp(turn?.[4], date);
    const userText = extractGeminiUserText(turn?.[2]);
    const aiText = applyGeminiInlineImages(
      extractGeminiResponseText(turn?.[3]),
      collectGeminiImageUrls(turn?.[3]),
    );

    if (userText) messages.push(makeMsg("user", userText, timestamp));
    if (aiText) messages.push(makeMsg("ai", aiText, timestamp));
  }

  if (messages.length === 0) {
    throw new Error("Gemini API payload did not contain any message text.");
  }

  return [{
    id: makeId(),
    title: conversation?.[2]?.[1] || messages[0].content.slice(0, 80).split("\n")[0],
    platform: "Gemini",
    date,
    folderId: null,
    messages,
  }];
}

function assertNoKnownUnavailablePage(url: string, $: cheerio.CheerioAPI): void {
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const pageTitle = getPageTitle($);

  if (url.includes("qianwen.com") && bodyText.includes("分享内容已失效")) {
    throw new Error(`Qianwen share content is unavailable or expired: ${pageTitle || url}`);
  }

  if (url.includes("doubao.com") && bodyText.includes("_ROUTER_DATA") && bodyText.includes('"shareInfo":{}')) {
    throw new Error("Doubao share content is not readable in the current fetch session; the page returned an expired/login-required session or an empty share payload.");
  }

  if (url.includes("metaso.cn") && (bodyText.includes("NEXT_NOT_FOUND") || bodyText.includes("您访问的页面找不到了"))) {
    throw new Error("Metaso share content is unavailable or not found.");
  }

  if (url.includes("gemini.google.com/share/") && bodyText.includes("Gemini 显示的信息") && bodyText.includes("登录")) {
    throw new Error("Gemini share content is not readable from the rendered shell; the structured share API returned no messages.");
  }
}

export async function parseSharedLinkData(url: string, html: string): Promise<any[]> {
  if (html.startsWith('{"__QIANWEN_API_PAYLOAD__"')) {
    const payload = JSON.parse(html);
    return parseQianwenApiPayload(payload.__QIANWEN_API_PAYLOAD__);
  }

  if (html.startsWith('{"__METASO_API_PAYLOAD__"')) {
    const payload = JSON.parse(html);
    return parseMetasoApiPayload(payload.__METASO_API_PAYLOAD__);
  }

  if (html.startsWith('{"__GEMINI_API_PAYLOAD__"')) {
    const payload = JSON.parse(html);
    return parseGeminiApiPayload(payload.__GEMINI_API_PAYLOAD__);
  }

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

  if (url.includes("doubao.com/thread/")) {
    const doubaoConversations = parseDoubaoShare($);
    if (doubaoConversations) return doubaoConversations;
  }

  assertNoKnownUnavailablePage(url, $);

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
  const pageTitle = getPageTitle($);
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
