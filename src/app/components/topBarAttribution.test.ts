import { describe, expect, it } from "vitest";
import { resolveCaptureMethod, resolveDocumentOrigin } from "./topBarAttribution";

describe("resolveCaptureMethod", () => {
  it("maps cli:<slug> to terminal", () => {
    expect(resolveCaptureMethod("cli:claude-code")).toBe("terminal");
    expect(resolveCaptureMethod("cli:codex")).toBe("terminal");
    expect(resolveCaptureMethod("cli:docs")).toBe("terminal");
  });

  it("maps extension to web", () => {
    expect(resolveCaptureMethod("extension")).toBe("web");
  });

  it("maps missing / legacy cli / unknown to manual", () => {
    expect(resolveCaptureMethod(undefined)).toBe("manual");
    expect(resolveCaptureMethod("")).toBe("manual");
    expect(resolveCaptureMethod("cli")).toBe("manual");
    expect(resolveCaptureMethod("cli:")).toBe("manual");
    expect(resolveCaptureMethod("something-else")).toBe("manual");
  });
});

describe("resolveDocumentOrigin", () => {
  it("prefers conversation when sourceConversationId is set", () => {
    expect(
      resolveDocumentOrigin({
        sourceConversationId: "conv_1",
        ingestSource: "cli:docs",
      }),
    ).toBe("conversation");
  });

  it("maps cli:docs only to terminal", () => {
    expect(resolveDocumentOrigin({ ingestSource: "cli:docs" })).toBe("terminal");
    expect(resolveDocumentOrigin({ ingestSource: "cli:claude-code" })).toBe("import");
  });

  it("falls back to import", () => {
    expect(resolveDocumentOrigin({})).toBe("import");
    expect(resolveDocumentOrigin({ importedFrom: "notes.md" } as any)).toBe("import");
    expect(resolveDocumentOrigin({ sourceConversationId: "" })).toBe("import");
  });
});
