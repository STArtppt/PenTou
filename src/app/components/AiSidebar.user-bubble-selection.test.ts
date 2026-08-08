import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// AI 侧栏用户气泡为反色底（亮：bg-zinc-950 / 暗：bg-zinc-100）。
// App 根 selection:bg-foreground/* 生成的后代 ::selection 与气泡规则同优先级、源序更后，
// 普通 selection: 覆盖会被盖掉 → 亮色模式框选仍全黑。必须用 !important。
describe("AI chat user bubble text selection contrast", () => {
  it("forces inverted selection with ! so it beats App root selection styles", () => {
    const src = readFileSync("src/app/components/AiSidebar.tsx", "utf8");
    expect(src).toContain("bg-zinc-950");
    expect(src).toContain("selection:!bg-white/40");
    expect(src).toContain("selection:!text-white");
    expect(src).toContain("dark:selection:!bg-zinc-950/30");
    expect(src).toContain("dark:selection:!text-zinc-950");
  });
});
