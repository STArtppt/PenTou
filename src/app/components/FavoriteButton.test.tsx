// @vitest-environment jsdom
/**
 * 顶栏收藏按钮（spec content-favorites）。
 *
 * 四处入口共用它，因此这里钉住的是共用契约：两种状态各有正确的可访问名称、
 * 点击把**取反后**的值交给 data 层、切换失败给提示（状态回滚由 data 层负责）。
 */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavoriteButton } from "./FavoriteButton";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn(), info: vi.fn() },
}));

vi.mock("../i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    language: "zh",
  }),
}));

vi.mock("@/components/IconTooltip", () => ({
  IconTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.toastError.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = () => container.querySelector("button")!;

function render(node: React.ReactElement) {
  act(() => root.render(node));
}

describe("收藏按钮", () => {
  it("未收藏时提供「收藏」名称，已收藏时提供「取消收藏」并标记 aria-pressed", () => {
    render(<FavoriteButton favorite={false} onToggle={async () => {}} />);
    expect(button().getAttribute("aria-label")).toBe("favorite.add");
    expect(button().getAttribute("aria-pressed")).toBe("false");

    render(<FavoriteButton favorite onToggle={async () => {}} />);
    expect(button().getAttribute("aria-label")).toBe("favorite.remove");
    expect(button().getAttribute("aria-pressed")).toBe("true");
    // 已收藏＝实心，不只靠颜色区分
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("fill-current");
  });

  it("点击把取反后的值交给 data 层", async () => {
    const onToggle = vi.fn(async () => {});
    render(<FavoriteButton favorite={false} onToggle={onToggle} />);
    await act(async () => button().click());
    expect(onToggle).toHaveBeenCalledWith(true);

    render(<FavoriteButton favorite onToggle={onToggle} />);
    await act(async () => button().click());
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it("禁用时点击不触发任何写入", async () => {
    const onToggle = vi.fn(async () => {});
    render(<FavoriteButton favorite={false} disabled onToggle={onToggle} />);
    expect(button().hasAttribute("disabled")).toBe(true);
    await act(async () => button().click());
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("写入失败时给出提示（状态回滚由 data 层完成）", async () => {
    const onToggle = vi.fn(async () => {
      throw new Error("network down");
    });
    render(<FavoriteButton favorite={false} onToggle={onToggle} />);
    await act(async () => button().click());
    expect(mocks.toastError).toHaveBeenCalledWith("favorite.failed");
  });

  it("移动端形态用 44px 触控尺寸", () => {
    render(<FavoriteButton form="mobile" favorite={false} onToggle={async () => {}} />);
    expect(button().className).toContain("size-11");
  });
});
