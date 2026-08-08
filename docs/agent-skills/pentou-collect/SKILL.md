---
name: pentou-collect
description: >-
  Collect local coding-agent sessions into Pentou via CLI (collect init/pull/watch),
  with dual confirmation gates and dry-run. Trigger when the user says: 采集本地
  agent 会话 / 把 claude code 会话同步到 pentou / collect init / 常驻采集 /
  排除某个项目不要采 / 帮我把本机会话采进笔头.
version: "1.0.0"
---

# pentou-collect

用自然语言驱动 `npx -y @startist/pentou@latest collect`，把本机编码 agent 的会话采入 Pentou **对话平面**。

**运行环境**：用户自己的任意机器（不依赖 Pentou 源码仓库）。本技能只依赖公开 CLI 契约。

**入口命令**（本机已装全局 CLI 时可用 `pentou` 代替）：

```bash
npx -y @startist/pentou@latest collect <init|pull|watch> [flags]
```

**只覆盖 CLI 采集器通道。** 浏览器插件通道不在本技能范围内（见「边界」）。

---

## 强制四段闸门

**禁止**在未获用户确认时执行正式上报。顺序固定：

### 1. 侦察

- **Pentou 必须在运行**（`collect init` 会先验令牌；另开终端跑采集，别关启动 Pentou 的窗口）
- 查看本机是否已有 `~/.pentou/collector.json`（Windows：`%USERPROFILE%\.pentou\collector.json`）
- 若需初始化：跑 `collect init`（或先规划 flag 再执行），用输出里的 `✓` / `-` 识别来源：
  - `✓` = 本机有该 agent 数据
  - `-` = 不存在，将自动跳过

### 2. 闸门 A — 建议排除并确认（必须停等）

列出：

| 项 | 内容 |
| --- | --- |
| 将采集的来源 | 侦察到的 `✓` 列表 |
| 项目 / 路径范围摘要 | 能从 init 或 dry-run 规划的范围 |
| 建议排除清单 | glob 列表（见「排除是硬闸门」） |
| 脱敏开关 | 提醒用户确认 Pentou「设置 → 采集」里的脱敏已开 |

即使用户说「全采 / 不用排除」，也**必须先列清单并停等**，不得静默全量采集。

用户确认或改完排除后，再进入闸门 B。

### 3. 闸门 B — dry-run 预览并确认（必须停等）

```bash
npx -y @startist/pentou@latest collect pull --dry-run --verbose
```

展示：扫到的会话规模、`excluded` 计数、项目/路径清单（verbose 细节）。

用户说「直接采、不用预览」时，**仍先** dry-run 并停等。用户拒绝则停止；正式 `pull` 前本机除已写入的 collector 配置外不应再有上报。

### 4. 正式执行

仅闸门 B 确认后：

```bash
npx -y @startist/pentou@latest collect pull
```

汇报：

`scanned` / `sent` / `excluded` / `created` / `merged` / `skipped` / `error`

| 字段 | 含义 |
| --- | --- |
| `scanned` | 扫到的会话数 |
| `sent` | 实际上报数 |
| `excluded` | 被排除规则跳过 |
| `created` | 新建对话 |
| `merged` | 合并进已有对话 |
| `skipped` | 内容未变化或空会话 —— **正常态，不是失败** |
| `error` | 出错数 |

大量 `skipped` 应解释为正常，不要报成错误。最终以用户在浏览器刷新后能看到会话为准。

---

## 令牌是人工环节

| 规则 | 说明 |
| --- | --- |
| 来源 | 只能由用户从 Pentou **「设置 → 采集」** 复制 |
| Agent 禁止 | **不得**在数据目录、配置文件或接口里自行搜寻令牌 |
| 交互 | 需要令牌时**停等用户粘贴** |
| 回显 | **不得**在对话/日志中打印完整 token（可用前后截断确认） |
| 已有配置 | 若 `~/.pentou/collector.json` 已有可用 server/token，**优先复用**，不重复索要 |

`collect init` 会向 Pentou 验证令牌 → **执行时 Pentou 必须在跑**。

| 错误 | 含义与处理 |
| --- | --- |
| `cannot verify ingest token` | 服务未开、地址错、或令牌错 → 确认另一窗口里 Pentou 在跑，核对 `--server` 与令牌后重试 |
| `401 unauthorized` | 令牌错误或已重置 → 设置页复制新令牌，重跑 `collect init --token <新令牌>` |

交互式 init 时，默认 URL 方括号里可能是开发地址；npx 用户应填实际地址（如 `http://127.0.0.1:7766`），别直接回车。

---

## 排除是硬闸门

采集面是**本机全部 agent 会话**（可能含其他项目、客户代码、凭据）。

- 用户未提排除，或明确「全采」→ 仍先列扫描到的项目清单并停等
- 提示确认设置页**脱敏开关**已开启
- glob **按路径段**匹配（`test` 不会误伤 `my-latest-app`）
- 相对 pattern（不含 `/` 或不以 `/` 开头）会被隐式前缀 `**/`
- 改规则后**必须**用 dry-run 的 `excluded` 计数复核，再正式 `pull`

常用写法示例：

| 模式 | 含义 |
| --- | --- |
| `secret-project/**` | 任意路径下名为 `secret-project` 的目录 |
| `*.secret.jsonl` | 任意目录下该后缀文件 |
| `~/private/**` | home 下 `private` |
| `**/tmp/**` | 任意层级的 `tmp` |

---

## exclude 作用域对照

| 命令 | 作用域 | 是否写配置 |
| --- | --- | --- |
| `collect init --exclude` | **全局**；对所有项目、所有 adapter 生效；多次 init **并集累积**，不清理旧规则 | 写入 `~/.pentou/collector.json` |
| `push docs --exclude` | **仅本次调用**；与配置 exclude 合并使用 | **不写**配置 |

写配置前：展示**合并后的完整排除清单**，获确认再执行 `collect init --exclude …`。

重复执行 `collect init` 会**保留**既有排除规则、waylog 目录与同步进度，只更新本次显式传入的项（及地址/令牌等）。

单次文档推送请用 `push docs --exclude`（见技能 `pentou-docs-push`），不要为一次推送去 `collect init --exclude`。

---

## 已知来源边界

下列为**已知行为**，不是故障：

### SQLite 类来源与排除

`opencode` / `copilot`（CLI 库）/ `hermes` / `cursor` 存于 SQLite，**不参与** exclude glob 匹配。

- 要跳过整个来源：改 `~/.pentou/collector.json` 中 `adapters.<name>.enabled` 为 `false`
- **不能**用一条 exclude 只排除 Cursor 里的某个项目（只能整源关）

### Node 版本

跑 Pentou 本体：Node ≥ 20。  
上述四个 SQLite 来源：需要 **Node ≥ 22.5**。不足时整组跳过并提示，**其余来源照常**。升级见 [nodejs.org](https://nodejs.org/) LTS。

### 非默认安装位置

改配置里对应来源的 `root` / `db`（如 VS Code Insiders、多 profile、自定义路径）。

### 单源排查

```bash
npx -y @startist/pentou@latest collect pull --adapter <name> --verbose
```

`<name>` 示例：`claude-code`、`waylog`、`codex`、`grok-cli`、`pi`、`copilot`、`copilot-vscode`、`opencode`、`hermes`、`cursor`、`docs`。

---

## watch 交给用户

`collect watch` 是**长驻前台进程**。

**禁止：**

- Agent 后台代跑 / 挂起 `collect watch` 后宣称「常驻已开启」
- 在尚无实际同步结果时声称常驻已工作

**正确做法：** 把命令交给用户在**自己的终端**执行：

```bash
npx -y @startist/pentou@latest collect watch
```

说明给用户：

- 关该终端窗口 = 监听停止
- 会话结束后约 **15 秒**防抖窗口才会同步（默认 `debounce-ms=15000`）
- 停止：`Ctrl + C`
- Pentou 中途关闭不影响恢复后继续同步
- 错过的历史：再跑一次 `collect pull` 补齐

汇报里**不要**设「已常驻开启」条目；只写「请在你的终端执行」。

---

## CLI 契约（稳定接口）

### collect init

```bash
npx -y @startist/pentou@latest collect init \
  --server http://127.0.0.1:7766 \
  --token '<token>' \
  --exclude 'secret-project/**'
```

| Flag | 语义 |
| --- | --- |
| `--server <url>` | Pentou 地址 |
| `--token <token>` | 设置页采集令牌 |
| `--exclude <glob>` | 可重复；**全局累积**，写配置 |
| `--waylog-dir <path>` | 可重复；登记 waylog 目录或其父项目目录 |
| `--claude-root <path>` | Claude Code projects 根，默认 `~/.claude/projects` |
| `--debounce-ms <n>` | watch 防抖毫秒，默认 `15000` |

### collect pull

```bash
npx -y @startist/pentou@latest collect pull --dry-run --verbose
npx -y @startist/pentou@latest collect pull
npx -y @startist/pentou@latest collect pull --adapter cursor --verbose
```

| Flag | 语义 |
| --- | --- |
| `--dry-run` | 只列清单，不上传 |
| `--verbose` | 打印跳过路径等细节 |
| `--adapter <name>` | 只跑指定来源 |

### collect watch

```bash
npx -y @startist/pentou@latest collect watch
# 可选：--verbose
```

由用户在自己终端前台运行，见上一节。

---

## 命令模板

闸门 B（强制先行）：

```bash
npx -y @startist/pentou@latest collect pull --dry-run --verbose
```

正式导入（闸门 B 确认后）：

```bash
npx -y @startist/pentou@latest collect pull
```

首次 init（无配置时；token 勿完整回显）：

```bash
npx -y @startist/pentou@latest collect init \
  --server http://127.0.0.1:7766 \
  --token '<token>' \
  --exclude 'secret-project/**'
```

用户侧常驻（Agent 不代跑）：

```bash
npx -y @startist/pentou@latest collect watch
```

---

## 边界

- 只覆盖 **CLI 采集器**（本机 agent 会话 → 对话平面）
- **不覆盖浏览器插件通道**（网页版 ChatGPT 等；需构建扩展、Chrome 开发者模式加载、选项页填表）。见仓库文档 `docs/auto-collect-guide.md` **§3**
- 不修改用户 Agent 配置文件；不写 Pentou 内部实现路径
- CLI 出现不兼容变更时，回到仓库 `docs/agent-skills/` 复制新版技能；用 frontmatter `version` 对照
