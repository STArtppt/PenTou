import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 收起态入口改为角上 FAB（Bot 图标），不再挂顶栏/Logo 旁。
describe("Ask AI FAB entry", () => {
  it("AskAiFab portals to body, uses custom AI icon, opens sidebar", () => {
    const src = readFileSync("src/app/components/AskAiToggleButton.tsx", "utf8");
    expect(src).toContain("export function AskAiFab");
    expect(src).toContain("createPortal");
    expect(src).toContain("document.body");
    expect(src).toContain("icon-AIspace.svg");
    expect(src).toContain("z-[60]");
    expect(src).toContain("setAiSidebarOpen(true)");
    expect(src).toContain("IconTooltip");
    expect(src).toContain('side={side === "left" ? "right" : "left"}');
    expect(src).not.toContain("title={label}");
    expect(src).not.toContain('side="top"');
    expect(src).toContain("bottom-[calc(1rem+env(safe-area-inset-bottom)+4rem)]");
    expect(src).toContain('side === "left" ? "left-4" : "right-4"');
  });

  it("TopToolbar and ChatBody do not mount Ask AI in the top bar", () => {
    const toolbar = readFileSync("src/app/components/TopToolbar.tsx", "utf8");
    const chat = readFileSync("src/app/components/ChatBody.tsx", "utf8");
    const sidebar = readFileSync("src/app/components/Sidebar.tsx", "utf8");
    expect(toolbar).not.toContain("AskAiFab");
    expect(toolbar).not.toContain("AskAiToggleButton");
    expect(chat).not.toContain("AskAiFab");
    expect(chat).not.toContain("AskAiToggleButton");
    expect(sidebar).not.toContain("AskAiFab");
    expect(sidebar).not.toContain("AskAiToggleButton");
  });
});
