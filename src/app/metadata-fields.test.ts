import { describe, expect, it } from "vitest";
import {
  conversationMetaFields,
  documentMetaFields,
  splitLeadingFrontmatter,
  technicalDetailFields,
} from "./metadata-fields";

const fmt = (iso: string) => `FMT(${iso})`;

describe("splitLeadingFrontmatter", () => {
  it("parses a normal frontmatter block and strips it from body", () => {
    const raw = [
      "---",
      "source: input/raw/a.md",
      'converted_by: "copy"',
      "source_sha256: abc_def-123",
      "converted-at: 2026-07-31",
      "kind: document",
      "---",
      "# Title",
      "",
      "para",
    ].join("\n");
    const { entries, body } = splitLeadingFrontmatter(raw);
    expect(entries).toEqual([
      ["source", "input/raw/a.md"],
      ["converted_by", "copy"],
      ["source_sha256", "abc_def-123"],
      ["converted-at", "2026-07-31"],
      ["kind", "document"],
    ]);
    expect(body).toBe("# Title\n\npara");
  });

  it("returns null entries when the block is unclosed", () => {
    const raw = "---\nsource: x\n# Title\n";
    const { entries, body } = splitLeadingFrontmatter(raw);
    expect(entries).toBeNull();
    expect(body).toBe(raw);
  });

  it("treats --- followed by a normal paragraph as a real hr (no strip)", () => {
    const raw = "---\n\nJust a horizontal rule and a paragraph.\n";
    const { entries, body } = splitLeadingFrontmatter(raw);
    expect(entries).toBeNull();
    expect(body).toBe(raw);
  });

  it("rejects blocks with non key-value lines", () => {
    const raw = "---\nsource: x\nnot a kv line\n---\n# Title\n";
    const { entries, body } = splitLeadingFrontmatter(raw);
    expect(entries).toBeNull();
    expect(body).toBe(raw);
  });

  it("keeps order and supports underscore / hyphen keys", () => {
    const raw = "---\nsource_sha256: deadbeef\nconverted-at: t\n---\nbody";
    const { entries } = splitLeadingFrontmatter(raw);
    expect(entries?.map(([k]) => k)).toEqual(["source_sha256", "converted-at"]);
  });

  it("strips wrapping double quotes from values", () => {
    const raw = '---\ntitle: "hello \\"world\\""\n---\nx';
    const { entries } = splitLeadingFrontmatter(raw);
    expect(entries?.[0]).toEqual(["title", 'hello "world"']);
  });

  it("allows empty frontmatter block (no keys) as valid strip", () => {
    const raw = "---\n---\n# Hi";
    const { entries, body } = splitLeadingFrontmatter(raw);
    expect(entries).toEqual([]);
    expect(body).toBe("# Hi");
  });
});

describe("conversationMetaFields", () => {
  const base = {
    platform: "Claude" as const,
    ingestSource: "cli:claude-code",
    date: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    folderId: "f4",
    sourceProject: "pentou",
    messageCount: 3,
    messages: [],
  };

  it("maps platform slug, terminal capture, folder name, and omits empty sourceProject", () => {
    const rows = conversationMetaFields(
      { ...base, sourceProject: undefined },
      [{ id: "f4", name: "研究" }],
      { formatDateTime: fmt },
    );
    expect(rows.find((r) => r.key === "platform")?.value).toBe("claude-code");
    expect(rows.find((r) => r.key === "captureMethod")?.value).toBe("terminal");
    expect(rows.find((r) => r.key === "folder")?.value).toBe("研究");
    expect(rows.find((r) => r.key === "sourceProject")).toBeUndefined();
    expect(rows.find((r) => r.key === "messageCount")?.value).toBe("3");
    expect(rows.find((r) => r.key === "sessionTime")?.value).toBe(fmt(base.date));
  });

  it("falls back to raw folder id when not found", () => {
    const rows = conversationMetaFields(base, [], { formatDateTime: fmt });
    expect(rows.find((r) => r.key === "folder")?.value).toBe("f4");
  });

  it("omits folder row when folderId is null", () => {
    const rows = conversationMetaFields(
      { ...base, folderId: null },
      [{ id: "f4", name: "x" }],
      { formatDateTime: fmt },
    );
    expect(rows.find((r) => r.key === "folder")).toBeUndefined();
  });

  it("uses messages.length when messageCount is absent", () => {
    const rows = conversationMetaFields(
      {
        ...base,
        messageCount: undefined,
        messages: [
          { id: "1", role: "user", content: "a", timestamp: "" },
          { id: "2", role: "ai", content: "b", timestamp: "" },
        ],
      },
      [],
      { formatDateTime: fmt },
    );
    expect(rows.find((r) => r.key === "messageCount")?.value).toBe("2");
  });
});

describe("documentMetaFields", () => {
  const base = {
    sourceConversationId: "conv_1",
    ingestSource: undefined as string | undefined,
    projectId: "dp_x",
    folderId: "df_y",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    sourcePlatform: "Claude" as const,
    generatedBy: "agent",
    generatedAt: "2026-01-03T00:00:00.000Z",
    importedFrom: "file.md",
    importedAt: "2026-01-04T00:00:00.000Z",
    aiPlan: '{"steps":[]}',
  };

  it("maps origin, project/folder names, and never emits aiPlan", () => {
    const rows = documentMetaFields(
      base,
      [{ id: "dp_x", name: "笔记" }],
      [{ id: "df_y", name: "指南" }],
      { formatDateTime: fmt, defaultProjectName: "默认目录" },
    );
    expect(rows.find((r) => r.key === "origin")?.value).toBe("conversation");
    expect(rows.find((r) => r.key === "project")?.value).toBe("笔记");
    expect(rows.find((r) => r.key === "folder")?.value).toBe("指南");
    expect(rows.some((r) => r.key === "aiPlan" || r.value.includes("steps"))).toBe(false);
    expect(rows.find((r) => r.key === "generatedBy")?.value).toContain("agent");
    expect(rows.find((r) => r.key === "importedFrom")?.value).toContain("file.md");
  });

  it("falls back to raw project id when not found", () => {
    const rows = documentMetaFields(
      { ...base, projectId: "dp_missing" },
      [],
      [],
      { formatDateTime: fmt, defaultProjectName: "默认目录" },
    );
    expect(rows.find((r) => r.key === "project")?.value).toBe("dp_missing");
  });

  it("shows default project name when projectId is empty", () => {
    const rows = documentMetaFields(
      { ...base, projectId: null, folderId: null },
      [],
      [],
      { formatDateTime: fmt, defaultProjectName: "默认目录" },
    );
    expect(rows.find((r) => r.key === "project")?.value).toBe("默认目录");
    expect(rows.find((r) => r.key === "folder")).toBeUndefined();
  });

  it("resolves terminal origin via cli:docs", () => {
    const rows = documentMetaFields(
      { ...base, sourceConversationId: undefined, ingestSource: "cli:docs" },
      [],
      [],
      { formatDateTime: fmt, defaultProjectName: "默认目录" },
    );
    expect(rows.find((r) => r.key === "origin")?.value).toBe("terminal");
  });
});

describe("technicalDetailFields", () => {
  it("only includes non-empty technical keys", () => {
    expect(
      technicalDetailFields({
        id: "doc_1",
        currentVersionId: "ver_1",
        externalKey: "",
        sourceConversationId: null,
        ingestSource: "cli:docs",
      }),
    ).toEqual([
      { key: "id", value: "doc_1" },
      { key: "currentVersionId", value: "ver_1" },
      { key: "ingestSource", value: "cli:docs" },
    ]);
  });
});
