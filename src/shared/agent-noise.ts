/**
 * 剥离 CLI / Agent 注入到「用户消息」里的元信息与本地命令痕迹。
 *
 * 典型来源：
 * - Grok CLI 首轮：`<user_info>` / `<git_status>` / `<rules>`（AGENTS.md / user_rules）/ `<system-reminder>`（无 synthetic_reason 的也会混入）
 * - Claude Code / waylog：`<local-command-caveat>`、斜杠命令回显 `> /model`、`> ⎿ …`
 * - Claude JSONL：`<command-name>` / `<local-command-stdout>` 等
 * - Codex：`<dynamic_context>` 外壳 + 可选 `<user_message>` 内层；整段 `# Instructions…` 技能注入
 * - OpenCode：synthetic text part（工具旁白 / 文件倾倒）在 normalizer 层过滤，正文仍可走本清洗
 *
 * 真实用户提问保留；清洗后为空则调用方应丢弃该条消息。
 */

/** 成对出现的 agent 注入 XML 标签（非用户手写正文） */
const AGENT_BLOCK_TAGS = [
  "user_info",
  "git_status",
  "rules",
  "system-reminder",
  "local-command-caveat",
  "local-command-stdout",
  "command-name",
  "command-message",
  "command-args",
  "command-contents",
  "dynamic_context",
] as const;

const AGENT_BLOCK_RE = new RegExp(
  `<(${AGENT_BLOCK_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1>`,
  "gi",
);

/** Codex 等把真实提问包在 <user_message> 内（外层常是 dynamic_context） */
const USER_MESSAGE_WRAP_RE = /<user_message>\s*([\s\S]*?)\s*<\/user_message>/i;

/** Claude Code UI 斜杠命令回显：`> /model`、`> /clear` 等整行 */
const SLASH_COMMAND_LINE_RE = /^>\s*\/[^\n]*\n?/gm;

/** Claude Code UI 命令结果行：`> ⎿ Set model to …` */
const COMMAND_RESULT_LINE_RE = /^>\s*[⎿\u23BF][^\n]*\n?/gm;

/** ANSI CSI 颜色码（waylog 导出里常见） */
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*m/g;

/**
 * Codex / Hermes 把技能/系统指令整段写成 user 角色：
 * `# Instructions (read first)` 开头的不是用户手写。
 */
export function isAgentInstructionDump(content: string): boolean {
  return /^#\s*Instructions\b/i.test((content || "").trim());
}

/**
 * 从用户消息正文中剥离 agent 注入噪声，返回 trim 后的纯用户文本。
 * 若结果为空串，表示本条没有真实用户输入。
 */
export function stripAgentNoise(content: string): string {
  if (!content) return "";
  let text = content;
  text = text.replace(AGENT_BLOCK_RE, "");
  text = text.replace(SLASH_COMMAND_LINE_RE, "");
  text = text.replace(COMMAND_RESULT_LINE_RE, "");
  text = text.replace(ANSI_ESCAPE_RE, "");
  // 去掉因块删除留下的多余空行
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/**
 * 用户消息完整清洗入口：解包 → 剥注入块 → 丢弃纯指令倾倒。
 * OpenCode / Grok / Claude / Codex / Hermes 用户侧优先走这里。
 */
export function cleanUserMessageContent(content: string): string {
  if (!content) return "";
  let text = content;
  const wrapped = USER_MESSAGE_WRAP_RE.exec(text);
  if (wrapped) text = wrapped[1];
  text = stripAgentNoise(text);
  if (isAgentInstructionDump(text)) return "";
  return text;
}
