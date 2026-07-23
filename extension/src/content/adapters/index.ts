import { chatGptAdapter } from "./chatgpt";
import { deepSeekAdapter } from "./deepseek";
import type { PlatformAdapter } from "./types";

export const adapters: PlatformAdapter[] = [chatGptAdapter, deepSeekAdapter];

export function findAdapter(href = location.href): PlatformAdapter | null {
  const url = new URL(href);
  return adapters.find((adapter) => adapter.matches(url)) ?? null;
}
