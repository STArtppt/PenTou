// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReasoningPanel } from "./ReasoningPanel";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../data", () => ({
  useAppContext: () => ({ language: "zh" }),
}));

vi.mock("./ImageLightbox", () => ({
  MarkdownImage: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt} />,
  imageUrlTransform: (url: string) => url,
}));

vi.mock("./MermaidBlock", () => ({
  MermaidBlock: ({ source }: { source: string }) => <pre>{source}</pre>,
}));

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

function renderPanel(reasoning: Parameters<typeof ReasoningPanel>[0]["reasoning"]) {
  act(() => {
    root.render(<ReasoningPanel reasoning={reasoning} />);
  });
}

describe("ReasoningPanel", () => {
  it("returns null when reasoning is absent", () => {
    renderPanel(undefined);
    expect(container.querySelector('[data-slot="reasoning-panel"]')).toBeNull();
    renderPanel({});
    expect(container.querySelector('[data-slot="reasoning-panel"]')).toBeNull();
  });

  it("defaults to collapsed with fixed title 搜索链、思考链等文本", () => {
    renderPanel({ search: "搜索内容", thinking: "思考内容" });
    const trigger = container.querySelector('[data-slot="collapsible-trigger"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.textContent).toContain("搜索链、思考链等文本");
    const panel = container.querySelector('[data-slot="reasoning-panel"]');
    expect(panel?.className).not.toMatch(/border-border/);
    expect(panel?.className).not.toMatch(/rounded-lg/);
  });

  it("keeps the same fixed title when only one segment is present", () => {
    renderPanel({ search: "only search" });
    const trigger = container.querySelector('[data-slot="collapsible-trigger"]');
    expect(trigger?.textContent).toContain("搜索链、思考链等文本");
  });

  it("expands both sections when opened", () => {
    renderPanel({
      search: "搜索词 unique_search_body",
      thinking: "思考文本 unique_think_body",
    });
    const trigger = container.querySelector('[data-slot="collapsible-trigger"]') as HTMLButtonElement;
    act(() => {
      trigger.click();
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("unique_search_body");
    expect(container.textContent).toContain("unique_think_body");
  });

  it("renders only the present segment section when expanded (title stays fixed)", () => {
    renderPanel({ search: "only search body" });
    const trigger = container.querySelector('[data-slot="collapsible-trigger"]') as HTMLButtonElement;
    expect(trigger.textContent).toContain("搜索链、思考链等文本");
    act(() => {
      trigger.click();
    });
    expect(container.textContent).toContain("only search body");
    const headings = Array.from(container.querySelectorAll("h4")).map((h) => h.textContent);
    expect(headings).toEqual(["搜索链"]);
  });

  it("places the chevron immediately after the title (not right-aligned)", () => {
    const src = readFileSync("src/app/components/ReasoningPanel.tsx", "utf8");
    expect(src).toContain("justify-start");
    expect(src).toContain("inline-flex");
    expect(src).not.toMatch(/TriggerLabel[\s\S]*flex-1/);
  });

  it("renders reference links as muted pills without blue underline style", () => {
    renderPanel({
      search: "**参考资料**\n[资料标题很长会被截断](https://example.com/a) [另一条](https://example.com/b)",
    });
    const trigger = container.querySelector('[data-slot="collapsible-trigger"]') as HTMLButtonElement;
    act(() => {
      trigger.click();
    });
    const links = Array.from(container.querySelectorAll("a[href^='https://example.com']"));
    expect(links.length).toBe(2);
    for (const a of links) {
      expect(a.className).toMatch(/rounded-full/);
      expect(a.className).toMatch(/bg-muted/);
      expect(a.className).toMatch(/truncate/);
      expect(a.className).toMatch(/max-w-/);
      expect(a.className).not.toMatch(/text-blue/);
      expect(a.className).toMatch(/no-underline/);
    }
  });

  it("shows 查看全部 when body overflows max height, toggles to 收起", () => {
    // jsdom 无真实布局：全局 mock scrollHeight，让 useLayoutEffect 测出溢出
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 800;
      },
    });
    try {
      renderPanel({ thinking: "长思考内容\n".repeat(40) });
      const trigger = container.querySelector(
        '[data-slot="collapsible-trigger"]',
      ) as HTMLButtonElement;
      act(() => {
        trigger.click();
      });
      const toggle = container.querySelector(
        '[data-slot="reasoning-expand-toggle"]',
      ) as HTMLButtonElement | null;
      expect(toggle).not.toBeNull();
      expect(toggle!.textContent).toContain("查看全部");
      const body = container.querySelector('[data-slot="reasoning-body"]');
      expect(body?.getAttribute("data-expanded")).toBe("false");
      expect((body as HTMLElement).style.maxHeight).toBe("240px");
      act(() => {
        toggle!.click();
      });
      expect(toggle!.textContent).toContain("收起");
      expect(
        container.querySelector('[data-slot="reasoning-body"]')?.getAttribute("data-expanded"),
      ).toBe("true");
      act(() => {
        toggle!.click();
      });
      expect(toggle!.textContent).toContain("查看全部");
    } finally {
      if (desc) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", desc);
      } else {
        delete (HTMLElement.prototype as any).scrollHeight;
      }
    }
  });

  it("uses registry collapsible for fold; content clamp may use local state", () => {
    const src = readFileSync("src/app/components/ReasoningPanel.tsx", "utf8");
    expect(src).toContain('@/components/ui/collapsible');
    expect(src).toContain("Collapsible");
    expect(src).toContain("CollapsibleTrigger");
    expect(src).toContain("CollapsiblePanel");
    expect(src).toContain("CollapsibleContent");
    // 外层折叠不自造；内容区截断允许 useState
    expect(src).toContain("ClampedBody");
    expect(src).toContain("BODY_MAX_HEIGHT_PX");
  });
});
