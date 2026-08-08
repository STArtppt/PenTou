import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 回归：执行失败（校验/过期等零改动）须显示「执行失败」+ 详情，不得伪装「尚未执行」，不得有重试。
describe("PlanRunBanner failed status", () => {
  const src = readFileSync("src/app/components/PlanRunBanner.tsx", "utf8");

  it("renders a dedicated failed label and details action", () => {
    expect(src).toContain('run?.status === "failed"');
    expect(src).toContain("planRun.failedLabel");
    expect(src).toContain("planRun.actionDetails");
    expect(src).toContain("planRun.detailsTitleFailed");
  });

  it("does not offer run or retry when status is partial or failed", () => {
    // 仅 !run 时渲染「执行」；problem（partial|failed）只给详情
    expect(src).toContain("!run ?");
    expect(src).toContain("problem ?");
    expect(src).not.toContain("actionRetry");
    expect(src).not.toContain("onRetry");
    // 注释里可以提到「不给重试」，但 UI 不得出现重试动作文案 key / 按钮
    expect(src).not.toMatch(/t\(["']planRun\.actionRetry/);
  });
});
