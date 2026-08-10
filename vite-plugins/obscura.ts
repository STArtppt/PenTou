import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Readable } from "node:stream";
import * as cheerio from "cheerio";
import { parseDeepSeekExport, parseChatGPTExport } from "../src/app/parsers.js";
import { conversationsFromDoubaoShareData } from "../src/shared/share-parsers/doubao.js";
import { parseQianwenApiPayload } from "../src/shared/share-parsers/qwen.js";
import {
  parseGeminiApiPayload,
  parseGeminiBatchExecuteResponse,
} from "../src/shared/share-parsers/gemini.js";

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

/** 千问分享页：www.qianwen.com / qianwen.my.cn 等（API 同源 chat2-api.qianwen.com）。 */
function isQianwenShareUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const isHost =
      host === "qianwen.com" ||
      host.endsWith(".qianwen.com") ||
      host === "qianwen.my.cn" ||
      host.endsWith(".qianwen.my.cn");
    return isHost && /\/share\/chat\//.test(u.pathname);
  } catch {
    return /qianwen\.(com|my\.cn)\/share\/chat\//i.test(url);
  }
}

function isQianwenHostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return (
      host === "qianwen.com" ||
      host.endsWith(".qianwen.com") ||
      host === "qianwen.my.cn" ||
      host.endsWith(".qianwen.my.cn")
    );
  } catch {
    return /qianwen\.(com|my\.cn)/i.test(url);
  }
}

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

/**
 * 按平台/架构返回 obscura release 资产名；不支持的组合返回 null。
 * 导出供回归测试锁定映射（尤其 linux-arm64 与 glibc 资产名）。
 */
export function resolveObscuraAssetName(
  platform: NodeJS.Platform | string = os.platform(),
  arch: string = os.arch(),
): string | null {
  let normalizedArch = arch;
  if (normalizedArch === "amd64") normalizedArch = "x64";
  if (normalizedArch === "aarch64") normalizedArch = "arm64";

  if (platform === "win32") return "obscura-x86_64-windows.zip";
  if (platform === "darwin") {
    return normalizedArch === "arm64" ? "obscura-aarch64-macos.tar.gz" : "obscura-x86_64-macos.tar.gz";
  }
  if (platform === "linux") {
    // Upstream ships glibc-linked linux builds for both arches (not musl/Alpine).
    if (normalizedArch === "arm64") return "obscura-aarch64-linux.tar.gz";
    if (normalizedArch === "x64") return "obscura-x86_64-linux.tar.gz";
    return null;
  }
  return null;
}

function obscuraAssetName(): string | null {
  return resolveObscuraAssetName();
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

    if (os.platform() !== "win32") {
      for (const name of [OBSCURA_FILE, "obscura-worker"]) {
        const p = path.join(binDir, name);
        if (fs.existsSync(p)) fs.chmodSync(p, 0o755);
      }
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

  if (isQianwenShareUrl(url)) {
    const shareId = url.match(/\/share\/chat\/([^/?#]+)/)?.[1];
    if (shareId) {
      try {
        const apiUrl = "https://chat2-api.qianwen.com/api/v1/share/info?pr=qwen&fr=mac";
        // Origin 用官方主站；Referer 保留用户粘贴的分享 URL（含 qianwen.my.cn）。
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            ...BROWSER_HEADERS,
            "Content-Type": "application/json",
            Origin: "https://www.qianwen.com",
            Referer: url,
          },
          body: JSON.stringify({ share_id: shareId, biz_id: "ai_qwen" }),
        });
        const data = await res.json();
        if (res.ok && data?.data?.session?.record_list) {
          return JSON.stringify({ __QIANWEN_API_PAYLOAD__: data.data });
        }
        // API 明确无 record_list（失效/空分享）时不要掉 DOM 抓「分享内容已失效」脏文案。
        if (res.ok) {
          throw new Error(
            `Qianwen share content is unavailable or expired: share_id=${shareId}`,
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("Qianwen share content is unavailable")) {
          throw e;
        }
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

  // Gemini 长链 gemini.google.com/share/{id}；官网分享现多返回短链 share.gemini.google/{code}（301 → 长链）
  if (url.includes("gemini.google.com/share/") || url.includes("share.gemini.google/")) {
    let shareId = url.match(/gemini\.google\.com\/share\/([^/?#]+)/)?.[1] ?? null;
    if (!shareId && url.includes("share.gemini.google/")) {
      try {
        // 短链本身不是 batchexecute shareId，须跟 301 Location 解析真实 id
        const resolveRes = await fetch(url, { headers: BROWSER_HEADERS, redirect: "manual" });
        const location = resolveRes.headers.get("location");
        if (location) {
          const resolved = new URL(location, url);
          shareId = resolved.pathname.match(/\/share\/([^/?#]+)/)?.[1] ?? null;
        }
      } catch (e) {
        console.warn("Gemini short share link resolve failed", e);
      }
    }
    if (shareId) {
      try {
        const referer = `https://gemini.google.com/share/${shareId}`;
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
            "Referer": referer,
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

  // Grok public share — conversation lives in REST, not the Next.js SPA shell.
  if (url.includes("grok.com/share/")) {
    const shareLinkId = url.match(/grok\.com\/share\/([^/?#]+)/)?.[1];
    if (shareLinkId) {
      try {
        const apiUrl = `https://grok.com/rest/app-chat/share_links/${encodeURIComponent(shareLinkId)}`;
        const res = await fetch(apiUrl, {
          headers: {
            ...BROWSER_HEADERS,
            Accept: "application/json",
            Referer: url,
            Origin: "https://grok.com",
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.responses)) {
            return JSON.stringify({ __GROK_API_PAYLOAD__: data });
          }
        } else {
          console.warn("Native Grok share API returned", res.status);
        }
      } catch (e) {
        console.warn("Native Grok API fetch failed", e);
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

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(() => {
        // Linux: file exists but PT_INTERP (glibc loader) missing → spawn ENOENT.
        // Alpine/musl images historically hit this with official obscura builds.
        if (error?.code === "ENOENT") {
          reject(
            new Error(
              `Obscura binary not executable at ${obscuraPath} (ENOENT). ` +
                "If the file exists, the image likely lacks the glibc dynamic linker " +
                "(use a Debian/glibc base such as node:*-slim, not Alpine/musl).",
            ),
          );
          return;
        }
        reject(error);
      });
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

/**
 * 从 data-fn-args 里深挖出 `{ share_info, message_snapshot }`。
 * 豆包换过壳：老形态 `data-fn-name="r"` 的 `args[2].data`；2026-08 起是
 * `mergeLoaderData(["thread_(token)/page", [{ routerDataFnArgs: ["<JSON 字符串>"] }]])`，
 * 载荷又被串成字符串多包了一层。按结构找而非按路径找，换壳不再失配。
 */
function findDoubaoShareData(value: any, depth = 0): any | null {
  if (value == null || depth > 12) return null;

  if (typeof value === "string") {
    if (!value.includes("message_snapshot")) return null;
    const parsed = tryParseJson(value);
    return parsed ? findDoubaoShareData(parsed, depth + 1) : null;
  }
  if (typeof value !== "object") return null;

  if (!Array.isArray(value) && Array.isArray(value?.message_snapshot?.message_list)) return value;

  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    const hit = findDoubaoShareData(item, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function parseDoubaoShare($: cheerio.CheerioAPI): any[] | null {
  let shareData: any | null = null;

  $("script[data-fn-args]").each((_, script) => {
    if (shareData) return;
    const argsText = $(script).attr("data-fn-args") || "";
    if (!argsText.includes("message_snapshot")) return;

    const args = tryParseJson(argsText);
    if (args) shareData = findDoubaoShareData(args);
  });

  return conversationsFromDoubaoShareData(shareData);
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

  type Msg = ReturnType<typeof makeMsg>;
  const messages = sourceMessages
    .slice()
    .sort((a: any, b: any) => (a.depth ?? 0) - (b.depth ?? 0))
    .map((message: any): Msg | null => {
      const content = extractMetasoMessageText(message);
      if (!content) return null;
      const role = message.role === "USER" ? "user" : "ai";
      const timestamp = typeof message.createTime === "string"
        ? new Date(message.createTime).toISOString()
        : date;
      return makeMsg(role, content, timestamp);
    })
    .filter((m): m is Msg => m !== null);

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

/** Strip Grok citation / card markup that is not valid Markdown. */
function cleanGrokMessageContent(content: string): string {
  return content
    .replace(/<grok:render\b[^>]*>[\s\S]*?<\/grok:render>/gi, "")
    .replace(/<\/?argument\b[^>]*>/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractGrokMessageImages(response: any): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (url: unknown) => {
    if (typeof url !== "string" || !url.trim() || seen.has(url)) return;
    seen.add(url);
    urls.push(url.trim());
  };

  if (Array.isArray(response?.generatedImageUrls)) {
    for (const url of response.generatedImageUrls) push(url);
  }
  if (Array.isArray(response?.imageAttachments)) {
    for (const img of response.imageAttachments) {
      push(img?.url || img?.imageUrl || img?.src);
    }
  }
  return urls;
}

function parseGrokApiPayload(data: any): any[] {
  const responses = data?.responses;
  if (!Array.isArray(responses) || responses.length === 0) {
    throw new Error("Grok share content is unavailable or empty.");
  }

  const messages: any[] = [];
  for (const response of responses) {
    if (response?.isControl) continue;

    const raw = typeof response?.message === "string" ? response.message : "";
    const text = cleanGrokMessageContent(raw);
    const images = extractGrokMessageImages(response).map(
      (url, i) => `![生成图片 ${i + 1}](${url})`,
    );
    const content = [text, ...images].filter(Boolean).join("\n\n");
    if (!content) continue;

    const sender = String(response?.sender || "").toLowerCase();
    const role: "user" | "ai" =
      sender === "human" || sender === "user" ? "user" : "ai";
    const timestamp =
      typeof response?.createTime === "string" && response.createTime
        ? response.createTime
        : new Date().toISOString();

    messages.push(makeMsg(role, content, timestamp));
  }

  if (messages.length === 0) {
    throw new Error("Grok share content is unavailable or empty.");
  }

  const title =
    data?.conversation?.title ||
    messages.find((m) => m.role === "user")?.content?.slice(0, 80).split("\n")[0] ||
    "Grok Shared Conversation";

  return [{
    id: makeId(),
    title,
    platform: "Grok",
    date: data?.conversation?.createTime || messages[0].timestamp || new Date().toISOString(),
    folderId: null,
    messages,
  }];
}

function assertNoKnownUnavailablePage(url: string, $: cheerio.CheerioAPI): void {
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const pageTitle = getPageTitle($);

  if (isQianwenHostUrl(url) && bodyText.includes("分享内容已失效")) {
    throw new Error(`Qianwen share content is unavailable or expired: ${pageTitle || url}`);
  }

  if (url.includes("doubao.com") && bodyText.includes("_ROUTER_DATA") && bodyText.includes('"shareInfo":{}')) {
    throw new Error("Doubao share content is not readable in the current fetch session; the page returned an expired/login-required session or an empty share payload.");
  }

  if (url.includes("metaso.cn") && (bodyText.includes("NEXT_NOT_FOUND") || bodyText.includes("您访问的页面找不到了"))) {
    throw new Error("Metaso share content is unavailable or not found.");
  }

  if ((url.includes("gemini.google.com/share/") || url.includes("share.gemini.google/")) && bodyText.includes("Gemini 显示的信息") && bodyText.includes("登录")) {
    throw new Error("Gemini share content is not readable from the rendered shell; the structured share API returned no messages.");
  }

  // Grok share pages are client-rendered; without the REST payload we only have SPA shell noise.
  if (url.includes("grok.com/share/")) {
    throw new Error(
      "Grok share content is not readable from the rendered shell; the share_links API returned no messages.",
    );
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

  if (html.startsWith('{"__GROK_API_PAYLOAD__"')) {
    const payload = JSON.parse(html);
    return parseGrokApiPayload(payload.__GROK_API_PAYLOAD__);
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
