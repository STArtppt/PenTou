import { registerRawNormalizer } from "./registry.js";
import { normalizeChatGptApi } from "./chatgpt-api.js";
import { normalizeDeepSeekApi } from "./deepseek-api.js";
import { normalizeGrokCli } from "./grok-cli.js";
import { normalizeOpencode } from "./opencode.js";
import { normalizeCopilot } from "./copilot.js";
import { normalizeCopilotVscode } from "./copilot-vscode.js";
import { normalizeHermes } from "./hermes.js";
import { normalizeCursor } from "./cursor.js";

export function registerDefaultRawNormalizers(): void {
  registerRawNormalizer("chatgpt", normalizeChatGptApi);
  registerRawNormalizer("deepseek", normalizeDeepSeekApi);
  // 采集源扩展（spec collector-source-expansion §4.1）；codex 走 parseFileContent
  // fallback（rollout JSONL 已由 parseJsonl 识别并输出 platform "ChatGPT"）
  registerRawNormalizer("grok-cli", normalizeGrokCli);
  registerRawNormalizer("opencode", normalizeOpencode);
  registerRawNormalizer("copilot", normalizeCopilot);
  registerRawNormalizer("copilot-vscode", normalizeCopilotVscode);
  registerRawNormalizer("hermes", normalizeHermes);
  registerRawNormalizer("cursor", normalizeCursor);
}
