/**
 * project-key.ts —— 登记目录 → 项目身份键（spec collector-docs-push §项目映射）。
 *
 * 优先级：显式 `--project` / `--doc-project` > git 仓库根目录名 > 用户手动输入 > 登记目录 basename。
 *
 * 为什么优先 git 根目录：登记的往往是仓库里的**子目录**（`~/proj/pentou/docs`），
 * 取末级目录名会得到 `docs` —— 两个不同仓库的 `docs` 会撞成同一个项目。仓库根目录名
 * 才是用户心里的"项目"，也天然唯一。
 *
 * 解析结果只在**登记/推送那一刻**求值一次并写进配置，之后扫描不再重算：
 * 项目 key 是不可变身份键，不能因为用户后来删了 `.git` 就漂移。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

/** 仓库根目录名；不是 git 仓库、没装 git、目录不存在都返回 undefined（绝不抛错）。 */
export function gitProjectKey(dir: string): string | undefined {
  try {
    if (!fs.existsSync(dir)) return undefined;
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf-8",
      // git 的报错走 stderr，这里不让它污染 CLI 输出——失败就是"不是仓库"，正常降级
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!top) return undefined;
    const name = path.basename(top);
    return name && name !== path.sep ? name : undefined;
  } catch {
    return undefined;
  }
}

export interface ResolveProjectKeyOptions {
  /** 用户显式指定的项目名，给了就直接用，不做任何探测。 */
  explicit?: string;
  /** 非交互环境（CI / 管道）传 false：跳过提问，直接用目录名兜底。 */
  interactive?: boolean;
  /** 注入点，便于测试。 */
  detectGit?: (dir: string) => string | undefined;
  ask?: (question: string) => Promise<string>;
  log?: (message: string) => void;
}

async function defaultAsk(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function resolveProjectKey(
  dir: string,
  options: ResolveProjectKeyOptions = {},
): Promise<string> {
  const explicit = (options.explicit ?? "").trim();
  const fallback = path.basename(path.resolve(dir));
  if (explicit) return explicit;

  const detect = options.detectGit ?? gitProjectKey;
  const fromGit = detect(dir);
  if (fromGit) {
    options.log?.(`  ${dir}\n    project: ${fromGit} (git repository root)`);
    return fromGit;
  }

  // 非 git 目录：问一次。非交互环境不能卡住，直接兜底。
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY);
  if (!interactive) return fallback;

  // 提问只是便利，不是闸门：stdin 提前 EOF（管道、Ctrl+D）不该让整条 init 失败，
  // 回落到目录名即可——那正是用户直接回车会得到的结果。
  const ask = options.ask ?? defaultAsk;
  try {
    const answer = (await ask(`  ${dir}\n    not a git repository. Project name [${fallback}]: `)).trim();
    return answer || fallback;
  } catch {
    return fallback;
  }
}
