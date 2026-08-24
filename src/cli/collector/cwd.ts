/**
 * cwd.ts —— 采集器从会话文件头抽取工作目录。只读前若干行 / 解父目录名，
 * 取不到一律返回 undefined，绝不抛错、绝不做 `-` 编码目录名反解。
 */
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_HEAD_LINES = 40;

/**
 * 只读这么多字节。cwd 一般在首行的会话元信息里，256KB 足够覆盖前 40 行；
 * 整文件读会让每个变更会话被全量读两遍（这里一遍、adapter.toItem 再一遍），
 * 大会话文件下代价可观。
 */
const HEAD_BYTES = 256 * 1024;

function asCwd(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** 读文件头若干字节并切行；被截断时丢掉最后一行（可能是半行 / 半个多字节字符）。 */
async function headLines(file: string): Promise<string[]> {
  const handle = await fs.open(file, "r");
  try {
    const buf = Buffer.allocUnsafe(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    const lines = buf.subarray(0, bytesRead).toString("utf-8").split("\n");
    if (bytesRead === HEAD_BYTES) lines.pop();
    return lines;
  } finally {
    await handle.close();
  }
}

/** 读 JSONL 前若干行，用 pick 取 cwd。解析失败的行跳过。 */
export async function cwdFromJsonlHead(
  file: string,
  pick: (obj: any) => unknown,
  maxLines = DEFAULT_HEAD_LINES,
): Promise<string | undefined> {
  try {
    const lines = await headLines(file);
    const limit = Math.min(lines.length, maxLines);
    for (let i = 0; i < limit; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      try {
        const cwd = asCwd(pick(JSON.parse(line)));
        if (cwd) return cwd;
      } catch {
        continue;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * grok-cli 会话父目录名是 encodeURIComponent(cwd)，URL 编码可逆。
 * 不含 `%` 就不是这种编码（可能是 `-` 编码或普通名），不做猜测。
 */
export function decodeUriCwd(encoded: string): string | undefined {
  if (!encoded.includes("%")) return undefined;
  try {
    return asCwd(decodeURIComponent(encoded));
  } catch {
    return undefined;
  }
}

/** grok-cli 路径：~/.grok/sessions/<url编码cwd>/<uuid>/chat_history.jsonl */
export function grokCliCwdFromFile(file: string): string | undefined {
  try {
    const sessionDir = path.dirname(file);
    return decodeUriCwd(path.basename(path.dirname(sessionDir)));
  } catch {
    return undefined;
  }
}

/**
 * VS Code：workspaceStorage/<hash>/chatSessions/<uuid>.json，同级 workspace.json
 * 里的 `folder` 是 file:// URI。目录 hash 不可逆，这个旁路文件才是唯一可靠来源。
 * 多根工作区写的是 `workspace`（.code-workspace 路径）而非 `folder`，不猜，直接放弃。
 */
export async function vscodeWorkspaceCwd(file: string): Promise<string | undefined> {
  try {
    const storageDir = path.dirname(path.dirname(file));
    const raw = await fs.readFile(path.join(storageDir, "workspace.json"), "utf-8");
    const folder = JSON.parse(raw)?.folder;
    if (typeof folder !== "string" || !folder.startsWith("file://")) return undefined;
    return asCwd(decodeURIComponent(new URL(folder).pathname));
  } catch {
    return undefined;
  }
}

/** waylog：`.waylog` 目录就落在项目里，它的父目录即工作目录。 */
export function waylogCwdFromFile(file: string): string | undefined {
  const parts = path.resolve(file).split(path.sep);
  const idx = parts.lastIndexOf(".waylog");
  if (idx <= 0) return undefined;
  return asCwd(parts.slice(0, idx).join(path.sep));
}
