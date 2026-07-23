import { describe, expect, it } from "vitest";
import { diffAgainstBaseline, scanSource } from "./lint-ui.mjs";

describe("lint-ui rules", () => {
  it("flags hardcoded hex, window.confirm, text-[Npx], and out-of-table z-[N]", () => {
    const source = `
      <div className="bg-[#1A1A1A] text-[#fff] dark:border-[#222]">
        <button className="text-[10px] z-[85]" onClick={() => window.confirm("x")} />
      </div>
    `;
    const hits = scanSource(source, "fixture.tsx");
    const rules = new Set(hits.map((h) => h.rule));
    expect(rules.has("hardcoded-hex")).toBe(true);
    expect(rules.has("window-confirm")).toBe(true);
    expect(rules.has("arbitrary-text-px")).toBe(true);
    expect(rules.has("arbitrary-z-index")).toBe(true);
  });

  it("allows layering-table z-index values (30/50/60/70)", () => {
    const source = `<div className="z-[30] z-[50] z-[60] z-[70]" />`;
    const hits = scanSource(source);
    expect(hits.filter((h) => h.rule === "arbitrary-z-index")).toHaveLength(0);
  });

  it("allows baseline exemptions and fails only on novel hits", () => {
    const source = `window.confirm("a");\nwindow.confirm("b");`;
    const hits = scanSource(source, "x.tsx");
    expect(hits).toHaveLength(2);
    expect(hits[0].line).not.toBe(hits[1].line);

    const baseline = [hits[0]];
    const novel = diffAgainstBaseline(hits, baseline);
    expect(novel).toHaveLength(1);
    expect(novel[0].line).toBe(hits[1].line);
  });

  it("does not flag semantic token classes", () => {
    const source = `<Button className="bg-primary text-muted-foreground border-border z-50" />`;
    const hits = scanSource(source);
    expect(hits).toHaveLength(0);
  });
});
