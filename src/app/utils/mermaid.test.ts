import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMermaidTheme, loadMermaid, renderMermaid, resetMermaidForTests, setMermaidTheme } from "./mermaid";

const mockMermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn().mockResolvedValue({ diagramType: "flowchart", config: {} }),
  render: vi.fn().mockResolvedValue({ svg: "<svg></svg>" }),
}));

vi.mock("mermaid", () => ({
  default: mockMermaid,
}));

describe("mermaid utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMermaidForTests();
  });

  it("loads mermaid once and reuses the same promise", async () => {
    const first = loadMermaid();
    const second = loadMermaid();

    expect(first).toBe(second);
    await expect(first).resolves.toBe(mockMermaid);
    expect(mockMermaid.initialize).toHaveBeenCalledTimes(1);
  });

  it("tracks the requested theme and initializes before render", async () => {
    setMermaidTheme("dark");
    expect(getMermaidTheme()).toBe("dark");

    await renderMermaid("diagram-1", "flowchart TD\nA-->B", "default");

    expect(getMermaidTheme()).toBe("default");
    expect(mockMermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "default", startOnLoad: false }));
    expect(mockMermaid.parse).toHaveBeenCalledWith("flowchart TD\nA-->B");
    expect(mockMermaid.render).toHaveBeenCalledWith("diagram-1", "flowchart TD\nA-->B");
  });
});
