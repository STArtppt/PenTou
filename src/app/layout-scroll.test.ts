import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app scroll containment", () => {
  it("keeps scrolling inside app containers instead of the browser viewport", () => {
    const indexHtml = readFileSync("index.html", "utf8");
    const chatBody = readFileSync("src/app/components/ChatBody.tsx", "utf8");
    const docViewer = readFileSync("src/app/components/DocViewer.tsx", "utf8");

    expect(indexHtml).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*hidden/i);
    expect(indexHtml).toMatch(/html,\s*body\s*\{[^}]*overscroll-behavior:\s*none/i);
    expect(indexHtml).toMatch(/#root\s*\{[^}]*overflow:\s*hidden/i);

    expect(chatBody).toContain("overscroll-contain");
    expect(docViewer).toContain("overscroll-contain");
  });

  it("keeps the document table of contents sticky with a persistent divider", () => {
    const docViewer = readFileSync("src/app/components/DocViewer.tsx", "utf8");

    expect(docViewer).toContain("sticky top-6 self-start");
    expect(docViewer).toContain("max-w-[1166px]");
    expect(docViewer).toContain("ml-[30px]");
    expect(docViewer).toContain("w-[240px]");
    expect(docViewer).not.toContain("setTocLeft");
    expect(docViewer).not.toContain("tocLeft");
    expect(docViewer).not.toContain('document.querySelector(".ai-sidebar-shell")');
    expect(docViewer).not.toContain("w-[136px]");
    expect(docViewer).toContain("toc-scrollbar-active");

    const scrollListStart = docViewer.indexOf("rightnav-scrollbar");
    const scrollListEnd = docViewer.indexOf("flex flex-col gap-[2px]", scrollListStart);
    const scrollListMarkup = docViewer.slice(scrollListStart, scrollListEnd);

    expect(scrollListMarkup).not.toContain("bg-zinc-200 dark:bg-white/10 rounded-full");
  });

  it("keeps document table of contents hooks before the empty-heading return", () => {
    const docViewer = readFileSync("src/app/components/DocViewer.tsx", "utf8");
    const cleanupEffect = docViewer.indexOf("if (tocScrollTimer.current) clearTimeout(tocScrollTimer.current);");
    const emptyHeadingsReturn = docViewer.indexOf("if (headings.length === 0) return null;");

    expect(cleanupEffect).toBeGreaterThan(-1);
    expect(emptyHeadingsReturn).toBeGreaterThan(-1);
    expect(cleanupEffect).toBeLessThan(emptyHeadingsReturn);
  });
});
