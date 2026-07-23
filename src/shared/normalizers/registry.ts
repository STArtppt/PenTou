/**
 * registry.ts — raw payload 的 normalizer 注册表（spec ingest-gateway §4.2 / §4.4）。
 *
 * ingest raw 两级派发：先按 platform 命中已注册的 normalizer，未命中回退通用
 * parseFileContent。本期只交付注册机制；各平台 normalizer（如 ChatGPT
 * backend-api JSON）随对应采集端 feature 注册。
 */
import type { Conversation } from "../../app/data.js";

export type RawNormalizer = (data: string, filename?: string) => Conversation[];

const registry = new Map<string, RawNormalizer>();

/** 注册某 platform（小写 slug）的 raw 归一化器；重复注册以后者为准。 */
export function registerRawNormalizer(platform: string, fn: RawNormalizer): void {
  registry.set(platform, fn);
}

export function getRawNormalizer(platform: string): RawNormalizer | undefined {
  return registry.get(platform);
}

// Reset for tests.
export function _resetRawNormalizersForTest(): void {
  registry.clear();
}
