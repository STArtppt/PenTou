/**
 * 测试用 collector 配置辅助：在默认全量配置上深合并，允许只写关心的 adapters 字段。
 * 不削弱生产侧 CollectorConfig（见 typecheck-debt-zero design D4）。
 */
import { defaultConfig } from "./config.js";
import type { CollectorConfig } from "./types.js";

type DeepPartialAdapters = {
  [K in keyof CollectorConfig["adapters"]]?: Partial<CollectorConfig["adapters"][K]>;
};

export type CollectorConfigOverrides = Omit<Partial<CollectorConfig>, "adapters"> & {
  adapters?: DeepPartialAdapters;
};

export function makeCollectorConfig(overrides: CollectorConfigOverrides = {}): CollectorConfig {
  // defaultConfig 运行时已深合并 adapters；此处只把 overrides 类型放宽到 DeepPartial
  return defaultConfig(overrides as Partial<CollectorConfig>);
}
