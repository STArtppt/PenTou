import { describe, expect, it } from "vitest";
import { topBarSourceLabel } from "./topBarSourceLabel";

// 回归：collector-source-expansion 后顶栏出现「品牌名 + 来源标签」双徽章
// （debug 2026-07-21）。合并为单个动态标签：cli 采集显示形态段，否则回退品牌名。
describe("topBarSourceLabel", () => {
  it("cli 采集显示 form-slug 而非品牌名", () => {
    expect(topBarSourceLabel("Grok", "cli:grok-cli")).toBe("grok-cli");
    expect(topBarSourceLabel("Claude", "cli:claude-code")).toBe("claude-code");
  });

  it("无 ingestSource 回退品牌名", () => {
    expect(topBarSourceLabel("ChatGPT", undefined)).toBe("ChatGPT");
  });

  it("旧值 cli / extension 不猜来源，回退品牌名", () => {
    expect(topBarSourceLabel("ChatGPT", "cli")).toBe("ChatGPT");
    expect(topBarSourceLabel("Claude", "extension")).toBe("Claude");
  });

  it("cli: 后为空段时回退品牌名，不显示空标签", () => {
    expect(topBarSourceLabel("Grok", "cli:")).toBe("Grok");
  });
});
