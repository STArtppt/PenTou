/**
 * 技能契约测试：SKILL.md 是权威描述，runner 的可执行定义必须与之对齐。
 * 这里守的是「四个技能都能被 runner 加载」以及「声明的 /api 依赖不是空话」。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SKILL_REGISTRY } from "./index";

const SKILLS_DIR = path.resolve(process.cwd(), "data/skills");
const THIS_CHANGE = ["doc-folder-organize", "topic-digest", "conversation-to-doc", "annotation-driven-rewrite"];

const registry = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, "registry.json"), "utf-8")) as {
  skills: { name: string; status: string; apiDeps: string[] }[];
};

describe("plane B 技能登记（spec skill-runtime）", () => {
  it.each(THIS_CHANGE)("%s 在 registry 中登记为 active", (name) => {
    expect(registry.skills.find((s) => s.name === name)?.status).toBe("active");
  });

  it("registry 里不再有 planned 的技能", () => {
    expect(registry.skills.filter((s) => s.status !== "active")).toEqual([]);
  });
});

describe.each(THIS_CHANGE)("技能 %s 合规可加载", (name) => {
  const dir = path.join(SKILLS_DIR, name);

  it("目录含 SKILL.md 与两个 schema", () => {
    expect(fs.existsSync(path.join(dir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "schema/input.schema.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "schema/output.schema.json"))).toBe(true);
  });

  it("SKILL.md frontmatter 的 name 与目录名、registry 一致", () => {
    const md = fs.readFileSync(path.join(dir, "SKILL.md"), "utf-8");
    expect(md.match(/^---\n([\s\S]*?)\n---/)?.[1]).toContain(`name: ${name}`);
    expect(registry.skills.some((s) => s.name === name)).toBe(true);
  });

  it("runner 已注册同名可执行定义", () => {
    expect(SKILL_REGISTRY[name]).toBeDefined();
    expect(SKILL_REGISTRY[name].steps.length).toBeGreaterThan(0);
    expect(SKILL_REGISTRY[name].inputSchema).toBeTruthy();
  });

  it("runtime inputSchema 与发布的 input.schema.json 对齐", () => {
    const published = JSON.parse(fs.readFileSync(path.join(dir, "schema/input.schema.json"), "utf-8"));
    const runtime = SKILL_REGISTRY[name].inputSchema;
    expect(new Set(published.required ?? [])).toEqual(new Set(runtime.required ?? []));
    expect(new Set(Object.keys(published.properties ?? {}))).toEqual(
      new Set(Object.keys(runtime.properties ?? {})),
    );
    expect(published.additionalProperties).toBe(runtime.additionalProperties);
  });

  it("数据依赖经 /api/*，SKILL.md 里声明了端点表", () => {
    const md = fs.readFileSync(path.join(dir, "SKILL.md"), "utf-8");
    expect(md).toContain("## `/api` 依赖");
    expect(md).toMatch(/`GET \/api\/health`/);
  });

  it("有 examples 样例", () => {
    expect(fs.existsSync(path.join(dir, "examples/basic.json"))).toBe(true);
    const example = JSON.parse(fs.readFileSync(path.join(dir, "examples/basic.json"), "utf-8"));
    expect(example.input).toBeTruthy();
    expect(example.output).toBeTruthy();
  });
});
