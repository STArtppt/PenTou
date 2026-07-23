import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../config.js";
import type { CollectorAdapter, IngestItem, SessionFile } from "../types.js";
import { walkFiles } from "./walk.js";

const EXTERNAL_KEYS = ["sessionId", "session_id", "conversationId", "conversation_id", "id"];

function waylogRoot(input: string): string {
  const resolved = resolveUserPath(input);
  return path.basename(resolved) === ".waylog" ? resolved : path.join(resolved, ".waylog");
}

export function extractWaylogExternalId(markdown: string): string | undefined {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  const meta = match[1];
  for (const key of EXTERNAL_KEYS) {
    const line = meta.split(/\r?\n/).find((candidate) => candidate.match(new RegExp(`^${key}:\\s*`)));
    if (!line) continue;
    let value = line.slice(line.indexOf(":") + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value || undefined;
  }
  return undefined;
}

export function createWaylogAdapter(dirs: string[]): CollectorAdapter {
  const roots = dirs.map(waylogRoot);
  return {
    platform: "waylog",
    async discover() {
      const files: SessionFile[] = [];
      for (const root of roots) {
        const found = await walkFiles(root, (name) => name.endsWith(".md"));
        files.push(...found.map((file) => ({ path: file, platform: "waylog" })));
      }
      return files.sort((a, b) => a.path.localeCompare(b.path));
    },
    watchRoots() {
      return roots;
    },
    async toItem(file: string): Promise<IngestItem | null> {
      if (!file.endsWith(".md")) return null;
      const data = await fs.readFile(file, "utf-8");
      return {
        platform: "waylog",
        externalId: extractWaylogExternalId(data),
        format: "raw",
        data,
        filename: path.basename(file),
      };
    },
  };
}
