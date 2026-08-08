/**
 * task-checkbox.ts — GFM 任务项复选框的正文写回（spec interactive-task-checkbox / design D9）。
 *
 * 定位用**原始 Markdown 行号**（react-markdown 给组件的 `node.position.start.line`），
 * 不用「页面上第 N 个 checkbox」去数 —— 嵌套列表下渲染顺序与原文顺序并不总是一致。
 *
 * 改写只翻转该行的标记字符，其余一律不动：文档是用户资产，勾一下不该顺手重排版。
 */

/** 行首任务标记：允许任意缩进与 `-` / `*` / `+` 三种列表符。 */
const TASK_MARKER_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/** 该行是否是一个 GFM 任务项。 */
export function isTaskLine(line: string): boolean {
  return TASK_MARKER_RE.test(line);
}

/**
 * 翻转第 `line` 行（1-based）的复选框状态并返回新正文。
 * 该行不是任务项、或行号越界时**原样返回**，绝不猜测相邻行。
 */
export function toggleTaskLine(body: string, line: number): string {
  if (!Number.isInteger(line) || line < 1) return body;
  const lines = body.split("\n");
  if (line > lines.length) return body;

  const target = lines[line - 1];
  const m = target.match(TASK_MARKER_RE);
  if (!m) return body;

  const next = m[2] === " " ? "x" : " ";
  lines[line - 1] = target.replace(TASK_MARKER_RE, `$1${next}$3`);
  return lines.join("\n");
}
