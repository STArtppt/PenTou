import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("ai-sidebar-layout contracts", () => {
  it("App docks AI leftmost when side=left, right of main when side=right", () => {
    const app = read("src/app/App.tsx");
    // left 在 Sidebar 之前渲染 → 最左
    const leftIdx = app.indexOf('aiSidebarSide === "left"');
    const sidebarIdx = app.indexOf("<Sidebar />");
    const rightIdx = app.indexOf('aiSidebarSide === "right"');
    const mainIdx = app.indexOf("<MainContent />");
    expect(leftIdx).toBeGreaterThan(-1);
    expect(leftIdx).toBeLessThan(sidebarIdx);
    expect(mainIdx).toBeGreaterThan(sidebarIdx);
    expect(rightIdx).toBeGreaterThan(mainIdx);
    expect(app).toContain("isMobile && <AiSidebar");
    expect(app).not.toContain("aiSidebarEverOpened");
  });

  it("AiSidebar shell supports side dock, inert, side switch, and collapsed FAB", () => {
    const ai = read("src/app/components/AiSidebar.tsx");
    expect(ai).toContain("setAiSidebarSide");
    expect(ai).toContain("aiSidebar.dockLeft");
    expect(ai).toContain("aiSidebar.dockRight");
    expect(ai).toContain("inert");
    expect(ai).not.toContain("tabIndex={-1}");
    expect(ai).toContain('dockLeft ? "border-r" : "border-l"');
    expect(ai).toContain("AskAiFab");
    expect(ai).toContain("!aiSidebarOpen && <AskAiFab");
  });

  it("Ask AI entry is corner FAB by dock side, not top bar", () => {
    const fab = read("src/app/components/AskAiToggleButton.tsx");
    expect(fab).toContain("AskAiFab");
    expect(fab).toContain("createPortal");
    expect(fab).toContain("icon-AIspace.svg");
    expect(fab).toContain("bottom-[calc(1rem+env(safe-area-inset-bottom)+4rem)]");
    expect(fab).toContain('side === "left" ? "left-4" : "right-4"');
  });

  it("TopToolbar actions are icon-only (size=icon, no label children in ToolButton)", () => {
    const toolbar = read("src/app/components/TopToolbar.tsx");
    expect(toolbar).toContain('size="icon"');
    expect(toolbar).toContain("IconTooltip");
    expect(toolbar).not.toMatch(/<Icon[^/]*\/>\s*\{label\}/);
  });

  it("ChipBar lives inside input container; shortcut tip above ContextPill", () => {
    const ai = read("src/app/components/AiSidebar.tsx");
    const chipIdx = ai.indexOf("<ChipBar");
    const textareaIdx = ai.indexOf("<textarea");
    const contextIdx = ai.indexOf("<ContextPill");
    const tipIdx = ai.indexOf("aiSidebar.shortcutTip");
    expect(chipIdx).toBeGreaterThan(textareaIdx);
    expect(tipIdx).toBeGreaterThan(-1);
    expect(tipIdx).toBeLessThan(contextIdx);
    expect(ai).toContain("flex-nowrap");
    expect(ai).toContain("overflow-x-auto");
    expect(ai).toContain("armedPromptKey");
    expect(ai).toContain("requiresInput");
  });

  it("data persists side/open only when not mobile", () => {
    const data = read("src/app/data.tsx");
    expect(data).toContain("writeAiSidebarOpen");
    expect(data).toContain("writeAiSidebarSide");
    expect(data).toContain("isMobileRef.current");
    expect(data).toContain("aiSidebarSide");
  });
});
