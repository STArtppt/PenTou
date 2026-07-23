import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 回归：src/docs/debugging/2026-07-21-text-selection-low-contrast.md
// 文本选区必须用与背景有对比的高亮，不能用 accent（与 bg / 代码块底几乎同色）。
describe("text selection contrast", () => {
  it("uses foreground-tinted selection instead of accent", () => {
    const app = readFileSync("src/app/App.tsx", "utf8");
    expect(app).toContain("selection:bg-foreground/25");
    expect(app).toContain("selection:text-foreground");
    expect(app).not.toContain("selection:bg-accent");
    expect(app).not.toContain("selection:text-accent-foreground");
  });
});
