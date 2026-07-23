/**
 * ai-products.ts
 * 默认 AI 产品清单（spec import-auto-classify §4.3/§4.4）。
 * 与 BrandIcon 的品牌清单同源（一致性由 ai-products.test.ts 保证）；
 * 服务端导入自动归类与前端图标映射共用，清单更新走 skills/ai-products-refresh/。
 */

export interface AiProduct {
  /** 标准产品名：自动创建文件夹的 name 与 folder.platform */
  name: string;
  /** 历史/变体 platform 值（如 Qwen ← Qianwen），命中后归入标准名文件夹 */
  aliases?: string[];
}

export const DEFAULT_AI_PRODUCTS: AiProduct[] = [
  { name: "ChatGPT" },
  { name: "DeepSeek" },
  { name: "Gemini" },
  { name: "Claude" },
  { name: "Cursor" },
  { name: "Copilot" },
  { name: "Codex" },
  { name: "Hermes" },
  { name: "Doubao" },
  { name: "Metaso" },
  { name: "Qwen", aliases: ["Qianwen"] },
  { name: "Grok" },
];

/** platform 与标准名或 alias 精确匹配（不折叠大小写）；未命中返回 null → 未分类。 */
export function matchAiProduct(platform: string): AiProduct | null {
  for (const product of DEFAULT_AI_PRODUCTS) {
    if (product.name === platform || product.aliases?.includes(platform)) return product;
  }
  return null;
}
