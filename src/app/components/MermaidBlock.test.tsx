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
  let root: Root;
  await act(async () => {
    root = createRoot(container);
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
      (container.querySelector('button[title="Show source"]') as HTMLButtonElement).click();
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
      (container.querySelector('button[title="Fullscreen"]') as HTMLButtonElement).click();
    });

    expect(document.querySelector('button[title="Close"]')).not.toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="Close"]')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(document.querySelector('button[title="Close"]')).toBeNull();
    unmount();
  });

  it("registers fullscreen wheel zoom as a non-passive listener", async () => {
    const addEventListenerSpy = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const { container, unmount } = await renderBlock();

    await act(async () => {
      (container.querySelector('button[title="Fullscreen"]') as HTMLButtonElement).click();
    });

    expect(addEventListenerSpy).toHaveBeenCalledWith("wheel", expect.any(Function), expect.objectContaining({ passive: false }));

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
