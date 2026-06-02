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
});
