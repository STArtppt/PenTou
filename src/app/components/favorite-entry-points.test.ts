/**
 * 收藏入口的落位（spec content-favorites）：对话/文档 × 桌面/移动共四处，
 * 且都经同一个 FavoriteButton —— 任何一处改回手写按钮，这里就会失败。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("收藏入口", () => {
  it("对话顶栏挂在 header 动作区，用会话自身的收藏态", () => {
    const src = read("src/app/components/ChatBody.tsx");
    expect(src).toContain('import { FavoriteButton } from "./FavoriteButton"');
    expect(src).toContain("toggleConversationFavorite(conversation.id, next)");
    expect(src).toContain("favorite={!!conversation.favorite}");
  });

  it("文档顶栏无选中文档时禁用，且排在编辑/历史/导出之前", () => {
    const src = read("src/app/components/TopToolbar.tsx");
    expect(src).toContain('import { FavoriteButton } from "./FavoriteButton"');
    expect(src).toContain("disabled={!activeDocId}");
    expect(src).toContain("toggleDocumentFavorite(activeDocId!, next)");
    expect(src.indexOf("<FavoriteButton")).toBeLessThan(src.indexOf('label={t("toolbar.versionHistory")}'));
  });

  it("移动端顶栏按当前视图分派到会话 / 文档，无选中项时禁用", () => {
    const src = read("src/app/components/MobileTopBar.tsx");
    expect(src).toContain('form="mobile"');
    expect(src).toContain("isDoc ? activeDoc?.favorite : activeConv?.favorite");
    expect(src).toContain("disabled={isDoc ? !activeDoc : !activeConv}");
    expect(src).toContain("toggleDocumentFavorite(activeDoc!.id, next)");
    expect(src).toContain("toggleConversationFavorite(activeConv!.id, next)");
  });

  it("切换走专用端点而非通用 PUT（否则会刷 updatedAt / 建版本）", () => {
    const src = read("src/app/data.tsx");
    expect(src).toContain("/api/conversations/${id}/favorite");
    expect(src).toContain("/api/documents/${id}/favorite");
    // 乐观更新 + 失败回滚
    expect(src).toContain("favorite: !favorite");
  });
});
