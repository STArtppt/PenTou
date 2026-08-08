import { describe, expect, it } from "vitest";
import { isImeComposing } from "./ime";

describe("isImeComposing", () => {
  it("认出标准 isComposing（Chrome/Firefox/Edge 的组合期 keydown）", () => {
    expect(isImeComposing({ nativeEvent: { isComposing: true, keyCode: 13 } })).toBe(true);
  });

  it("认出 keyCode 229 哨兵（Safari/WebKit 与部分安卓输入法只给这个）", () => {
    expect(isImeComposing({ nativeEvent: { isComposing: false, keyCode: 229 } })).toBe(true);
  });

  it("合成事件层与原生事件层任一命中即算组合期", () => {
    // React 合成事件透传 keyCode 但不透传 isComposing，两层都得查。
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
    expect(isImeComposing({ isComposing: true })).toBe(true);
  });

  it("普通回车不算组合期，照常触发提交", () => {
    expect(isImeComposing({ nativeEvent: { isComposing: false, keyCode: 13 } })).toBe(false);
    expect(isImeComposing({ key: "Enter" } as never)).toBe(false);
  });
});
