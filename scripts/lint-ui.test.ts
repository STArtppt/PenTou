import { describe, expect, it } from "vitest";
import {
  RULES,
  diffAgainstBaseline,
  isLegacyBaseline,
  keyOf,
  reclaimableCount,
  scanSource,
} from "./lint-ui.mjs";

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
});

describe("lint-ui leading guard", () => {
  it("keeps surrounding quotes out of the match text", () => {
    const hits = scanSource(`<div className="bg-[#FAFAFA]" />`, "x.tsx");
    expect(hits).toHaveLength(1);
    expect(hits[0].match).toBe("bg-[#FAFAFA]");
  });

  it("groups the quoted and unquoted spellings of one violation together", () => {
    const [quoted] = scanSource(`<div className="bg-[#FAFAFA]" />`, "x.tsx");
    const [inCn] = scanSource(`<div className={cn("pad", "bg-[#FAFAFA]")} />`, "x.tsx");
    expect(quoted.match).toBe(inCn.match);
    expect(keyOf(quoted)).toBe(keyOf(inCn));
  });

  it("catches back-to-back violations — a consuming guard would skip the second", () => {
    const hits = scanSource(`bg-[#fff]bg-[#000]`, "x.tsx");
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.match)).toEqual(["bg-[#fff]", "bg-[#000]"]);
  });

  it("still refuses to match mid-identifier", () => {
    expect(scanSource(`custombg-[#fff]`, "x.tsx")).toHaveLength(0);
    expect(scanSource(`mytext-[12px]`, "x.tsx")).toHaveLength(0);
    expect(scanSource(`myz-[85]`, "x.tsx")).toHaveLength(0);
  });

  it("keeps the variant prefix inside the match text", () => {
    const hits = scanSource(`<div className="dark:bg-[#fff]" />`, "x.tsx");
    expect(hits).toHaveLength(1);
    expect(hits[0].match).toBe("dark:bg-[#fff]");
  });

  it("still flags a hex utility behind an unknown variant", () => {
    // The guard blocks a utility glued to identifier chars (`custombg-`), not an
    // unrecognized variant name — `xdark:bg-[#fff]` is a hardcoded hex either way.
    const hits = scanSource(`xdark:bg-[#fff]`, "x.tsx");
    expect(hits).toHaveLength(1);
    expect(hits[0].match).toBe("xdark:bg-[#fff]");
  });

  it("guards every utility-class rule with the same zero-width lookbehind", () => {
    const GUARD = "(?<![a-zA-Z0-9_-])";
    const utilityRules = RULES.filter((r) => r.id !== "window-confirm");
    expect(utilityRules).toHaveLength(3);
    for (const rule of utilityRules) {
      expect(rule.re.source.startsWith(GUARD)).toBe(true);
    }
    // window-confirm is not a utility class and deliberately carries no guard.
    expect(RULES.find((r) => r.id === "window-confirm")!.re.source.startsWith(GUARD)).toBe(false);
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
