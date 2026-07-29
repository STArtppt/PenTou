#!/usr/bin/env node
/**
 * pentou — npx 一键启动 CLI（npx-launcher spec §4.2）。
 *
 * 职责：Node 版本检查 → 参数解析 → 安全校验 → 端口探测 → 调用 startServer
 *       → 打印访问地址/数据目录 → 跨平台打开浏览器 → 信号优雅退出。
 *
 * 约束：本文件必须保持 Node 18 可解析语法（spec 边界 2）——版本不足时给友好提示，
 *       而不是让 npm 抛原始堆栈。故重型逻辑（startServer，依赖 Node ≥ 20 的 better-sqlite3）
 *       一律延迟到版本检查通过后再 dynamic import。
 */
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..");

// ── Node 版本检查（spec US-01 AC2）─────────────────────────────────────────────
const MAJOR = Number(process.versions.node.split(".")[0]);
if (Number.isNaN(MAJOR) || MAJOR < 20) {
  const cur = process.versions.node;
  console.error("");
  console.error("  ✗ Pentou 需要 Node.js 20 或更高版本。");
  console.error(`    当前版本：v${cur}，需要：>= 20`);
  console.error("    请从 https://nodejs.org 下载安装最新 LTS 版本后重试。");
  console.error("");
  console.error("  ✗ Pentou requires Node.js >= 20.");
  console.error(`    Current: v${cur}, required: >= 20`);
  console.error("    Download the latest LTS from https://nodejs.org and try again.");
  console.error("");
  process.exit(1);
}

// ── 读取版本号 ─────────────────────────────────────────────────────────────────
function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf-8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ── 参数解析（spec §4.3）───────────────────────────────────────────────────────
const HELP = `Pentou — 本地优先的 AI 对话管理器

用法:
  npx -y @startist/pentou@latest [options]
  npx -y @startist/pentou@latest collect <init|pull|watch> [options]
  npx -y @startist/pentou@latest push docs <dir> [options]

命令:
  collect           常驻采集器：登记来源、拉取、监听自动同步
  push docs <dir>   一次性把目录下的 Markdown 推送到文档平面（不写配置、不留快照）

选项:
  --port <n>        起始端口，默认 7766（占用时向上探测至多 +10）
  --data-dir <p>    数据目录，默认 <当前目录>/pentou-data
  --password <pwd>  开启鉴权（不传 = 本地免登录，仅监听回环）
  --host <addr>     监听地址，默认 127.0.0.1；非回环地址必须配 --password
  --no-open         不自动打开浏览器
  --version, -v     打印版本
  --help, -h        打印本帮助
`;

function parseArgs(argv) {
  const opts = { port: 7766, dataDir: null, password: undefined, host: "127.0.0.1", open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--help": case "-h":
        process.stdout.write(HELP);
        process.exit(0);
        break;
      case "--version": case "-v":
        process.stdout.write(readVersion() + "\n");
        process.exit(0);
        break;
      case "--no-open":
        opts.open = false;
        break;
      case "--port":
        opts.port = Number(argv[++i]);
        break;
      case "--data-dir":
        opts.dataDir = argv[++i];
        break;
      case "--password":
        opts.password = argv[++i];
        break;
      case "--host":
        opts.host = argv[++i];
        break;
      default:
        fail(`未知参数 / unknown option: ${a}\n\n${HELP}`);
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    fail(`非法端口 / invalid --port: ${opts.port}`);
  }
  opts.dataDir = opts.dataDir
    ? path.resolve(process.cwd(), opts.dataDir)
    : path.resolve(process.cwd(), "pentou-data");
  return opts;
}

function fail(msg) {
  console.error("");
  console.error("  ✗ " + msg);
  console.error("");
  process.exit(1);
}

// ── 回环判定与安全校验（spec US-03 AC3 / §4.4）────────────────────────────────
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function isLoopback(host) {
  return LOOPBACK.has(host) || /^127\./.test(host);
}

// ── 端口探测（spec US-01 AC3 / 异常 1）─────────────────────────────────────────
function probePort(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

async function findFreePort(start, host) {
  for (let p = start; p <= start + 10; p++) {
    // eslint-disable-next-line no-await-in-loop
    if (await probePort(p, host)) return p;
  }
  return null;
}

// ── 跨平台打开浏览器（spec §4.2 / US-01 AC4 / 异常 3）──────────────────────────
function openBrowser(target) {
  let cmd; let args;
  if (process.platform === "darwin") { cmd = "open"; args = [target]; }
  else if (process.platform === "win32") { cmd = "cmd"; args = ["/c", "start", "", target]; }
  else { cmd = "xdg-open"; args = [target]; }

  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => warnManual(target));
    child.unref();
  } catch {
    warnManual(target);
  }
}

function warnManual(target) {
  console.log(`  ⚠ 无法自动打开浏览器，请手动访问 / please open manually: ${target}`);
}

// ── 局域网地址提示（host 为通配/具体 IP 时）──────────────────────────────────
function lanAddress() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return null;
}

// ── 主流程 ─────────────────────────────────────────────────────────────────────
async function main() {
  if (process.argv[2] === "collect") {
    try {
      const { runCollectCommand } = await import(new URL("../dist-server/src/cli/collector/command.js", import.meta.url));
      await runCollectCommand(process.argv.slice(3));
      return;
    } catch (e) {
      fail(`采集器命令失败 / collector command failed:\n    ${e?.message ?? e}`);
    }
  }

  // 一次性文档推送（spec collector-docs-push）：与 collect 并列的顶层命令
  if (process.argv[2] === "push") {
    try {
      const { runPushCommand } = await import(new URL("../dist-server/src/cli/collector/push.js", import.meta.url));
      await runPushCommand(process.argv.slice(3));
      return;
    } catch (e) {
      fail(`推送命令失败 / push command failed:\n    ${e?.message ?? e}`);
    }
  }

  const opts = parseArgs(process.argv.slice(2));

  // 安全边界：非回环 host 必须配 --password（spec US-03 AC3）。
  if (!isLoopback(opts.host) && !opts.password) {
    fail("对外暴露必须设置 --password / binding to a non-loopback host requires --password");
  }

  // 端口探测。
  const port = await findFreePort(opts.port, opts.host);
  if (port === null) {
    fail(`端口 ${opts.port}~${opts.port + 10} 全部被占用，请用 --port 指定其他端口\n` +
      `    ports ${opts.port}-${opts.port + 10} are all in use; pass --port <n>`);
  }
  if (port !== opts.port) {
    console.log(`  ⚠ 端口 ${opts.port} 被占用，已改用 ${port} / port ${opts.port} busy, using ${port}`);
  }

  // 延迟加载 server（依赖 Node ≥ 20 的原生模块）。
  let startServer;
  try {
    ({ startServer } = await import(new URL("../dist-server/src/server/index.js", import.meta.url)));
  } catch (e) {
    fail(`服务端模块加载失败 / failed to load server module:\n    ${e?.message ?? e}`);
  }

  let server;
  try {
    server = await startServer({
      port,
      host: opts.host,
      dataDir: opts.dataDir,
      local: true,
      password: opts.password,
    });
  } catch (e) {
    fail(`启动失败 / failed to start:\n    ${e?.message ?? e}`);
  }

  // 打印访问地址与数据目录。
  console.log("");
  console.log("  ✓ Pentou 已启动 / running");
  console.log(`    访问地址 / URL : ${server.url}`);
  console.log(`    数据目录 / data: ${server.dataDir}`);
  if (!isLoopback(opts.host)) {
    const lan = lanAddress();
    if (lan) console.log(`    局域网 / LAN  : http://${lan}:${port}`);
  }
  console.log(opts.password ? "    模式 / mode    : 鉴权 (password)" : "    模式 / mode    : 本地免登录 (local)");
  console.log("    按 Ctrl+C 退出 / press Ctrl+C to stop");
  console.log("");

  if (opts.open) openBrowser(server.url);

  // 信号优雅退出（spec 异常 4）。
  let closing = false;
  const shutdown = (sig) => {
    if (closing) return;
    closing = true;
    console.log(`\n  收到 ${sig}，正在关闭 / shutting down ...`);
    server.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  fail(`未预期错误 / unexpected error:\n    ${e?.stack ?? e}`);
});
