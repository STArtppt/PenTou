import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sidebar = readFileSync("src/app/components/Sidebar.tsx", "utf8");

describe("sidebar list UX (spec sidebar-list-ux)", () => {
  it("defaults folder open state to collapsed (?? false)", () => {
    // All folder-open reads should default to false; no residual ?? true for open maps.
    const openDefaultTrue = sidebar.match(/\?\? true/g) ?? [];
    expect(openDefaultTrue).toHaveLength(0);

    expect(sidebar).toContain("chatFolderOpen[c.folderId] ?? false");
    expect(sidebar).toContain("docFolderOpen[d.folderId] ?? false");
    expect(sidebar).toContain("chatFolderOpen[folder.id] ?? false");
    expect(sidebar).toContain("folderOpen[folder.id] ?? false");
    expect(sidebar).toContain("docFolderOpen[folder.id] ?? false");
    expect(sidebar).toContain("!(prev[folder.id] ?? false)");
    expect(sidebar).toContain("!(prev[id] ?? false)");
  });

  it("makes section headers sticky flush to scrollport (no vertical padding gap)", () => {
    const stickyHeaders = sidebar.match(/sticky top-0 z-10/g) ?? [];
    // chat folders + chat uncategorized + doc folders + doc uncategorized
    expect(stickyHeaders.length).toBeGreaterThanOrEqual(4);

    expect(sidebar).toContain("bg-[#FAFAFA]");
    expect(sidebar).toContain("dark:bg-[#151515]");

    // Scrollport: horizontal + bottom pad only — top pad would open a gap under sticky
    expect(sidebar).toMatch(
      /overflow-y-auto overflow-x-hidden px-2 pb-2 custom-scrollbar subtle-scrollbar/,
    );
    expect(sidebar).not.toMatch(
      /overflow-y-auto overflow-x-hidden p-2 custom-scrollbar subtle-scrollbar/,
    );

    // Sticky rows bleed into horizontal inset so content cannot show in side gutters
    const foldersSticky = sidebar.indexOf(
      "sticky top-0 z-10 -mx-2 flex items-center justify-between gap-2 bg-[#FAFAFA]",
    );
    const uncategorizedSticky = sidebar.indexOf(
      "sticky top-0 z-10 -mx-2 bg-[#FAFAFA]",
    );
    expect(foldersSticky).toBeGreaterThan(-1);
    expect(uncategorizedSticky).toBeGreaterThan(-1);
  });
});
