import { registerRawNormalizer } from "./registry.js";
import { normalizeChatGptApi } from "./chatgpt-api.js";
import { normalizeDeepSeekApi } from "./deepseek-api.js";
import { normalizeDoubaoApi } from "./doubao-api.js";
import { normalizeQwenApi } from "./qwen-api.js";
import { normalizeQwenIntlApi } from "./qwen-intl-api.js";
import { normalizeGeminiApi } from "./gemini-api.js";
import { normalizeGrokCli } from "./grok-cli.js";
import { normalizeOpencode } from "./opencode.js";
import { normalizeCopilot } from "./copilot.js";
import { normalizeCopilotVscode } from "./copilot-vscode.js";
import { normalizeHermes } from "./hermes.js";
import { normalizeCursor } from "./cursor.js";
import { normalizePi } from "./pi.js";

export function registerDefaultRawNormalizers(): void {
  registerRawNormalizer("chatgpt", normalizeChatGptApi);
  registerRawNormalizer("deepseek", normalizeDeepSeekApi);
  // extension-source-expansion-cn：豆包 / Qwen 双站 / Gemini
  registerRawNormalizer("doubao", normalizeDoubaoApi);
  registerRawNormalizer("qwen", normalizeQwenApi);
  registerRawNormalizer("qwen-intl", normalizeQwenIntlApi);
  registerRawNormalizer("gemini", normalizeGeminiApi);
  // 采集源扩展（spec collector-source-expansion §4.1）；codex 走 parseFileContent
  // fallback（rollout JSONL 已由 parseJsonl 识别并输出 platform "ChatGPT"）
  registerRawNormalizer("grok-cli", normalizeGrokCli);
  registerRawNormalizer("opencode", normalizeOpencode);
  registerRawNormalizer("copilot", normalizeCopilot);
  registerRawNormalizer("copilot-vscode", normalizeCopilotVscode);
  registerRawNormalizer("hermes", normalizeHermes);
  registerRawNormalizer("cursor", normalizeCursor);
  registerRawNormalizer("pi", normalizePi);
}
