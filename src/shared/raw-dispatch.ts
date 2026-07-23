/**
 * raw-dispatch.ts
 * raw 两级派发（spec ingest-gateway §4.4）：platform 命中已注册 normalizer 优先，
 * 未命中回退 parseFileContent。
 *
 * 自 src/server/api-router.ts 提取为共享模块（spec collector-oversize-ingest §4.5 决策 2）：
 * 服务端 ingest 与 CLI 超限降级路径引用同一份派发代码，杜绝解析分叉——解析派发的
 * 唯一入口在此，不要在别处复制。
 */
import { parseFileContent } from "./parsers.js";
import { getRawNormalizer } from "./normalizers/registry.js";
import { registerDefaultRawNormalizers } from "./normalizers/defaults.js";
import { EmptyPayloadError } from "./normalizers/util.js";

export { EmptyPayloadError };

/** 无 filename 时按内容猜派发扩展名（filename 仅辅助 parseFileContent 派发，§4.3）。 */
export function guessRawFilename(data: string): string {
  const trimmed = data.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "ingest.json";
    } catch {
      return "ingest.jsonl"; // 整体非法但可能是逐行 JSON
    }
  }
  return "ingest.md";
}

/**
 * 失败以 Error 抛出，由调用方逐 item 容错捕获（错误消息即 results[].error）。
 */
export function parseRawConversations(platform: string, data: string, filename?: string): any[] {
  registerDefaultRawNormalizers();
  const normalizer = getRawNormalizer(platform);
  if (normalizer) {
    const conversations = normalizer(data, filename);
    if (conversations.length === 0) throw new EmptyPayloadError("no conversations parsed");
    return conversations;
  }
  const name = (filename ?? "").trim() || guessRawFilename(data);
  if (!/\.(json|jsonl|md|txt)$/i.test(name)) throw new Error("unrecognized format");
  const conversations = parseFileContent(name, data);
  if (conversations.length === 0) throw new EmptyPayloadError("no conversations parsed");
  return conversations;
}
