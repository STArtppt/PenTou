import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sidebar = readFileSync("src/app/components/Sidebar.tsx", "utf8");

describe("conversation project UI (spec conversation-projects)", () => {
  it("renders ProjectSwitcher outside the scroll container for both views", () => {
    expect(sidebar).toContain("<ProjectSwitcher />");
    expect(sidebar).not.toContain('{activeView === "doc" && <ProjectSwitcher />}');
  });

  it("filters conversation folders and uncategorized by the conversation-view project", () => {
    expect(sidebar).toContain("filterFoldersByProject(folders, activeConversationProjectId)");
    expect(sidebar).toContain("filterByProject(conversations, activeConversationProjectId)");
    expect(sidebar).toContain("uncategorizedInProject(filteredConversations, folders, activeConversationProjectId)");
  });

  it("builds conversation move targets from conversation folders, not document folders", () => {
    expect(sidebar).toContain("function useConversationMoveGroups");
    expect(sidebar).toMatch(/buildMoveTargetGroups\(\{\s*folders,/);
    expect(sidebar).toContain("const moveGroups = useConversationMoveGroups()");
    expect(sidebar).not.toContain('key: "chat"');
  });

  it("updates projectId together with folderId on conversation moves", () => {
    expect(sidebar).toContain("moveConversation(id, folderId, projectId)");
    expect(sidebar).toContain("moveConversation(conversation.id, folderId, projectId)");
  });
});
