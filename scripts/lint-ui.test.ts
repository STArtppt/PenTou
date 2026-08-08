import { describe, expect, it } from "vitest";
import { diffAgainstBaseline, isLegacyBaseline, reclaimableCount, scanSource } from "./lint-ui.mjs";

/** Baseline entry helper: grouped format is (rule, file, match, count). */
const group = (rule: string, file: string, match: string, count: number) => ({
  rule,
  file,
  match,
  count,
});

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

  it("does not flag semantic token classes", () => {
    const source = `<Button className="bg-primary text-muted-foreground border-border z-50" />`;
    const hits = scanSource(source);
    expect(hits).toHaveLength(0);
  });

  it("allows baseline exemptions and fails only on novel hits", () => {
    const source = `window.confirm("a");\nwindow.confirm("b");`;
    const hits = scanSource(source, "x.tsx");
    expect(hits).toHaveLength(2);
    expect(hits[0].line).not.toBe(hits[1].line);

    // Both hits share one group (same rule/file/match); quota of 1 leaves 1 novel.
    const baseline = [group("window-confirm", "x.tsx", "window.confirm(", 1)];
    const novel = diffAgainstBaseline(hits, baseline);
    expect(novel).toHaveLength(1);
    expect(novel[0].line).toBe(hits[1].line);
  });
});

describe("lint-ui baseline matching", () => {
  const baseline = [group("window-confirm", "x.tsx", "window.confirm(", 2)];

  it("ignores line drift — inserting code above a violation is not a new violation", () => {
    const tight = scanSource(`window.confirm("a");\nwindow.confirm("b");`, "x.tsx");
    const shifted = scanSource(
      `${"// pad\n".repeat(20)}window.confirm("a");\n\n\n\nwindow.confirm("b");`,
      "x.tsx"
    );

    expect(shifted[0].line).toBeGreaterThan(tight[0].line);
    expect(diffAgainstBaseline(tight, baseline)).toHaveLength(0);
    expect(diffAgainstBaseline(shifted, baseline)).toHaveLength(0);
    expect(reclaimableCount(shifted, baseline)).toBe(0);
  });

  it("flags an extra occurrence of an already-baselined violation, pointing at the later line", () => {
    const hits = scanSource(`window.confirm("a");\nwindow.confirm("b");`, "x.tsx");
    const novel = diffAgainstBaseline(hits, [
      group("window-confirm", "x.tsx", "window.confirm(", 1),
    ]);

    expect(novel).toHaveLength(1);
    expect(novel[0].line).toBe(hits[1].line);
    expect(novel[0].baselineCount).toBe(1);
    expect(novel[0].currentCount).toBe(2);
  });

  it("does not fail when violations get fixed and the count drops", () => {
    const hits = scanSource(`window.confirm("a");`, "x.tsx");
    const generous = [group("window-confirm", "x.tsx", "window.confirm(", 3)];

    expect(diffAgainstBaseline(hits, generous)).toHaveLength(0);
    expect(reclaimableCount(hits, generous)).toBe(2);
    expect(reclaimableCount([], generous)).toBe(3);
  });

  it("does not carry an exemption across files", () => {
    const moved = scanSource(`window.confirm("a");`, "b.tsx");
    const novel = diffAgainstBaseline(moved, [
      group("window-confirm", "a.tsx", "window.confirm(", 1),
    ]);

    expect(novel).toHaveLength(1);
    expect(novel[0].file).toBe("b.tsx");
    expect(novel[0].baselineCount).toBe(0);
  });

  it("detects legacy line-keyed baselines instead of misreading them as novel hits", () => {
    expect(
      isLegacyBaseline({
        violations: [{ rule: "window-confirm", file: "x.tsx", line: 12, match: "window.confirm(" }],
      })
    ).toBe(true);
    expect(isLegacyBaseline({ violations: [group("window-confirm", "x.tsx", "window.confirm(", 1)] })).toBe(
      false
    );
    expect(isLegacyBaseline({ violations: [] })).toBe(false);
  });
});
