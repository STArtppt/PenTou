import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 计划执行失败时消息气泡不得出现「重试」—— 与状态条「详情、无重试」一致。
describe("AI message bubble hides retry for skill runs", () => {
  it("only shows retry when runSkillId is absent", () => {
    const src = readFileSync("src/app/components/AiSidebar.tsx", "utf8");
    // 错误气泡里：重试按钮包在 !runSkillId 判断内（执行类含 run-plan 不显示）
    expect(src).toContain("{!message.runSkillId ? (");
    expect(src).toContain('t("aiSidebar.retry")');
    expect(src).toContain("onClick={onRetry}");
  });
});
