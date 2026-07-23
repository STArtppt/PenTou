import type { Document, ObsidianConfig } from "./data";
import { copyText } from "./utils/clipboard";

export const OBSIDIAN_URI_SAFE_LIMIT = 8000;

export function buildObsidianUri(doc: Document, cfg: ObsidianConfig): string {
  return (
    `obsidian://new?vault=${encodeURIComponent(cfg.vaultName)}` +
    `&name=${encodeURIComponent(doc.title)}` +
    `&content=${encodeURIComponent(doc.body)}`
  );
}

/** 打开已存在的笔记；只含 vault 名 + 文件名，长度恒安全（spec §4.5 决策 4）。 */
export function buildObsidianOpenUri(vaultName: string, fileName: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(fileName)}`;
}

/** 服务端直写单篇；失败抛错（携带服务端 error 文案）。批量导出也复用此函数。 */
export async function exportNoteViaApi(
  vaultPath: string,
  title: string,
  content: string,
): Promise<{ fileName: string }> {
  const res = await fetch("/api/obsidian/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vaultPath, title, content }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.error ?? `HTTP ${res.status}`));
  return { fileName: String(data.fileName) };
}

export interface BatchExportResult {
  succeeded: { id: string; title: string; fileName: string }[];
  failed: { id: string; title: string; error: string }[];
}

/**
 * 批量导出：逐篇先向服务端取全文再直写。
 * 不能用侧栏列表里的 doc.body —— 列表按 ?fields=meta 加载，body 恒为空串，
 * 只有激活过的文档才被 hydrate（debugging/2026-07-13-batch-export-empty-body.md）。
 */
export async function batchExportToVault(
  docs: { id: string; title: string }[],
  cfg: { vaultName: string; vaultPath: string },
): Promise<BatchExportResult> {
  const succeeded: BatchExportResult["succeeded"] = [];
  const failed: BatchExportResult["failed"] = [];
  for (const doc of docs) {
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const full = await res.json();
      const { fileName } = await exportNoteViaApi(
        cfg.vaultPath,
        String(full?.title ?? doc.title),
        String(full?.body ?? ""),
      );
      succeeded.push({ id: doc.id, title: doc.title, fileName });
    } catch (e) {
      failed.push({ id: doc.id, title: doc.title, error: String((e as Error)?.message ?? e) });
    }
  }
  return { succeeded, failed };
}

export type ObsidianExportResult =
  | { mode: "vault"; fileName: string }
  | { mode: "uri"; fallbackError?: string }
  | { mode: "clipboard"; charCount: number; fallbackError?: string };

export async function exportToObsidian(
  doc: Document,
  cfg: ObsidianConfig,
): Promise<ObsidianExportResult> {
  if (!cfg.vaultName) {
    throw new Error("Vault name not configured");
  }

  // 直写分支：配置了 vaultPath 就全部走直写（spec §4.5 决策 1）
  let fallbackError: string | undefined;
  if (cfg.vaultPath) {
    try {
      const { fileName } = await exportNoteViaApi(cfg.vaultPath, doc.title, doc.body);
      window.open(buildObsidianOpenUri(cfg.vaultName, fileName), "_self");
      return { mode: "vault", fileName };
    } catch (e) {
      // 直写失败回退现有 URI / 剪贴板逻辑（spec 异常 1）
      fallbackError = String((e as Error)?.message ?? e);
    }
  }

  const uri = buildObsidianUri(doc, cfg);

  if (uri.length > OBSIDIAN_URI_SAFE_LIMIT) {
    const ok = await copyText(doc.body);
    if (!ok) throw new Error("Copy to clipboard failed");
    return { mode: "clipboard", charCount: doc.body.length, fallbackError };
  }

  window.open(uri, "_self");
  return { mode: "uri", fallbackError };
}
