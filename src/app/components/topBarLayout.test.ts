import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 轻量源码契约：顶栏双行布局 + Badge + 去掉来自对话跳转
 * （spec content-topbar-attribution；完整渲染靠手验 / 组件测后续可补）
 */
describe("content topbar attribution layout", () => {
  const chat = readFileSync("src/app/components/ChatBody.tsx", "utf8");
  const toolbar = readFileSync("src/app/components/TopToolbar.tsx", "utf8");

  it("ChatBody uses dual-row min-h-14, text-base title, Badge, and attribution helpers", () => {
    expect(chat).toContain("min-h-14");
    expect(chat).toContain("text-base");
    expect(chat).toContain('from "@/components/ui/badge"');
    expect(chat).toContain("resolveCaptureMethod");
    expect(chat).toContain("sourceProject");
    expect(chat).toContain("capture.web");
  });

  it("TopToolbar uses dual-row layout, document origin Badge, and no jump handler", () => {
    expect(toolbar).toContain("min-h-14");
    expect(toolbar).toContain("text-base");
    expect(toolbar).toContain("resolveDocumentOrigin");
    expect(toolbar).toContain("doc.fromTerminal");
    expect(toolbar).toContain('from "@/components/ui/badge"');
    expect(toolbar).not.toContain("setActiveConversationId");
    // 来源徽章不可点跳转
    expect(toolbar).not.toMatch(/onClick=\{\(\) => \{\s*setActiveConversationId/);
    // 动作仅图标
    expect(toolbar).toContain('size="icon"');
  });
});
