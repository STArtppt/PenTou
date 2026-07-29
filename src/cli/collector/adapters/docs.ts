/**
 * docs adapter（spec collector-docs-push §pull 与 watch 复用现有引擎）：
 * 以 kind "files" 接入引擎，从而复用差量快照、批量分包、失败重试与 401/429 处理。
 * 扫描与推导规则全部委托 docs-scan，与 `pentou push docs` 共用同一份实现。
 */
import path from "node:path";
import type { CollectorAdapter, IngestItem, SessionFile } from "../types.js";
import {
  DOCS_PLATFORM,
  type DocsDirEntry,
  discoverDocs,
  entryForFile,
  resolveDocsEntry,
  toDocumentItem,
} from "./docs-scan.js";

export function createDocsAdapter(dirs: DocsDirEntry[]): CollectorAdapter {
  return {
    platform: DOCS_PLATFORM,
    async discover(): Promise<SessionFile[]> {
      return discoverDocs(dirs);
    },
    watchRoots(): string[] {
      return dirs.map((entry) => resolveDocsEntry(entry).root);
    },
    async toItem(file: string): Promise<IngestItem | null> {
      // watch 事件可能落在登记目录之外（父目录递归监听）；找不到归属条目就不上报
      const entry = entryForFile(dirs, path.resolve(file));
      if (!entry) return null;
      return toDocumentItem(file, entry);
    },
  };
}
