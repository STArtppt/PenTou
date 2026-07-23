#!/usr/bin/env node
/**
 * UI consistency guardrails (ui-consistency US-06).
 * Fails on NEW violations; existing ones are exempt via baseline file.
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

export function keyOf(v) {
  return `${v.rule}|${v.file}|${v.line}|${v.match}`;
}

export function diffAgainstBaseline(violations, baselineViolations) {
  const allowed = new Set((baselineViolations || []).map(keyOf));
  return violations.filter((v) => !allowed.has(keyOf(v)));
}

function main() {
  const writeBaseline = process.argv.includes("--write-baseline");
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
  const violations = files.flatMap(scanFile);

  if (writeBaseline) {
    const baseline = {
      generatedAt: new Date().toISOString(),
      count: violations.length,
      violations: violations.map((v) => ({
        rule: v.rule,
        file: v.file,
        line: v.line,
        match: v.match,
      })),
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`Wrote baseline: ${violations.length} violation(s) → ${relative(ROOT, BASELINE_PATH)}`);
    process.exit(0);
  }

  if (!existsSync(BASELINE_PATH)) {
    console.error(`Missing baseline at ${relative(ROOT, BASELINE_PATH)}.`);
    console.error("Run: node scripts/lint-ui.mjs --write-baseline");
    process.exit(2);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const novel = diffAgainstBaseline(violations, baseline.violations);

  const currentKeys = new Set(violations.map(keyOf));
  const cleaned = (baseline.violations || []).filter((v) => !currentKeys.has(keyOf(v)));

  console.log(`lint:ui scanned ${files.length} files, ${violations.length} current hit(s), baseline ${baseline.count ?? baseline.violations?.length ?? 0}`);

  if (cleaned.length) {
    console.log(`Note: ${cleaned.length} baseline hit(s) no longer present (safe to regenerate baseline).`);
  }

  if (novel.length === 0) {
    console.log("lint:ui OK — no new violations.");
    process.exit(0);
  }

  console.error(`\nlint:ui FAILED — ${novel.length} new violation(s):\n`);
  for (const v of novel) {
    console.error(`  [${v.rule}] ${v.file}:${v.line}  ${v.match}`);
  }
  console.error("\nFix the new code, or if intentional legacy, regenerate baseline after review.");
  process.exit(1);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main();
}
