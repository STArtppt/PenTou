/**
 * source-project.ts —— 对话的来源项目判定（spec conversation-project-attribution）。
 *
 * 判定优先级：会话内容里的工作目录字段 > 会话文件路径中可**无歧义**还原的目录 > 不写入。
 *
 * 明确不做的事：`~/.claude/projects/-Users-x-coding-aicoding-data-shop` 这类目录名把
 * 路径分隔符编码成了 `-`，该编码**不可逆** —— `a-b` 无法区分原本是 `a/b` 还是一个
 * 带连字符的目录名。所以宁可留空也不反解。grok-cli 的 `%2FUsers%2F…` 是 URL 编码，
 * 可无歧义还原，属于第二优先级的合法来源。
 *
 * 取 basename 与文档项目的 sourceKey 同口径，使两个平面日后可按同一标识关联。
 */

/** 从工作目录路径取项目标识（basename）；取不到返回 undefined，绝不抛错。 */
export function sourceProjectFromCwd(cwd: unknown): string | undefined {
  if (typeof cwd !== "string") return undefined;
  const trimmed = cwd.trim();
  if (!trimmed) return undefined;
  const segments = trimmed
    .split(/[/\\]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..");
  const last = segments.at(-1);
  // 盘符（"C:"）与纯根路径不是项目名
  if (!last || /^[a-zA-Z]:$/.test(last)) return undefined;
  return last;
}

/** grok-cli 的会话父目录名是 `encodeURIComponent(cwd)`：URL 编码可逆，可安全还原。 */
export function sourceProjectFromEncodedDir(dirName: unknown): string | undefined {
  if (typeof dirName !== "string" || !dirName.includes("%")) return undefined;
  try {
    return sourceProjectFromCwd(decodeURIComponent(dirName));
  } catch {
    return undefined;
  }
}
