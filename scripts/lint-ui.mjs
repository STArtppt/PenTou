#!/usr/bin/env node
/**
 * UI consistency guardrails (ui-consistency US-06).
 * Fails on NEW violations; existing ones are exempt via baseline file.
 *
 * The baseline matches on (rule, file, match) + per-group hit count — never on line
 * numbers. Moving or reformatting code must not manufacture "new" violations, since
 * that pressures everyone into regenerating the baseline, which launders real ones.
 *
 * Usage:
 *   node scripts/lint-ui.mjs              # check (exit 1 on new violations)
 *   node scripts/lint-ui.mjs --write-baseline  # regenerate baseline from current tree
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const BASELINE_PATH = join(ROOT, "scripts", "lint-ui-baseline.json");
const SCAN_DIRS = ["src/app", "src/components", "src/styles"];
const FILE_RE = /\.(tsx?|jsx?|css)$/;

/** Allowed arbitrary z-index values (startist layering table). */
const ALLOWED_Z = new Set([30, 50, 60, 70]);

export const RULES = [
  {
    id: "hardcoded-hex",
    description: "hardcoded hex color utilities (use semantic tokens)",
    // bg-[#1A1A1A], text-[#fff], border-[#222], dark:bg-[#151515], etc.
    re: /(?:^|[^a-zA-Z0-9_-])(?:[a-z-]+:)*(?:bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|accent|caret|divide|shadow)-\[#[0-9a-fA-F]{3,8}\]/g,
  },
  {
    id: "window-confirm",
    description: "window.confirm (use ConfirmDialog)",
    re: /window\.confirm\s*\(/g,
  },
  {
    id: "arbitrary-text-px",
    description: "arbitrary text-[Npx] font size (use text-xs… scale)",
    re: /text-\[\d+px\]/g,
  },
  {
    id: "arbitrary-z-index",
    description: "arbitrary z-[N] outside layering table (30/50/60/70)",
    re: /z-\[(\d+)\]/g,
    filter: (match) => {
      const n = Number(match[1]);
      return !ALLOWED_Z.has(n);
    },
  },
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (FILE_RE.test(name)) out.push(full);
  }
  return out;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/** Scan a source string; returns violation objects (file field is caller-supplied). */
export function scanSource(source, file = "fixture.tsx") {
  const hits = [];
  for (const rule of RULES) {
    // Fresh regex per scan so lastIndex never leaks across calls
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m;
    while ((m = re.exec(source)) !== null) {
      if (rule.filter && !rule.filter(m)) continue;
      hits.push({
        rule: rule.id,
        file,
        line: lineOf(source, m.index),
        match: m[0].trim(),
      });
    }
  }
  return hits;
}

function scanFile(absPath) {
  const rel = relative(ROOT, absPath).replaceAll("\\", "/");
  return scanSource(readFileSync(absPath, "utf8"), rel);
}

/** Match key is deliberately line-independent: moving code must not look like a new violation. */
export function keyOf(v) {
  return `${v.rule}|${v.file}|${v.match}`;
}

/** Aggregate hits by key. Line numbers survive only for reporting, never for matching. */
export function groupHits(violations) {
  const groups = new Map();
  for (const v of violations || []) {
    const key = keyOf(v);
    let g = groups.get(key);
    if (!g) {
      g = { rule: v.rule, file: v.file, match: v.match, count: 0, lines: [] };
      groups.set(key, g);
    }
    g.count += 1;
    if (typeof v.line === "number") g.lines.push(v.line);
  }
  for (const g of groups.values()) g.lines.sort((a, b) => a - b);
  return groups;
}

/** A baseline written before the grouped format has no per-group `count`. */
export function isLegacyBaseline(baseline) {
  return (baseline?.violations || []).some((v) => typeof v?.count !== "number");
}

/** Baseline entries → allowed hit count per key. Tolerates legacy entries (1 hit each). */
function quotaOf(baselineViolations) {
  const quota = new Map();
  for (const b of baselineViolations || []) {
    const key = keyOf(b);
    const n = typeof b.count === "number" ? b.count : 1;
    quota.set(key, (quota.get(key) || 0) + n);
  }
  return quota;
}

/**
 * Novel = hits exceeding their group's baseline quota.
 * Over-quota groups report their LAST N lines — newly added code usually lands below.
 */
export function diffAgainstBaseline(violations, baselineViolations) {
  const quota = quotaOf(baselineViolations);
  const novel = [];
  for (const [key, g] of groupHits(violations)) {
    const allowed = quota.get(key) || 0;
    const excess = g.count - allowed;
    if (excess <= 0) continue;
    for (const line of g.lines.slice(-excess)) {
      novel.push({
        rule: g.rule,
        file: g.file,
        match: g.match,
        line,
        baselineCount: allowed,
        currentCount: g.count,
      });
    }
  }
  novel.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return novel;
}

/** Quota no longer occupied by current hits — reclaimable, and never a failure. */
export function reclaimableCount(violations, baselineViolations) {
  const current = groupHits(violations);
  let total = 0;
  for (const [key, allowed] of quotaOf(baselineViolations)) {
    total += Math.max(0, allowed - (current.get(key)?.count || 0));
  }
  return total;
}

/** Line-keyed novelty — only to report what a migration regeneration would absorb. */
function legacyNovelCount(violations, baselineViolations) {
  const legacyKey = (v) => `${v.rule}|${v.file}|${v.line}|${v.match}`;
  const allowed = new Set((baselineViolations || []).map(legacyKey));
  return violations.filter((v) => !allowed.has(legacyKey(v))).length;
}

function buildBaseline(violations) {
  const groups = [...groupHits(violations).values()]
    .map(({ rule, file, match, count }) => ({ rule, file, match, count }))
    .sort(
      (a, b) =>
        a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.match.localeCompare(b.match)
    );
  return {
    generatedAt: new Date().toISOString(),
    totalHits: violations.length,
    groupCount: groups.length,
    violations: groups,
  };
}

function main() {
  const writeBaseline = process.argv.includes("--write-baseline");
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
  const violations = files.flatMap(scanFile);

  const existing = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
    : null;

  if (writeBaseline) {
    const baseline = buildBaseline(violations);
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(
      `Wrote baseline: ${baseline.totalHits} hit(s) in ${baseline.groupCount} group(s) → ${relative(ROOT, BASELINE_PATH)}`
    );
    if (!existing) {
      console.log(`本次登记 ${baseline.totalHits} 条为存量（此前无基线）。`);
    } else {
      const absorbed = isLegacyBaseline(existing)
        ? legacyNovelCount(violations, existing.violations)
        : diffAgainstBaseline(violations, existing.violations).length;
      console.log(`本次登记 ${baseline.totalHits} 条为存量，其中 ${absorbed} 条相对旧基线是新增。`);
      if (absorbed > 0) {
        console.log("↑ 这些新增违规已被豁免——请确认这是评审后的有意决定，而不是为了让红灯消失。");
      }
    }
    process.exit(0);
  }

  if (!existing) {
    console.error(`Missing baseline at ${relative(ROOT, BASELINE_PATH)}.`);
    console.error("Run: node scripts/lint-ui.mjs --write-baseline");
    process.exit(2);
  }

  if (isLegacyBaseline(existing)) {
    console.error(`${relative(ROOT, BASELINE_PATH)} 仍是按行号记录的旧格式基线。`);
    console.error("旧格式会把行号漂移误报成新增违规，已不再支持。");
    console.error("一次性迁移：node scripts/lint-ui.mjs --write-baseline");
    process.exit(2);
  }

  const novel = diffAgainstBaseline(violations, existing.violations);
  const reclaimable = reclaimableCount(violations, existing.violations);
  const currentGroups = groupHits(violations).size;
  const baseHits = existing.totalHits ?? "?";
  const baseGroups = existing.groupCount ?? existing.violations?.length ?? 0;

  console.log(
    `lint:ui scanned ${files.length} files, ${violations.length} hit(s) in ${currentGroups} group(s); ` +
      `baseline ${baseHits} hit(s) in ${baseGroups} group(s)`
  );

  if (reclaimable) {
    console.log(`Note: ${reclaimable} 条基线额度已不再被占用（违规已修掉），可在评审后重生成基线回收。`);
  }

  if (novel.length === 0) {
    console.log("lint:ui OK — no new violations.");
    process.exit(0);
  }

  console.error(`\nlint:ui FAILED — ${novel.length} 处新增违规：\n`);
  for (const v of novel) {
    console.error(
      `  [${v.rule}] ${v.file}:${v.line}  ${v.match}  (基线额度 ${v.baselineCount} / 当前 ${v.currentCount})`
    );
  }
  console.error("\n修复上述新增违规。");
  console.error("仅当经人工评审确认属于有意保留的存量/例外时，才运行 node scripts/lint-ui.mjs --write-baseline —");
  console.error("重生成会把当前全部违规登记为存量，它不是报红的常规解法。");
  process.exit(1);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main();
}
