#!/usr/bin/env node
/**
 * app 侧类型闸门。`vite build` 走 esbuild，只剥类型**不做检查**，`build:server` 又只覆盖
 * server/cli/vite-plugins —— 于是 `src/app` 的类型错误可以一路穿过三道闸门进主干。
 *
 * 零容忍：`tsc -p tsconfig.json` 有任一错误即以非零退出。无 baseline、无豁免文件。
 *
 * Usage:
 *   node scripts/typecheck.mjs
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
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
  const output = runTsc();
  const errors = parseTscOutput(output);

  if (errors.length === 0) {
    console.log("typecheck OK — 0 errors.");
    return;
  }

  // 透传 tsc 原文，便于 IDE / 终端跳转
  if (output.trim()) process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  console.error(`\ntypecheck FAILED — ${errors.length} error(s).`);
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("typecheck.mjs")) main();
