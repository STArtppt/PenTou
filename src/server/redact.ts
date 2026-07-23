/**
 * redact.ts — 密钥脱敏纯函数规则引擎（spec ingest-gateway US-06 / §4.5 决策 6）。
 *
 * 小而准的内置规则集：每条规则要求前缀特征 + 长度下限，宁可漏报不可误伤。
 * 命中片段替换为 `[REDACTED:<rule>]`；自定义规则列表本期不做（config.json 留扩展位）。
 */

export interface RedactRule {
  name: string;
  pattern: RegExp;
}

export const BUILTIN_REDACT_RULES: RedactRule[] = [
  // PEM 私钥块（整块替换；先于其余规则，避免块内容被逐段误计）
  {
    name: "private-key",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  // Authorization: Bearer 头（值 ≥16 位；先于 sk-key，Bearer sk-xxx 只计一次）
  {
    name: "bearer-auth",
    pattern: /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  },
  // OpenAI / Anthropic 风格 key（sk-…，含 sk-proj- / sk-ant- 等变体）
  {
    name: "sk-key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  // AWS Access Key ID
  {
    name: "aws-access-key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  // GitHub token（classic ghp_/gho_/ghu_/ghs_/ghr_ 与 fine-grained github_pat_）
  {
    name: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
  },
];

export interface RedactResult {
  text: string;
  /** 命中替换的总次数。 */
  count: number;
}

/** 对文本应用全部内置规则；无命中时返回原字符串（逐字节不变，US-06 AC3）。 */
export function redactText(text: string): RedactResult {
  let count = 0;
  let out = text;
  for (const rule of BUILTIN_REDACT_RULES) {
    out = out.replace(rule.pattern, () => {
      count += 1;
      return `[REDACTED:${rule.name}]`;
    });
  }
  return { text: out, count };
}
