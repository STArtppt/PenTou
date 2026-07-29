import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// spec mobile-responsive §6.1：断点渲染分支与移动端可见性契约的静态守卫。
// 采用与 layout-scroll / bubble-overflow 一致的按文件断言风格，锁定「< md 隐藏桌面 chrome、
// 承接到移动顶栏/FAB/底部抽屉」这些容易在后续重构中被误改的类名开关。

const read = (p: string) => readFileSync(p, "utf8");

describe("mobile responsive layout contract", () => {
  it("ChatBody hides its desktop header and always shows inline actions on mobile", () => {
    const chatBody = read("src/app/components/ChatBody.tsx");
    // 顶栏在 < md 整体隐藏（US-03 AC4）
    expect(chatBody).toContain('px-6 hidden md:flex items-center justify-between');
    // 复制/摘录按钮 < md 常显、>= md 才 hover（I0）
    expect(chatBody).toContain("opacity-100 transition-all md:opacity-0 md:group-hover/header:opacity-100");
    // 右侧 TOC(RightNav) < md 隐藏
    expect(chatBody).toContain('"hidden md:block"');
  });

  it("TopToolbar bar is hidden below md (decision 7)", () => {
    const topToolbar = read("src/app/components/TopToolbar.tsx");
    // content-topbar-attribution：高度与对话顶栏对齐 min-h-14；< md 仍隐藏
    expect(topToolbar).toContain("min-h-14");
    expect(topToolbar).toContain("border-b border-zinc-200");
    expect(topToolbar).toMatch(/hidden[\s\S]*md:flex|md:flex[\s\S]*hidden/);
    expect(topToolbar).toMatch(/\bhidden\b/);
    expect(topToolbar).toContain("md:flex");
  });

  it("MobileTopBar is md:hidden and reads both conversation and document sources", () => {
    const bar = read("src/app/components/MobileTopBar.tsx");
    expect(bar).toContain("md:hidden");
    expect(bar).toContain("activeConversationId");
    expect(bar).toContain("activeDocId");
    expect(bar).toContain("setMobileNavOpen");
    expect(bar).toContain("setDrawerOpen");
  });

  it("Sidebar disables DnD + more-actions on mobile via selection context", () => {
    const sidebar = read("src/app/components/Sidebar.tsx");
    // DnD 源/放置目标在移动端禁用
    expect(sidebar).toContain("const dndDisabled = selectionMode || isMobile;");
    expect(sidebar).toContain("canDrag: () => !selectionMode && !isMobile");
    // 更多操作入口在移动端隐藏
    expect(sidebar).toContain("!selectionMode && !isMobile &&");
    // 移动端选中条目自动收起抽屉
    expect(sidebar).toContain("if (isMobile) setMobileNavOpen(false);");
  });

  it("AiSidebar renders a FAB + full-screen overlay on mobile", () => {
    const ai = read("src/app/components/AiSidebar.tsx");
    expect(ai).toContain("if (isMobile) {");
    // 移动端 Ask AI 改全屏面板（非底部抽屉）：门户 + visualViewport 键盘避让 + 链式滚动阻断
    expect(ai).toContain("createPortal");
    expect(ai).toContain("useVisualViewport");
    expect(ai).toContain("overscroll-contain");
    expect(ai).toContain("env(safe-area-inset-bottom)");
  });

  it("SettingsShell exposes only four tabs on mobile", () => {
    const shell = read("src/app/components/settings/SettingsShell.tsx");
    expect(shell).toContain('const MOBILE_SETTINGS_TAB_IDS: SettingsTabId[] = ["general", "llm", "search", "about"];');
    expect(shell).toContain("<BottomSheet");
  });

  it("ImportDrawer uses a BottomSheet on mobile with read-only MinerU on the doc tab", () => {
    const importDrawer = read("src/app/components/ImportDrawer.tsx");
    expect(importDrawer).toContain("if (isMobile) {");
    expect(importDrawer).toContain("<BottomSheet");
    expect(importDrawer).toContain('t("import.doc.mineruDesktopOnly")');
  });

  it("App remaps overlay state across the 768px boundary and moves toasts on mobile", () => {
    const app = read("src/app/App.tsx");
    expect(app).toContain("const isMobile = useIsMobile();");
    // 统一 top-center（含桌面）：顶部居中天然避开右下 Ask AI FAB（spec §5 I4）
    expect(app).toContain('position="top-center"');
    // 断点映射：跨越时收起所有覆盖层
    expect(app).toContain("}, [isMobile, setAiSidebarOpen, setDrawerOpen, setSettingsOpen, setSearchOpen, setMobileNavOpen]);");
  });

  it("BottomSheet supports swipe-to-close and safe-area avoidance", () => {
    const sheet = read("src/app/components/BottomSheet.tsx");
    expect(sheet).toContain("useDragControls");
    expect(sheet).toContain("onDragEnd");
    expect(sheet).toContain("env(safe-area-inset-bottom)");
    expect(sheet).toContain("md:hidden");
  });
});
