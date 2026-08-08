// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MermaidBlock } from "./MermaidBlock";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  theme: "light" as "light" | "dark",
  copyText: vi.fn().mockResolvedValue(true),
  renderMermaid: vi.fn().mockResolvedValue({ svg: "<svg><text>A</text></svg>" }),
}));

vi.mock("../data", () => ({
  useAppContext: () => ({ theme: mocks.theme, language: "en" }),
}));

vi.mock("../utils/clipboard", () => ({
  copyText: mocks.copyText,
}));

vi.mock("../utils/mermaid", () => ({
  renderMermaid: mocks.renderMermaid,
}));

async function renderBlock(source = "flowchart TD\nA-->B") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  await act(async () => {
    root = createRoot(container);
    root.render(<MermaidBlock source={source} />);
  });

  await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function renderInto(container: HTMLElement, source = "flowchart TD\nA-->B") {
  // createRoot 在 act 外调用，TS 能证明 root 已赋值；render 仍包在 act 内
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<MermaidBlock source={source} />);
  });
  await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
  return root;
}

async function waitFor(assertion: () => void) {
  const started = Date.now();
  let lastError: unknown;

  while (Date.now() - started < 1000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }
  }

  throw lastError;
}

describe("MermaidBlock", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mocks.theme = "light";
    mocks.copyText.mockClear();
    mocks.renderMermaid.mockReset();
    mocks.renderMermaid.mockResolvedValue({ svg: "<svg><text>A</text></svg>" });
  });

  it("renders a mermaid preview and can switch to source", async () => {
    const { container, unmount } = await renderBlock();

    expect(mocks.renderMermaid).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), "flowchart TD\nA-->B", "default");
    expect(container.querySelector(".mermaid-svg")?.innerHTML).toContain("<svg");

    await act(async () => {
      (container.querySelector('button[title="Show source"], button[aria-label="Show source"]') as HTMLButtonElement).click();
    });

    expect(container.querySelector("pre")?.textContent).toContain("flowchart TD");

    await act(async () => {
      (container.querySelector("button:nth-of-type(2)") as HTMLButtonElement).click();
    });

    expect(mocks.copyText).toHaveBeenCalledWith("flowchart TD\nA-->B");
    unmount();
  });

  it("falls back to source when render fails", async () => {
    mocks.renderMermaid.mockRejectedValueOnce(new Error("Parse failed"));

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;

    await act(async () => {
      root = createRoot(container);
      root.render(<MermaidBlock source="flowchart\nA -->" />);
    });

    await waitFor(() => expect(container.textContent).toContain("Mermaid rendering failed"));
    expect(container.querySelector("pre")?.textContent).toContain("flowchart");

    act(() => root.unmount());
    container.remove();
  });

  it("opens and closes the fullscreen modal", async () => {
    const { container, unmount } = await renderBlock();

    await act(async () => {
      (container.querySelector('[aria-label="Fullscreen"] button, button[title="Fullscreen"], button[aria-label="Fullscreen"]') as HTMLButtonElement).click();
    });

    expect(document.querySelector('[aria-label="Close"] button, button[title="Close"], button[aria-label="Close"]')).not.toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Close"] button, button[title="Close"], button[aria-label="Close"]')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Close"] button, button[title="Close"], button[aria-label="Close"]')).toBeNull();
    unmount();
  });

  it("clicking mask closes fullscreen; clicking diagram does not", async () => {
    const { container, unmount } = await renderBlock();

    await act(async () => {
      (container.querySelector('[aria-label="Fullscreen"] button, button[title="Fullscreen"], button[aria-label="Fullscreen"]') as HTMLButtonElement).click();
    });

    await waitFor(() => {
      expect(document.querySelector('[data-testid="mermaid-fullscreen-mask"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="mermaid-fullscreen-surface"]')).not.toBeNull();
    });

    const mask = document.querySelector('[data-testid="mermaid-fullscreen-mask"]') as HTMLElement;
    const surface = document.querySelector('[data-testid="mermaid-fullscreen-surface"]') as HTMLElement;

    await act(async () => {
      surface.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector('[aria-label="Close"] button, button[title="Close"], button[aria-label="Close"]')).not.toBeNull();

    await act(async () => {
      mask.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector('[aria-label="Close"] button, button[title="Close"], button[aria-label="Close"]')).toBeNull();
    unmount();
  });

  it("gives fullscreen mermaid a light surface in light mode (edge contrast vs dark lightbox)", async () => {
    const { container, unmount } = await renderBlock();

    await act(async () => {
      (container.querySelector('[aria-label="Fullscreen"] button, button[title="Fullscreen"], button[aria-label="Fullscreen"]') as HTMLButtonElement).click();
    });

    await waitFor(() => expect(document.querySelector('[data-testid="mermaid-fullscreen-surface"]')).not.toBeNull());
    const surface = document.querySelector('[data-testid="mermaid-fullscreen-surface"]');
    expect(surface?.className).toMatch(/\bbg-white\b/);
    expect(surface?.className).not.toMatch(/bg-\[#151515\]/);
    unmount();
  });

  it("gives fullscreen mermaid a dark surface in dark mode", async () => {
    mocks.theme = "dark";
    const { container, unmount } = await renderBlock();

    await act(async () => {
      (container.querySelector('[aria-label="Fullscreen"] button, button[title="Fullscreen"], button[aria-label="Fullscreen"]') as HTMLButtonElement).click();
    });

    await waitFor(() => expect(document.querySelector('[data-testid="mermaid-fullscreen-surface"]')).not.toBeNull());
    const surface = document.querySelector('[data-testid="mermaid-fullscreen-surface"]');
    expect(surface?.className).toMatch(/bg-\[#151515\]/);
    unmount();
  });

  it("registers fullscreen wheel zoom as a non-passive listener", async () => {
    const addEventListenerSpy = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const { container, unmount } = await renderBlock();

    await act(async () => {
      (container.querySelector('[aria-label="Fullscreen"] button, button[title="Fullscreen"], button[aria-label="Fullscreen"]') as HTMLButtonElement).click();
    });

    // 迁 @startist/lightbox 后 Popup 内容经 Base UI Portal 异步挂载，wheel 监听在其后注册。
    await waitFor(() =>
      expect(addEventListenerSpy).toHaveBeenCalledWith("wheel", expect.any(Function), expect.objectContaining({ passive: false })),
    );

    addEventListenerSpy.mockRestore();
    unmount();
  });

  it("re-renders with the dark mermaid theme when app theme changes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = await renderInto(container);

    mocks.theme = "dark";
    mocks.renderMermaid.mockResolvedValueOnce({ svg: "<svg><text>Dark</text></svg>" });
    await act(async () => {
      root.render(<MermaidBlock source="flowchart TD\nA-->B" />);
    });

    await waitFor(() => expect(mocks.renderMermaid.mock.calls.at(-1)?.[2]).toBe("dark"));
    act(() => root.unmount());
    container.remove();
  });
});
