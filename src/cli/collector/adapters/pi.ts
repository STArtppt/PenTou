import fs from "node:fs/promises";
import path from "node:path";
import { defaultPiRoot, resolveUserPath } from "../config.js";
import type { CollectorAdapter, IngestItem } from "../types.js";
import { walkFiles } from "./walk.js";

/**
 * ~/.pi/agent/sessions/<编码cwd>/<时间戳>_<uuid>.jsonl。
 * 与 claude-code 同为「整文件即载荷」的文件型来源：会话头（时间 / cwd / id）就在首行，
 * 不需要旁路读取，因此不加信封，raw 直接上报交给 pi normalizer。
 *
 * externalId = 文件名里 `_` 之后的会话 UUID；无下划线时退回整个 basename。
 */
export function piExternalId(file: string): string | undefined {
  const base = path.basename(file, ".jsonl");
  const underscore = base.indexOf("_");
  const id = underscore >= 0 ? base.slice(underscore + 1) : base;
  return id.trim() || undefined;
}

export function createPiAdapter(root = defaultPiRoot()): CollectorAdapter {
  const resolvedRoot = resolveUserPath(root);
  return {
    platform: "pi",
    async discover() {
      const files = await walkFiles(resolvedRoot, (name) => name.endsWith(".jsonl"));
      return files
        .map((file) => ({ path: file, platform: "pi" }))
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    watchRoots() {
      return [resolvedRoot];
    },
    async toItem(file: string): Promise<IngestItem | null> {
      if (!file.endsWith(".jsonl")) return null;
      const data = await fs.readFile(file, "utf-8");
      return {
        platform: "pi",
        externalId: piExternalId(file),
        format: "raw",
        data,
        filename: path.basename(file),
      };
    },
  };
}
