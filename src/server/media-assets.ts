/**
 * media-assets.ts
 * 图片资产本地化（spec: media-assets §4.1-§4.3）。
 *
 * - 内容寻址落盘：data/assets/<sha256 前 16 位>.<ext>，字节级天然去重（决策 3）
 * - localizeMedia：统一入口，remark AST 仅处理 image 节点（决策 8），
 *   data URI 解码落盘 / baseDir 相对路径读取（边界 6）/ 远程下载（边界 3 SSRF 防护）
 * - 任何单图失败均保留原引用，绝不让入库失败（决策 4 / 异常 2）
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Image, Root } from "mdast";
import { visit } from "unist-util-visit";
import { remarkGfm, remarkGfmOptions } from "../shared/markdown-gfm.js";

// ── 常量（spec §4.3） ─────────────────────────────────────────────────────────

// 首期仅位图，不含 .svg（决策 10）
export const ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif"]);
export const REMOTE_DOWNLOAD_TIMEOUT_MS = 10_000;
export const ASSET_MAX_SIZE = 20 * 1024 * 1024;
const REMOTE_DOWNLOAD_CONCURRENCY = 4; // spec §8 风险 2
const REDIRECT_LIMIT = 3; // 边界 3

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/avif": ".avif",
};

export const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

export interface LocalizeOptions {
  downloadRemote?: boolean; // 是否下载远程图片；默认 false，仅导入路径显式开启（§4.4 挂接清单）
  baseDir?: string;         // 相对路径图片引用的解析根目录；未提供时相对路径一律保留原样（边界 6）
  urlCache?: Map<string, string | null>; // 同批导入共享缓存：同一 URL 只处理一次（US-03 AC3）
}

// ── 目录状态（对齐 documentsPlugin 的模块级 setter 模式） ──────────────────────

let DATA_DIR = path.resolve(process.cwd(), "data");
export let ASSETS_DIR = path.join(DATA_DIR, "assets");

export function setAssetsDataDir(dataDir: string): void {
  DATA_DIR = path.resolve(dataDir);
  ASSETS_DIR = path.join(DATA_DIR, "assets");
}

export function ensureAssetsDir(dataDir?: string): void {
  if (dataDir) setAssetsDataDir(dataDir);
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// ── 落盘（内容寻址，决策 3） ──────────────────────────────────────────────────

/** 写入资产文件，返回 "/api/assets/<hash><ext>"；同字节内容只存一份。 */
export function saveAssetBuffer(buf: Buffer, ext: string): string {
  const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const fileName = `${hash}${ext}`;
  const filePath = path.join(ASSETS_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
    fs.writeFileSync(filePath, buf);
  }
  return `/api/assets/${fileName}`;
}

/** 魔数识别图片格式；识别不出返回 null（边界 7：扩展名以内容为准）。 */
export function sniffImageExt(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return ".png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return ".gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  if (buf[0] === 0x42 && buf[1] === 0x4d) return ".bmp";
  if (buf.subarray(4, 12).toString("ascii") === "ftypavif") return ".avif";
  return null;
}

/** Content-Type → 魔数 → fallback 后缀，三级判定；不在白名单则 null。 */
export function resolveAssetExt(buf: Buffer, contentType?: string | null, fallbackExt?: string | null): string | null {
  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (mime && MIME_TO_EXT[mime]) return MIME_TO_EXT[mime];
  const sniffed = sniffImageExt(buf);
  if (sniffed) return sniffed;
  const fb = (fallbackExt ?? "").toLowerCase();
  if (fb && ASSET_EXTENSIONS.has(fb)) return fb;
  return null;
}

// ── SSRF 防护（边界 3） ───────────────────────────────────────────────────────

function isForbiddenIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0) return true;                       // unspecified / "this" network（含 0.0.0.0）
  if (a === 10) return true;                      // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (reserved)
  if (a === 127) return true;                     // loopback
  if (a === 169 && b === 254) return true;        // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && (b === 0 || b === 168)) return true; // 192.0.0/24, 192.0.2/24 (doc), private
  // 注意：不拦截 198.18.0.0/15（RFC 2544 benchmark）。Clash / Surge 等代理的
  // fake-ip 模式会把公网域名解析到该段；拦截后远程图永远下不下来，md 只能
  // 保留 hotlink，签名 URL 一过期就「图片加载失败」。该段不指向本机内网服务。
  if (a === 198 && b === 51) return true;         // 198.51.100/24 doc
  if (a === 203 && b === 0) return true;          // 203.0.113/24 doc
  if (a >= 224) return true;                      // multicast + reserved + broadcast
  return false;
}

/** v4-mapped IPv6 提取嵌入的 IPv4（兼容 ::ffff:1.2.3.4 与 ::ffff:0102:0304 两种写法）。 */
function mappedIPv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return null;
}

/** 拒绝 loopback / private / link-local / reserved / multicast / unspecified（IPv4 + IPv6）。 */
export function isForbiddenIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isForbiddenIPv4(ip);
  if (!net.isIPv6(ip)) return true;
  const v4 = mappedIPv4(ip);
  if (v4) return isForbiddenIPv4(v4);
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;       // unspecified / loopback
  const head = lower.split(":")[0];
  if (/^fe[89ab]/.test(head)) return true;                  // link-local fe80::/10
  if (/^f[cd]/.test(head)) return true;                     // unique-local fc00::/7
  if (/^ff/.test(head)) return true;                        // multicast
  return false;
}

type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

let lookupImpl: LookupFn = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/** 仅供单测注入 DNS 解析；传 null 还原真实实现。 */
export function __setDnsLookupForTests(fn: LookupFn | null): void {
  lookupImpl = fn ?? ((hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true }));
}

/**
 * 校验 URL 协议与主机：DNS 解析后校验全部 IP，返回一个已校验 IP 用于连接级绑定
 * （杜绝校验与连接之间的 DNS rebinding，边界 3）。不通过抛错。
 */
async function resolvePinnedIp(url: URL): Promise<{ address: string; family: number }> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) {
    if (isForbiddenIp(hostname)) throw new Error(`Forbidden IP: ${hostname}`);
    return { address: hostname, family: net.isIPv6(hostname) ? 6 : 4 };
  }
  const records = await lookupImpl(hostname);
  if (records.length === 0) throw new Error(`DNS lookup failed: ${hostname}`);
  for (const rec of records) {
    if (isForbiddenIp(rec.address)) throw new Error(`Forbidden IP for ${hostname}: ${rec.address}`);
  }
  return { address: records[0].address, family: records[0].family };
}

// ── 远程下载（可注入传输层，便于单测 mock） ───────────────────────────────────

export interface HttpGetResult {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

type HttpGet = (url: URL, pinned: { address: string; family: number }) => Promise<HttpGetResult>;

function realHttpGet(url: URL, pinned: { address: string; family: number }): Promise<HttpGetResult> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    // lookup 固定返回已校验 IP，实际连接与校验结果绑定（边界 3 防 rebinding）
    const lookup: any = (_host: string, options: any, cb: any) => {
      if (options?.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
      else cb(null, pinned.address, pinned.family);
    };
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup,
        timeout: REMOTE_DOWNLOAD_TIMEOUT_MS,
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          // 部分 CDN（含 Google usercontent）对无 UA 的请求更苛刻
          "User-Agent": "PentouMediaLocalizer/1.0",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > ASSET_MAX_SIZE) {
            req.destroy(new Error("Response exceeds size limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Download timed out")));
    req.on("error", reject);
    req.end();
  });
}

let httpGetImpl: HttpGet = realHttpGet;

/** 仅供单测注入传输层；传 null 还原真实实现。 */
export function __setHttpGetForTests(fn: HttpGet | null): void {
  httpGetImpl = fn ?? realHttpGet;
}

function headerValue(headers: HttpGetResult["headers"], name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * 下载远程图片：逐跳 manual 重定向（上限 3 次），每一跳重新执行协议与 IP 校验；
 * 非 image/* 响应放弃。失败抛错（由调用方保留原引用兜底）。
 */
async function downloadRemoteImage(rawUrl: string): Promise<{ buffer: Buffer; contentType?: string; urlPath: string }> {
  let current = new URL(rawUrl);
  for (let hop = 0; hop <= REDIRECT_LIMIT; hop++) {
    const pinned = await resolvePinnedIp(current);
    const res = await httpGetImpl(current, pinned);
    if (res.statusCode >= 301 && res.statusCode <= 308 && headerValue(res.headers, "location")) {
      if (hop === REDIRECT_LIMIT) throw new Error("Too many redirects");
      current = new URL(headerValue(res.headers, "location")!, current);
      continue;
    }
    if (res.statusCode !== 200) throw new Error(`Download failed with status ${res.statusCode}`);
    const contentType = headerValue(res.headers, "content-type");
    if (!contentType || !contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`Not an image response: ${contentType ?? "unknown"}`);
    }
    if (res.body.length > ASSET_MAX_SIZE) throw new Error("Image exceeds size limit");
    return { buffer: res.body, contentType, urlPath: current.pathname };
  }
  throw new Error("Too many redirects");
}

// ── 各引用类型的本地化 ────────────────────────────────────────────────────────

/** data URI → 落盘；不可识别 / 超大 / 非位图（含 SVG）→ null 保留原样。 */
function localizeDataUri(uri: string): string | null {
  const match = uri.match(/^data:([a-z0-9.+/-]+);base64,(.*)$/is);
  if (!match) return null;
  const ext = MIME_TO_EXT[match[1].toLowerCase()];
  if (!ext) return null; // 含 image/svg+xml（决策 10）与未知格式
  // base64 长度预估（×3/4），避免先解码超大载荷
  if (match[2].length * 0.75 > ASSET_MAX_SIZE) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
  if (buf.length === 0 || buf.length > ASSET_MAX_SIZE) return null;
  return saveAssetBuffer(buf, ext);
}

/** baseDir 内相对路径 → 读取落盘；绝对路径 / realpath 越界一律不读取（边界 6）。 */
function localizeRelativeFile(ref: string, baseDir: string): string | null {
  let decoded = ref;
  try {
    decoded = decodeURIComponent(ref);
  } catch {
    /* 保留原样 */
  }
  decoded = decoded.split(/[?#]/)[0];
  if (!decoded || path.isAbsolute(decoded) || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) return null;
  try {
    const baseReal = fs.realpathSync(baseDir);
    const candidate = path.resolve(baseDir, decoded);
    if (!fs.existsSync(candidate)) return null;
    const candidateReal = fs.realpathSync(candidate);
    const rel = path.relative(baseReal, candidateReal);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    const stat = fs.statSync(candidateReal);
    if (!stat.isFile() || stat.size > ASSET_MAX_SIZE) return null;
    const buf = fs.readFileSync(candidateReal);
    const ext = resolveAssetExt(buf, null, path.extname(candidateReal));
    if (!ext) return null;
    return saveAssetBuffer(buf, ext);
  } catch {
    return null;
  }
}

async function localizeRemoteUrl(url: string): Promise<string | null> {
  try {
    const { buffer, contentType, urlPath } = await downloadRemoteImage(url);
    const ext = resolveAssetExt(buffer, contentType, path.extname(urlPath));
    if (!ext) return null; // 非白名单位图（含 SVG）保留原 URL
    return saveAssetBuffer(buffer, ext);
  } catch (e) {
    console.warn(`[media-assets] remote image kept as-is: ${url}`, String((e as Error)?.message ?? e));
    return null;
  }
}

// ── localizeMedia 统一入口（决策 8：AST 定位 image 节点，按 offset 精准替换） ──

interface ImageRef {
  url: string;
  alt: string | null;
  title: string | null;
  start: number;
  end: number;
}

// 超长 data URI 会让 markdown 解析慢到不可用（MB 级 base64），解析前先压缩为
// 短占位 token，分类时再换回原文；未被本地化的 token（如代码块内）最后原样还原。
const LONG_DATA_URI_RE = /data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=]{4096,}/gi;
const DATA_URI_TOKEN_RE = /data:application\/x-pentou-token;base64,T\d+=/g;

function compactLongDataUris(body: string): { compactBody: string; tokenMap: Map<string, string> } {
  const tokenMap = new Map<string, string>();
  if (!body.includes(";base64,")) return { compactBody: body, tokenMap };
  let i = 0;
  const compactBody = body.replace(LONG_DATA_URI_RE, (match) => {
    const token = `data:application/x-pentou-token;base64,T${i++}=`;
    tokenMap.set(token, match);
    return token;
  });
  return { compactBody, tokenMap };
}

function collectImageRefs(body: string): ImageRef[] {
  const tree = unified().use(remarkParse).use(remarkGfm, remarkGfmOptions).parse(body) as Root;
  const refs: ImageRef[] = [];
  visit(tree, "image", (node) => {
    const img = node as Image;
    const start = img.position?.start?.offset;
    const end = img.position?.end?.offset;
    if (typeof start !== "number" || typeof end !== "number") return;
    refs.push({ url: img.url ?? "", alt: img.alt ?? null, title: img.title ?? null, start, end });
  });
  return refs;
}

/** 重建单个 image 节点的 markdown（只重写命中的节点，文档其余字节不动）。 */
function imageMarkdown(ref: ImageRef, newUrl: string): string {
  const alt = (ref.alt ?? "").replace(/([\\[\]])/g, "\\$1");
  const title = ref.title ? ` "${ref.title.replace(/"/g, '\\"')}"` : "";
  const url = /[\s()]/.test(newUrl) ? `<${newUrl}>` : newUrl;
  return `![${alt}](${url}${title})`;
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * 媒体本地化统一入口（spec §4.1）。
 * 永不抛错：解析失败或单图失败均保留原引用，返回尽可能本地化后的 markdown。
 */
export async function localizeMedia(markdown: string, opts: LocalizeOptions = {}): Promise<string> {
  if (!markdown || !markdown.includes("![")) return markdown;
  try {
    // frontmatter 原样保留（remark 不感知 frontmatter，先剥离再处理正文）
    const fmMatch = markdown.match(/^---\n[\s\S]*?\n---\n/);
    const prefix = fmMatch ? fmMatch[0] : "";
    const rawBody = markdown.slice(prefix.length);

    const { compactBody: body, tokenMap } = compactLongDataUris(rawBody);
    const refs = collectImageRefs(body);
    if (refs.length === 0) return markdown;

    // url → 本地化结果（null = 保留原样）；同批共享缓存保证同 URL 只处理一次
    const cache = opts.urlCache ?? new Map<string, string | null>();
    const remoteUrls: string[] = [];

    for (const ref of refs) {
      const url = ref.url;
      if (!url || cache.has(url)) continue;
      if (url.startsWith("/api/assets/")) {
        cache.set(url, null); // 已本地化，幂等跳过（边界 1）
      } else if (url.startsWith("data:")) {
        cache.set(url, localizeDataUri(tokenMap.get(url) ?? url));
      } else if (/^https?:\/\//i.test(url)) {
        if (opts.downloadRemote) {
          cache.set(url, null); // 占位，下载后回填
          remoteUrls.push(url);
        } else {
          cache.set(url, null); // 决策 9：非导入路径零网络请求
        }
      } else if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        cache.set(url, null); // 其他协议（含 file: 等）不处理
      } else if (opts.baseDir) {
        cache.set(url, localizeRelativeFile(url, opts.baseDir));
      } else {
        cache.set(url, null); // 未提供 baseDir 时相对路径一律保留（边界 6）
      }
    }

    if (remoteUrls.length > 0) {
      await mapWithConcurrency(remoteUrls, REMOTE_DOWNLOAD_CONCURRENCY, async (url) => {
        cache.set(url, await localizeRemoteUrl(url));
      });
    }

    // 从后向前按 offset 替换，保持前序偏移有效
    let result = body;
    for (let i = refs.length - 1; i >= 0; i--) {
      const ref = refs[i];
      const newUrl = cache.get(ref.url);
      if (!newUrl) continue;
      result = result.slice(0, ref.start) + imageMarkdown(ref, newUrl) + result.slice(ref.end);
    }
    // 未被本地化的长 data URI 占位 token 还原为原文（含代码块内、超大/畸形保留场景）
    if (tokenMap.size > 0) {
      result = result.replace(DATA_URI_TOKEN_RE, (token) => tokenMap.get(token) ?? token);
    }
    return prefix + result;
  } catch (e) {
    console.warn("[media-assets] localizeMedia failed, content kept as-is:", String((e as Error)?.message ?? e));
    return markdown;
  }
}

/** 批量本地化对话/会话消息（共享同批 urlCache），就地修改 content。 */
export async function localizeMessages(
  messages: Array<{ content?: string }> | undefined,
  opts: LocalizeOptions = {},
): Promise<void> {
  if (!Array.isArray(messages)) return;
  const urlCache = opts.urlCache ?? new Map<string, string | null>();
  for (const msg of messages) {
    if (typeof msg?.content !== "string") continue;
    msg.content = await localizeMedia(msg.content, { ...opts, urlCache });
  }
}
