/**
 * cwd.ts —— 采集器从会话文件头抽取工作目录。只读前若干行 / 解父目录名，
 * 取不到一律返回 undefined，绝不抛错、绝不做 `-` 编码目录名反解。
 */
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_HEAD_LINES = 40;

function asCwd(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** 读 JSONL 前若干行，用 pick 取 cwd。解析失败的行跳过。 */
export async function cwdFromJsonlHead(
  file: string,
  pick: (obj: any) => unknown,
  maxLines = DEFAULT_HEAD_LINES,
): Promise<string | undefined> {
  try {
    const text = await fs.readFile(file, "utf-8");
    const lines = text.split("\n");
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
