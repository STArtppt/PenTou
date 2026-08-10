import { chatGptAdapter } from "./chatgpt";
import { deepSeekAdapter } from "./deepseek";
import { doubaoAdapter } from "./doubao";
import { qwenAdapter } from "./qwen";
import { qwenIntlAdapter } from "./qwen-intl";
import { geminiAdapter } from "./gemini";
import type { PlatformAdapter } from "./types";

export const adapters: PlatformAdapter[] = [
  chatGptAdapter,
  deepSeekAdapter,
  doubaoAdapter,
  qwenAdapter,
  qwenIntlAdapter,
  geminiAdapter,
];

export function findAdapter(href = location.href): PlatformAdapter | null {
  const url = new URL(href);
  return adapters.find((adapter) => adapter.matches(url)) ?? null;
}
