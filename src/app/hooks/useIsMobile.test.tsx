// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useIsMobile } from "./useIsMobile";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// spec mobile-responsive §6.1：matchMedia 变更时返回值切换、卸载时移除监听。
function mockMatchMedia(initialMatches: boolean) {
  const listeners = new Set<() => void>();
  let matches = initialMatches;
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  (window as any).matchMedia = vi.fn(() => mql);
  return {
    fire(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb());
    },
    listenerCount: () => listeners.size,
  };
}

let latest = false;
function Probe() {
  latest = useIsMobile();
  return null;
}

describe("useIsMobile", () => {
  let container: HTMLElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Probe />));
  }

  it("reflects the initial matchMedia state and reacts to changes", () => {
    const mm = mockMatchMedia(true);
    mount();
    expect(latest).toBe(true);

    act(() => mm.fire(false));
    expect(latest).toBe(false);

    act(() => mm.fire(true));
    expect(latest).toBe(true);
  });

  it("removes the media-query listener on unmount", () => {
    const mm = mockMatchMedia(false);
    mount();
    expect(mm.listenerCount()).toBe(1);

    act(() => root.unmount());
    expect(mm.listenerCount()).toBe(0);

    // 让 afterEach 的二次 unmount 安全：重建一个已挂载实例
    mount();
  });
});
