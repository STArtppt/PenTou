import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, findAgentTool, toolsForLLM } from "./agent-tools";

describe("agent 工具目录", () => {
  it("规模落在 8–12 个之间（少而精，design D8）", () => {
    expect(AGENT_TOOLS.length).toBeGreaterThanOrEqual(8);
    expect(AGENT_TOOLS.length).toBeLessThanOrEqual(12);
  });

  it("每个工具都有名称、描述与入参 schema，并声明落到哪些既有端点", () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.implementation.length).toBeGreaterThan(0);
      for (const impl of tool.implementation) {
        expect(impl.path.startsWith("/api/")).toBe(true);
      }
      for (const key of tool.parameters.required ?? []) {
        expect(Object.keys(tool.parameters.properties)).toContain(key);
      }
    }
  });

  it("工具名唯一", () => {
    expect(new Set(AGENT_TOOLS.map((t) => t.name)).size).toBe(AGENT_TOOLS.length);
  });

  it("是任务意图形状，不是 CRUD 端点的一一镜像", () => {
    // 端点数远多于工具数；且没有任何工具直接以「整表覆写文件夹」的形态暴露出去。
    expect(AGENT_TOOLS.some((t) => /^(get|post|put|delete|patch)_/.test(t.name))).toBe(false);
    const folderWriters = AGENT_TOOLS.filter((t) =>
      t.implementation.some((i) => i.method === "POST" && i.path === "/api/document-folders"),
    );
    expect(folderWriters.map((t) => t.name)).toEqual(["create_folder"]);
  });

  it("删除类操作不在目录内（AI 只能提议删除）", () => {
    expect(AGENT_TOOLS.some((t) => t.implementation.some((i) => i.method === "DELETE"))).toBe(false);
    expect(AGENT_TOOLS.some((t) => /delete|remove/.test(t.name))).toBe(false);
  });

  it("没有任何工具能写会话（会话按来源平台归类）", () => {
    const convWriters = AGENT_TOOLS.filter((t) =>
      t.implementation.some((i) => i.method !== "GET" && i.path.startsWith("/api/conversations")),
    );
    expect(convWriters).toEqual([]);
  });

  it("toolsForLLM 输出 OpenAI 形状", () => {
    const declared = toolsForLLM();
    expect(declared).toHaveLength(AGENT_TOOLS.length);
    expect(declared[0]).toEqual({
      type: "function",
      function: {
        name: AGENT_TOOLS[0].name,
        description: AGENT_TOOLS[0].description,
        parameters: AGENT_TOOLS[0].parameters,
      },
    });
  });

  it("findAgentTool 按名字命中 / 未知名字返回 undefined", () => {
    expect(findAgentTool("search_corpus")?.name).toBe("search_corpus");
    expect(findAgentTool("drop_database")).toBeUndefined();
  });
});
