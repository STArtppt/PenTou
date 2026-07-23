// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrandIcon, BRAND_ICON_URLS } from "./BrandIcon";
import { DEFAULT_AI_PRODUCTS } from "../../shared/ai-products";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("BrandIcon", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (platform: string) => {
    act(() => {
      root.render(<BrandIcon platform={platform} size={18} />);
    });
  };

  // 注：jsdom(cssstyle) 不支持 mask-image，内联样式写入被丢弃，
  // 无法从 DOM 断言 mask URL；改为断言映射表 URL 非空 + 品牌元素渲染。
  it("已映射平台渲染品牌 mask 元素", () => {
    for (const platform of Object.keys(BRAND_ICON_URLS)) {
      render(platform);
      const el = container.querySelector<HTMLElement>(`[data-brand-icon="${platform}"]`);
      expect(el, platform).not.toBeNull();
      expect(container.querySelector("svg"), platform).toBeNull();
    }
  });

  it("映射表覆盖预期平台且 URL 非空", () => {
    expect(Object.keys(BRAND_ICON_URLS).sort()).toEqual(
      ["ChatGPT", "Claude", "Codex", "Copilot", "Cursor", "DeepSeek", "Doubao", "Gemini", "Grok", "Hermes", "Metaso", "Qianwen", "Qwen"],
    );
    for (const [platform, url] of Object.entries(BRAND_ICON_URLS)) {
      // 构建产物可能是文件路径或内联 data URI（Vite assetsInlineLimit）
      expect(url, platform).toMatch(/\.svg$|^data:image\/svg\+xml/);
    }
  });

  // 品牌图标清单与默认 AI 产品清单同源（spec import-auto-classify §4.3 防漂移）
  it("与 DEFAULT_AI_PRODUCTS 清单一致（标准名与 alias 均有图标）", () => {
    const productKeys = DEFAULT_AI_PRODUCTS.flatMap((p) => [p.name, ...(p.aliases ?? [])]);
    expect(productKeys.sort()).toEqual(Object.keys(BRAND_ICON_URLS).sort());
  });

  it("CLI 渲染 Terminal 图标", () => {
    render("CLI");
    expect(container.querySelector("svg.lucide-terminal")).not.toBeNull();
    expect(container.querySelector("[data-brand-icon]")).toBeNull();
  });

  it("未知平台兜底 Bot 且不抛错", () => {
    render("Foo");
    expect(container.querySelector("svg.lucide-bot")).not.toBeNull();
    expect(container.querySelector("[data-brand-icon]")).toBeNull();
  });
});
