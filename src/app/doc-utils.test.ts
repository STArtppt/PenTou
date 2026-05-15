import { describe, expect, it } from "vitest";
import {
  buildExcerptSections,
  getNextExcerptNumber,
  hasExcerptedMessage,
  hasExcerptSection,
  mergeRewriteWithExistingBody,
  normalizeHeadings,
} from "./doc-utils";

describe("normalizeHeadings", () => {
  it("shifts H1-based messages down by two levels and clamps at H6", () => {
    expect(normalizeHeadings("# A\n\n## B\n\n### C\n\n##### E")).toBe("### A\n\n#### B\n\n##### C\n\n###### E");
  });

  it("shifts H2-based messages down by one level", () => {
    expect(normalizeHeadings("## B\n\n### C\n\n###### F")).toBe("### B\n\n#### C\n\n###### F");
  });

  it("keeps H3-or-lower messages unchanged", () => {
    const body = "### C\n\n#### D\n\nbody";
    expect(normalizeHeadings(body)).toBe(body);
  });

  it("keeps messages without headings unchanged", () => {
    const body = "plain\n\n- list\n\nnot # heading";
    expect(normalizeHeadings(body)).toBe(body);
  });

  it("does not shift headings inside fenced code blocks", () => {
    const body = ["# A", "", "```md", "# code", "## code", "```", "", "## B"].join("\n");
    expect(normalizeHeadings(body)).toBe(["### A", "", "```md", "# code", "## code", "```", "", "#### B"].join("\n"));
  });
});

describe("buildExcerptSections", () => {
  it("renders one H2 block per user or assistant message", () => {
    expect(
      buildExcerptSections([
        { role: "user", content: "# Question" },
        { role: "ai", content: "## Answer" },
      ]),
    ).toBe("## 原文摘录 #1 user\n\n### Question\n\n## 原文摘录 #2 assistant\n\n### Answer");
  });

  it("skips non-chat roles without consuming sequence numbers", () => {
    expect(
      buildExcerptSections([
        { role: "system", content: "hidden" },
        { role: "tool", content: "hidden" },
        { role: "assistant", content: "visible" },
      ]),
    ).toBe("## 原文摘录 #1 assistant\n\nvisible");
  });

  it("returns an empty string for empty input", () => {
    expect(buildExcerptSections([])).toBe("");
  });

  it("can render a single clicked message with the next excerpt number and an invisible message marker", () => {
    expect(
      buildExcerptSections(
        [{ id: "msg-2", role: "user", content: "only this message" }],
        { startIndex: 3, includeMessageMarkers: true },
      ),
    ).toBe("## 原文摘录 #3 user\n\n<!-- pentou:excerpt-message-id=msg-2 -->\n\nonly this message");
  });
});

describe("hasExcerptSection", () => {
  it("matches numbered excerpt H2 headings with flexible spaces", () => {
    expect(hasExcerptSection("body\n\n##   原文摘录   #12 assistant")).toBe(true);
  });

  it("does not match unnumbered excerpt headings", () => {
    expect(hasExcerptSection("## 原文摘录")).toBe(false);
  });

  it("does not match unrelated content", () => {
    expect(hasExcerptSection("## Other")).toBe(false);
  });
});

describe("message-level excerpt helpers", () => {
  it("detects whether a specific message has already been excerpted", () => {
    const body = "## 原文摘录 #1 user\n\n<!-- pentou:excerpt-message-id=msg-1 -->\n\nbody";
    expect(hasExcerptedMessage(body, "msg-1")).toBe(true);
    expect(hasExcerptedMessage(body, "msg-2")).toBe(false);
  });

  it("calculates the next excerpt number from existing headings", () => {
    expect(getNextExcerptNumber("intro\n\n## 原文摘录 #1 user\n\nA\n\n## 原文摘录 #4 assistant\n\nB")).toBe(5);
    expect(getNextExcerptNumber("intro")).toBe(1);
  });
});

describe("mergeRewriteWithExistingBody", () => {
  it("keeps excerpt sections at the end when replacing rewritten content", () => {
    const existing = "old rewrite\n\n## 原文摘录 #1 user\n\nraw";
    expect(mergeRewriteWithExistingBody(existing, "# New")).toBe("# New\n\n## 原文摘录 #1 user\n\nraw");
  });
});
