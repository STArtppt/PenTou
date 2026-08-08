/**
 * 回归：中文区间单波浪不能被 GFM 吃成删除线；双波浪删除线仍有效。
 * 复现样例来自 conv_rld1bh1（功率因数 0~1 / 0.8~0.85）。
 */
import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { remarkGfm, remarkGfmOptions } from "./markdown-gfm";

function parse(text: string) {
  return unified().use(remarkParse).use(remarkGfm, remarkGfmOptions).parse(text);
}

function deleteTexts(tree: ReturnType<typeof parse>): string[] {
  const out: string[] = [];
  visit(tree, "delete", (node) => {
    visit(node, "text", (t) => {
      out.push(t.value);
    });
  });
  return out;
}

function plainText(tree: ReturnType<typeof parse>): string {
  const parts: string[] = [];
  visit(tree, "text", (node, _i, parent) => {
    if (parent && (parent as { type?: string }).type === "delete") return;
    parts.push(node.value);
  });
  return parts.join("");
}

describe("remarkGfm singleTilde off", () => {
  it("keeps Chinese range tildes as literal text", () => {
    const src =
      "这里的 cosφ 是功率因数（数值在0~1之间），代表有功功率占比。若未标明，一般默认cosφ=0.8~0.85。";
    const tree = parse(src);
    expect(deleteTexts(tree)).toEqual([]);
    expect(plainText(tree)).toContain("0~1");
    expect(plainText(tree)).toContain("0.8~0.85");
  });

  it("still parses double-tilde strikethrough", () => {
    const tree = parse("保留 ~~删除这段~~ 文字");
    expect(deleteTexts(tree)).toEqual(["删除这段"]);
    expect(plainText(tree)).toContain("保留");
    expect(plainText(tree)).toContain("文字");
  });
});
