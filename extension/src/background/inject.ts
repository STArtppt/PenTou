import type { ContentRequest, ContentResponse } from "../shared/types";

/**
 * content script 只在页面加载时注入。插件安装/重载之前就打开的标签页里没有它
 * （重载还会让旧实例的扩展上下文失效），此时 sendMessage 抛错，用户看到的却是
 * "页面不支持"——指向完全错误的方向。
 *
 * 这里在首次投递失败后用 chrome.scripting 按需注入再重试一次（manifest 早已声明
 * scripting 权限但一直未使用）。注入文件名从 manifest 读取，避免写死 crxjs 的哈希文件名。
 */
export function contentScriptFiles(runtime: typeof chrome.runtime): string[] {
  const scripts = runtime.getManifest().content_scripts ?? [];
  return scripts.flatMap((entry) => entry.js ?? []);
}

export async function sendToContentScript(
  tabId: number,
  request: ContentRequest,
  api: {
    sendMessage: (tabId: number, request: ContentRequest) => Promise<ContentResponse>;
    executeScript: (opts: { target: { tabId: number }; files: string[] }) => Promise<unknown>;
    files: string[];
  },
): Promise<ContentResponse | undefined> {
  try {
    return await api.sendMessage(tabId, request);
  } catch {
    // 未注入或上下文失效 → 尝试按需注入
  }

  if (api.files.length === 0) return undefined;
  try {
    await api.executeScript({ target: { tabId }, files: api.files });
  } catch {
    return undefined; // 非受支持域名 / 无 host 权限：维持"不支持"提示
  }

  try {
    return await api.sendMessage(tabId, request);
  } catch {
    return undefined;
  }
}
