import { describe, expect, it } from "vitest";
import {
  conversationSignature,
  conversationDedupable,
  documentSignature,
  documentDedupable,
  normalizeText,
} from "./dedup";

const u = (content: string) => ({ role: "user" as const, content });
const a = (content: string) => ({ role: "ai" as const, content });

describe("normalizeText", () => {
  it("trims and collapses internal whitespace incl newlines", () => {
    expect(normalizeText("  a\n\n  b   c\t")).toBe("a b c");
    expect(normalizeText(undefined)).toBe("");
  });
});

describe("conversationSignature — fingerprint (U1 anchor)", () => {
  it("stays stable when later turns are appended (the increment-merge case)", () => {
    const base = { platform: "ChatGPT", title: "X", messages: [u("hello"), a("hi")] };
    const grown = {
      platform: "ChatGPT",
      title: "X",
      messages: [u("hello"), a("hi"), u("more"), a("ok")],
    };
    expect(conversationSignature(grown).fingerprint).toBe(
      conversationSignature(base).fingerprint,
    );
  });

  it("single-round conversation merges into its later multi-round re-export", () => {
    const oneRound = { platform: "ChatGPT", title: "X", messages: [u("hello")] };
    const multiRound = {
      platform: "ChatGPT",
      title: "X",
      messages: [u("hello"), a("hi"), u("again"), a("sure")],
    };
    // U1 unchanged → same logical item (no count marking, no 1↔2 collision)
    expect(conversationSignature(oneRound).fingerprint).toBe(
      conversationSignature(multiRound).fingerprint,
    );
  });

  it("distinguishes same title/platform but different opening question", () => {
    const c1 = { platform: "ChatGPT", title: "X", messages: [u("hello")] };
    const c2 = { platform: "ChatGPT", title: "X", messages: [u("totally different")] };
    expect(conversationSignature(c1).fingerprint).not.toBe(
      conversationSignature(c2).fingerprint,
    );
  });

  it("U1 normalization makes whitespace-only differences match", () => {
    const c1 = { platform: "ChatGPT", title: "X", messages: [u("hello world")] };
    const c2 = { platform: "ChatGPT", title: "X", messages: [u("  hello\n  world  ")] };
    expect(conversationSignature(c1).fingerprint).toBe(
      conversationSignature(c2).fingerprint,
    );
  });

  it("different platform → different fingerprint", () => {
    const c1 = { platform: "ChatGPT", title: "X", messages: [u("hello")] };
    const c2 = { platform: "Claude", title: "X", messages: [u("hello")] };
    expect(conversationSignature(c1).fingerprint).not.toBe(
      conversationSignature(c2).fingerprint,
    );
  });
});

describe("conversationSignature — contentHash", () => {
  it("identical content → same contentHash (skip case)", () => {
    const c1 = { platform: "ChatGPT", title: "X", messages: [u("hi"), a("yo")] };
    const c2 = { platform: "ChatGPT", title: "X", messages: [u(" hi "), a("yo")] };
    expect(conversationSignature(c1).contentHash).toBe(
      conversationSignature(c2).contentHash,
    );
  });

  it("appended turns → different contentHash (merge, not skip)", () => {
    const base = { platform: "ChatGPT", title: "X", messages: [u("hi"), a("yo")] };
    const grown = { platform: "ChatGPT", title: "X", messages: [u("hi"), a("yo"), u("more")] };
    expect(conversationSignature(grown).contentHash).not.toBe(
      conversationSignature(base).contentHash,
    );
  });
});

describe("conversationDedupable", () => {
  it("false when both title and U1 are empty", () => {
    expect(conversationDedupable({ platform: "ChatGPT", title: "", messages: [a("only ai")] })).toBe(false);
  });
  it("true when there is a title", () => {
    expect(conversationDedupable({ platform: "ChatGPT", title: "X", messages: [] })).toBe(true);
  });
  it("true when there is a first user message", () => {
    expect(conversationDedupable({ platform: "ChatGPT", title: "", messages: [u("q")] })).toBe(true);
  });
});

describe("documentSignature", () => {
  it("same title + leading body → same fingerprint even if tail changes", () => {
    const d1 = { title: "Report", body: "# Intro\n\nFirst para.\n\nOld tail." };
    const d2 = { title: "Report", body: "# Intro\n\nFirst para.\n\nNew longer tail content." };
    expect(documentSignature(d1).fingerprint).toBe(documentSignature(d2).fingerprint);
  });

  it("different leading body → different fingerprint", () => {
    const d1 = { title: "Report", body: "# Intro\n\nFirst para." };
    const d2 = { title: "Report", body: "# Other\n\nDifferent start." };
    expect(documentSignature(d1).fingerprint).not.toBe(documentSignature(d2).fingerprint);
  });

  it("contentHash differs when body changes", () => {
    const d1 = { title: "Report", body: "# Intro\n\nFirst para.\n\nOld tail." };
    const d2 = { title: "Report", body: "# Intro\n\nFirst para.\n\nNew tail." };
    expect(documentSignature(d1).contentHash).not.toBe(documentSignature(d2).contentHash);
  });
});

describe("documentDedupable", () => {
  it("false when title and body both empty", () => {
    expect(documentDedupable({ title: "", body: "" })).toBe(false);
  });
  it("true when body present", () => {
    expect(documentDedupable({ title: "", body: "content" })).toBe(true);
  });
});
