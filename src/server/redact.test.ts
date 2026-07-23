/**
 * redact.test.ts — 脱敏规则引擎单测（spec ingest-gateway §6.1）。
 * 覆盖：每条内置规则命中 / 不误伤相似正常文本 / 多处命中计数 / 无命中逐字节不变。
 */
import { describe, it, expect } from "vitest";
import { redactText } from "./redact";

describe("redactText builtin rules", () => {
  it("redacts OpenAI/Anthropic style sk- keys", () => {
    const { text, count } = redactText("my key is sk-proj-abcDEF1234567890abcDEF12 ok");
    expect(text).toBe("my key is [REDACTED:sk-key] ok");
    expect(count).toBe(1);
  });

  it("redacts AWS access key ids", () => {
    const { text, count } = redactText("export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    expect(text).toBe("export AWS_ACCESS_KEY_ID=[REDACTED:aws-access-key]");
    expect(count).toBe(1);
  });

  it("redacts GitHub classic and fine-grained tokens", () => {
    const classic = redactText(`token ghp_${"a1B2".repeat(9)} end`);
    expect(classic.text).toBe("token [REDACTED:github-token] end");
    const finegrained = redactText(`token github_pat_${"a1B2_".repeat(6)} end`);
    expect(finegrained.text).toBe("token [REDACTED:github-token] end");
  });

  it("redacts PEM private key blocks as a whole", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\nxyz\n-----END RSA PRIVATE KEY-----";
    const { text, count } = redactText(`before\n${pem}\nafter`);
    expect(text).toBe("before\n[REDACTED:private-key]\nafter");
    expect(count).toBe(1);
  });

  it("redacts Authorization Bearer headers once (not double-counted as sk-key)", () => {
    const { text, count } = redactText("Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(text).toBe("[REDACTED:bearer-auth]");
    expect(count).toBe(1);
  });

  it("does not touch look-alike normal text", () => {
    const samples = [
      "task-1234 is done",              // sk- 前缀嵌在单词里
      "sk-short",                        // 长度不足
      "AKIA123",                         // AWS 长度不足
      "ghp_tooshort",                    // GitHub 长度不足
      "the phrase Bearer of good news",  // 无 Authorization: 前缀
      "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----", // 公钥不脱敏
    ];
    for (const sample of samples) {
      const { text, count } = redactText(sample);
      expect(text).toBe(sample);
      expect(count).toBe(0);
    }
  });

  it("counts multiple hits across rules", () => {
    const input = "a sk-abcdefghijklmnopqrst1234 b AKIAIOSFODNN7EXAMPLE c sk-zyxwvutsrqponmlkjihg9876 d";
    const { text, count } = redactText(input);
    expect(count).toBe(3);
    expect(text).toBe("a [REDACTED:sk-key] b [REDACTED:aws-access-key] c [REDACTED:sk-key] d");
  });

  it("returns input byte-for-byte when nothing matches", () => {
    const input = "普通中文内容 with unicode ✓ and\nnewlines\t tabs";
    expect(redactText(input).text).toBe(input);
  });
});
