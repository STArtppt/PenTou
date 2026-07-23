import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 回归：ai-sidebar 打开时「问问 AI」选中态不得叠 ghost+手写 primary，
// 否则 hover:bg-accent 与 hover:bg-primary 冲突，hover 近底色。
describe("Ask AI active toggle styling", () => {
  it("ToolButton uses primary variant when active", () => {
    const src = readFileSync("src/app/components/TopToolbar.tsx", "utf8");
    expect(src).toContain('variant={active ? "primary" : "ghost"}');
    expect(src).not.toMatch(/active && "bg-primary text-primary-foreground hover:bg-primary\/90"/);
  });

  it("ChatBody ask-ai toggle uses primary when sidebar open", () => {
    const src = readFileSync("src/app/components/ChatBody.tsx", "utf8");
    expect(src).toContain('variant={aiSidebarOpen ? "primary" : "ghost"}');
  });
});
