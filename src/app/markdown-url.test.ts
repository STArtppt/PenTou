/**
 * 钉住 design D4 标注的最易漏点：不放行 `pentou:` 的话，应用内链接会被 URL 净化直接清空，
 * 表现是「来源清单渲染出来了，但点不动、href 是空的」。
 */
import { describe, expect, it } from "vitest";
import { docUrlTransform } from "./markdown-url";

describe("docUrlTransform", () => {
  it("放行应用内链接协议", () => {
    expect(docUrlTransform("pentou://conversation/conv_abc")).toBe("pentou://conversation/conv_abc");
    expect(docUrlTransform("pentou://document/doc_abc")).toBe("pentou://document/doc_abc");
  });

  it("普通外链行为不变", () => {
    expect(docUrlTransform("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(docUrlTransform("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(docUrlTransform("#anchor")).toBe("#anchor");
  });

  it("仍然拦掉危险协议", () => {
    expect(docUrlTransform("javascript:alert(1)")).toBe("");
    expect(docUrlTransform("vbscript:msgbox(1)")).toBe("");
  });

  it("图片 data URI 仍放行（不回归）", () => {
    expect(docUrlTransform("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(docUrlTransform("data:text/html;base64,AAAA")).toBe("");
  });
});
