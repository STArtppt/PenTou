#!/usr/bin/env node
/**
 * app 侧类型闸门。`vite build` 走 esbuild，只剥类型**不做检查**，`build:server` 又只覆盖
 * server/cli/vite-plugins —— 于是 `src/app` 的类型错误可以一路穿过三道闸门进主干。
 *
 * 与 lint-ui 同构：只对**新增**错误报红，存量经 baseline 豁免。
 * 但 key **刻意不含行号**（lint-ui 的教训）：按 (file, code, message) 计数，
 * 在别处插几行不会把一堆无关的存量错误伪装成"新增"。
 *
 * Usage:
 *   node scripts/typecheck.mjs                 # check（有新增错误则 exit 1）
 *   node scripts/typecheck.mjs --write-baseline
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const BASELINE_PATH = join(ROOT, "scripts", "typecheck-baseline.json");
const PROJECT = "tsconfig.json";

const ERROR_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/** 解析 tsc 输出。续行（缩进的说明）不是独立错误，忽略。 */
export function parseTscOutput(output) {
  const errors = [];
  for (const line of output.split("\n")) {
    const m = line.match(ERROR_RE);
    if (!m) continue;
    errors.push({
      file: m[1].replaceAll("\\", "/"),
      line: Number(m[2]),
      code: m[4],
      message: m[5].trim(),
    });
  }
  return errors;
}

/** 身份不含行号 —— 同一个错误上下挪动不该被当成新增。 */
export const errorKey = (e) => `${e.file}|${e.code}|${e.message}`;

export function countByKey(errors) {
  const counts = new Map();
  for (const e of errors) counts.set(errorKey(e), (counts.get(errorKey(e)) ?? 0) + 1);
  return counts;
}

/** 返回超出 baseline 计数的那些错误（按 key 取尾部若干条，用于展示行号）。 */
export function newErrors(current, baselineCounts) {
  const seen = new Map();
  const fresh = [];
  for (const e of current) {
    const key = errorKey(e);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > (baselineCounts.get(key) ?? 0)) fresh.push(e);
  }
  return fresh;
}

function runTsc() {
  try {
    execFileSync("npx", ["tsc", "-p", PROJECT], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    return "";
  } catch (e) {
    // tsc 有错误时以非零退出，诊断在 stdout
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

function main() {
  const write = process.argv.includes("--write-baseline");
  const errors = parseTscOutput(runTsc());

  if (write) {
    const entries = [...countByKey(errors)].sort(([a], [b]) => a.localeCompare(b));
    writeFileSync(
      BASELINE_PATH,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), count: errors.length, errors: entries },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    console.log(`Wrote baseline: ${errors.length} error(s) → scripts/typecheck-baseline.json`);
    return;
  }

  const baselineCounts = new Map(
    existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")).errors : [],
  );
  const baselineTotal = [...baselineCounts.values()].reduce((a, b) => a + b, 0);
  const fresh = newErrors(errors, baselineCounts);

  console.log(`typecheck: ${errors.length} current error(s), baseline ${baselineTotal}`);

  if (fresh.length === 0) {
    const gone = baselineTotal - errors.length;
    if (gone > 0) console.log(`Note: ${gone} baseline error(s) fixed (safe to regenerate baseline).`);
    console.log("typecheck OK — no new type errors.");
    return;
  }

  console.log(`\ntypecheck FAILED — ${fresh.length} new type error(s):\n`);
  for (const e of fresh) console.log(`  ${e.file}:${e.line}  ${e.code}: ${e.message}`);
  console.log("\nFix the new code, or if intentional legacy, regenerate baseline after review.");
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("typecheck.mjs")) main();
