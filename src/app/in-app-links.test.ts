import { describe, expect, it } from "vitest";
import { buildInAppLink, isInAppHref, parseInAppLink } from "./in-app-links";

describe("buildInAppLink", () => {
  it("两种 kind 各自构造", () => {
    expect(buildInAppLink("conversation", "conv_1720_abc")).toBe("pentou://conversation/conv_1720_abc");
    expect(buildInAppLink("document", "doc_1720_abc")).toBe("pentou://document/doc_1720_abc");
  });

  it("构造与解析互为逆运算", () => {
    expect(parseInAppLink(buildInAppLink("conversation", "c-1"))).toEqual({
      kind: "conversation",
      id: "c-1",
    });
  });
});

describe("parseInAppLink", () => {
  it("解析合法链接", () => {
    expect(parseInAppLink("pentou://conversation/conv_abc")).toEqual({
      kind: "conversation",
      id: "conv_abc",
    });
    expect(parseInAppLink("pentou://document/doc_abc")).toEqual({ kind: "document", id: "doc_abc" });
  });

  it("非 pentou: 协议一律返回 null", () => {
    expect(parseInAppLink("https://example.com/a")).toBeNull();
    expect(parseInAppLink("/api/documents/doc_a")).toBeNull();
    expect(parseInAppLink("javascript:alert(1)")).toBeNull();
  });

  it("未知 kind 返回 null", () => {
    expect(parseInAppLink("pentou://folder/df_1")).toBeNull();
    expect(parseInAppLink("pentou://conversations/conv_a")).toBeNull();
  });

  it("非法 id 返回 null", () => {
    expect(parseInAppLink("pentou://conversation/")).toBeNull();
    expect(parseInAppLink("pentou://conversation/../../etc/passwd")).toBeNull();
    expect(parseInAppLink("pentou://document/doc a")).toBeNull();
  });

  it("非字符串输入不抛错", () => {
    expect(parseInAppLink(undefined)).toBeNull();
    expect(parseInAppLink(null)).toBeNull();
    expect(parseInAppLink(42)).toBeNull();
  });
});

describe("isInAppHref", () => {
  it("协议命中即算应用内链接（含 id 非法的情形）", () => {
    expect(isInAppHref("pentou://conversation/conv_a")).toBe(true);
    // 格式非法也不该按外链在新标签页打开 —— 交给点击处理去提示
    expect(isInAppHref("pentou://folder/df_1")).toBe(true);
    expect(isInAppHref("https://example.com")).toBe(false);
    expect(isInAppHref(undefined)).toBe(false);
  });
});
