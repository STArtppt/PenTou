#!/usr/bin/env node
/**
 * build-npm-package.mjs — 组装可发布的精简 npm 包（npx-launcher spec §4.2 / guide §4.2）。
 *
 * 产出 npm-package/ 暂存目录：
 *   dist/ + dist-server/ + bin/pentou.mjs + 精简 package.json + README.md
 *
 * 关键约束：
 *   - 依赖清单由 dist-server 的 import 图核对（spec 决策 2 / DoD），只保留实际用到的
 *     server 运行时依赖，剔除全部前端 devDependencies。
 *   - 不含任何 scripts，尤其剔除仓库的 postinstall——obscura 改为运行时惰性下载
 *     （spec 决策 5，是该决策成立的前提）。
 *   - 不拷贝 bin/obscura 二进制（~60MB，运行时按需下载到数据目录）。
 *
 * 用法: node scripts/build-npm-package.mjs [--version <x.y.z>]
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "npm-package");

// ── 参数 ───────────────────────────────────────────────────────────────────────
function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const version = getArg("--version") || rootPkg.version;
if (!version || version === "0.0.1") {
  console.warn(`[build-npm-package] 警告：使用版本 ${version}；发版请通过 --version <tag> 注入`);
}

// ── 前置检查：构建产物存在 ──────────────────────────────────────────────────────
for (const dir of ["dist", "dist-server"]) {
  if (!fs.existsSync(path.join(ROOT, dir))) {
    console.error(`[build-npm-package] 缺少 ${dir}/，请先运行 pnpm build:all`);
    process.exit(1);
  }
}
if (!fs.existsSync(path.join(ROOT, "bin", "pentou.mjs"))) {
  console.error("[build-npm-package] 缺少 bin/pentou.mjs");
  process.exit(1);
}

// ── 清理并重建 npm-package/ ─────────────────────────────────────────────────────
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ── 拷贝产物 ────────────────────────────────────────────────────────────────────
fs.cpSync(path.join(ROOT, "dist"), path.join(OUT, "dist"), { recursive: true });
// 排除编译出的测试文件（tsconfig 未 exclude vite-plugins 下的 *.test.ts），
// 它们会拖进 vitest 等 devDependency，且不应随包发布。
fs.cpSync(path.join(ROOT, "dist-server"), path.join(OUT, "dist-server"), {
  recursive: true,
  filter: (src) => !src.endsWith(".test.js"),
});
fs.mkdirSync(path.join(OUT, "bin"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "bin", "pentou.mjs"), path.join(OUT, "bin", "pentou.mjs"));

// ── 依赖核对：扫描 dist-server 的 import 图 ─────────────────────────────────────
function walkJs(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, acc);
    else if (entry.name.endsWith(".js")) acc.push(full);
  }
  return acc;
}

/** 取 import 说明符的顶层包名（处理 scoped 包）。 */
function topLevelPackage(spec) {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.slice(0, 2).join("/");
  }
  return spec.split("/")[0];
}

const IMPORT_RE = /(?:import|export)\s+[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

const usedBare = new Set();
for (const file of walkJs(path.join(OUT, "dist-server"))) {
  const code = fs.readFileSync(file, "utf-8");
  let m;
  while ((m = IMPORT_RE.exec(code)) !== null) {
    const spec = m[1] || m[2] || m[3];
    if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) continue;
    usedBare.add(topLevelPackage(spec));
  }
}

const rootDeps = rootPkg.dependencies || {};
const dependencies = {};
const unresolved = [];
for (const name of [...usedBare].sort()) {
  if (rootDeps[name]) dependencies[name] = rootDeps[name];
  else unresolved.push(name);
}
// node: 内置以外、又不在 root dependencies 的裸 import（如 cheerio 经 dist-server 引用）。
if (unresolved.length) {
  console.warn(`[build-npm-package] 这些 import 不在 root dependencies，已忽略（确认是否内置/误判）：${unresolved.join(", ")}`);
}

console.log(`[build-npm-package] server 运行时依赖：${Object.keys(dependencies).join(", ") || "(无)"}`);

// ── 写精简 package.json ─────────────────────────────────────────────────────────
const pkg = {
  name: "@startist/pentou",
  version,
  description: "本地优先的 AI 对话管理器 —— 一条命令在本机启动 Pentou",
  type: "module",
  bin: { pentou: "bin/pentou.mjs" },
  engines: { node: ">=20" },
  files: ["dist", "dist-server", "bin", "README.md"],
  dependencies,
  publishConfig: { access: "public" },
  license: rootPkg.license || "MIT",
};
fs.writeFileSync(path.join(OUT, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

// ── 写 README.md（npm 包页面）───────────────────────────────────────────────────
const readme = `# Pentou

本地优先的 AI 对话管理器。一条命令在你自己的电脑上启动，数据全部留在本地。

## 快速开始

\`\`\`bash
npx -y @startist/pentou@latest
\`\`\`

启动后浏览器会自动打开 \`http://127.0.0.1:7766\`，数据保存在当前目录的 \`pentou-data/\`。
再次在同一目录执行即可继续使用之前的数据。

## 常用选项

| 选项 | 说明 |
| --- | --- |
| \`--port <n>\` | 起始端口，默认 7766（占用时自动向上探测） |
| \`--data-dir <p>\` | 数据目录，默认 \`<当前目录>/pentou-data\` |
| \`--password <pwd>\` | 开启登录鉴权（不传则本地免登录，仅监听回环） |
| \`--host <addr>\` | 监听地址，默认 \`127.0.0.1\`；对外暴露必须同时设 \`--password\` |
| \`--no-open\` | 不自动打开浏览器 |

## 要求

- Node.js ≥ 20

更多说明见项目主页。
`;
fs.writeFileSync(path.join(OUT, "README.md"), readme);

// ── 确保 npm-package/ 不进版本库 ────────────────────────────────────────────────
const gitignorePath = path.join(ROOT, ".gitignore");
try {
  const gi = fs.readFileSync(gitignorePath, "utf-8");
  if (!/^npm-package\/?$/m.test(gi)) {
    fs.appendFileSync(gitignorePath, "\n# npx 组包暂存目录（spec npx-launcher）\nnpm-package/\n");
    console.log("[build-npm-package] 已将 npm-package/ 追加到 .gitignore");
  }
} catch { /* ignore */ }

console.log(`[build-npm-package] 完成 → ${OUT}  (version ${version})`);
console.log("下一步：cd npm-package && npm pack  然后在干净目录 npm exec --yes --package=/path/to/startist-pentou-*.tgz -- pentou 冒烟");
