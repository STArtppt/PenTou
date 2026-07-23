import { registerRawNormalizer } from "./registry.js";
import { normalizeChatGptApi } from "./chatgpt-api.js";
import { normalizeDeepSeekApi } from "./deepseek-api.js";

export function registerDefaultRawNormalizers(): void {
  registerRawNormalizer("chatgpt", normalizeChatGptApi);
  registerRawNormalizer("deepseek", normalizeDeepSeekApi);
}
