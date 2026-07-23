/**
 * ingest-token.ts — ingest token 与采集配置（spec ingest-gateway §4.2 / §4.3）。
 *
 * - token：data/ingest/token 单行随机值（32 字节 base64url），文件权限 0600。
 *   文件不存在（首次启动 / 被删）→ 首次被读取时自动生成（§5 异常 1）。
 * - config：data/ingest/config.json `{ redact: boolean }`，默认 true；
 *   自定义脱敏规则本期不做，此文件即扩展位（§4.5 决策 6）。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function ingestDir(dataDir: string): string {
  return path.join(dataDir, "ingest");
}

function tokenPath(dataDir: string): string {
  return path.join(ingestDir(dataDir), "token");
}

function configPath(dataDir: string): string {
  return path.join(ingestDir(dataDir), "config.json");
}

/** 读取 token；不存在或为空时自动生成（§5 异常 1）。 */
export function getIngestToken(dataDir: string): string {
  try {
    const value = fs.readFileSync(tokenPath(dataDir), "utf-8").trim();
    if (value) return value;
  } catch {
    /* 不存在 → 走生成 */
  }
  return rotateIngestToken(dataDir);
}

/** 重置 token：旧值立即失效（US-03 AC3）。 */
export function rotateIngestToken(dataDir: string): string {
  const token = crypto.randomBytes(32).toString("base64url");
  fs.mkdirSync(ingestDir(dataDir), { recursive: true });
  fs.writeFileSync(tokenPath(dataDir), token, { mode: 0o600 });
  return token;
}

/** 常量时间校验（§6.1）：先哈希对齐长度再 timingSafeEqual。 */
export function verifyIngestToken(dataDir: string, presented: string): boolean {
  if (!presented) return false;
  const expected = getIngestToken(dataDir);
  const a = crypto.createHash("sha256").update(presented).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export interface IngestConfig {
  redact: boolean;
}

export function readIngestConfig(dataDir: string): IngestConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(dataDir), "utf-8"));
    return { redact: raw?.redact !== false };
  } catch {
    return { redact: true };
  }
}

export function writeIngestConfig(dataDir: string, config: IngestConfig): IngestConfig {
  const next: IngestConfig = { redact: config.redact !== false };
  fs.mkdirSync(ingestDir(dataDir), { recursive: true });
  fs.writeFileSync(configPath(dataDir), JSON.stringify(next, null, 2));
  return next;
}
