# Pentou 自动采集指南

本文档面向**已经把 Pentou 跑起来**的用户（还没跑起来？先看 [user-guide.md](./user-guide.md)），
讲清楚怎么让对话**自动进库**，不用每次手动导出文件再拖进来。

自动采集分两条通道，互不冲突，可以同时开：

| 通道 | 采什么 | 谁适合 | 章节 |
| --- | --- | --- | --- |
| **CLI 采集器** | 本机命令行 / 编辑器里的 agent 会话（Claude Code、Codex、Cursor、Copilot…） | 用 agent 写代码的人 | [§2](#2-通道-acli-采集器桌面-agent) |
| **浏览器插件** | 网页端聊天（ChatGPT、DeepSeek） | 主要在网页上聊 AI 的人 | [§3](#3-通道-b浏览器插件网页端) |

两条通道都只往**你自己那台 Pentou** 发数据，解析、去重、归类全在 Pentou 里完成。

> 想推的是**项目里的 Markdown 文档**（README、设计文档、笔记）而不是对话？那是另一条通道，见
> [《使用 CLI 上传文档指南》](./cli-doc-push-guide.md)——共用同一个采集令牌，落文档平面而不是对话平面。

---

## 1. 共同前置：拿到采集令牌

两条通道都靠同一个「采集令牌」向 Pentou 上报，先花一分钟拿到它。

1. 启动 Pentou，并**保持它开着**（采集端要连它）；
2. 记下浏览器地址栏里的地址——后面填「服务器地址」时用它，例如：
   - npx 启动：`http://127.0.0.1:7766`
   - 源码开发：`http://localhost:5173`
3. 页面顶栏点**「设置」→「采集」标签**；
4. 找到**「采集令牌」**，点右侧「复制」。

关于这个令牌：

- 它**只有上报权限**——拿到它的程序只能往你的库里写对话，不能读取、修改、删除任何内容；
- 同一个令牌，CLI 和插件共用；
- 「重置令牌」会让旧令牌**立即失效**，重置后所有采集端都要重新配置。

顺便看一眼同一页的**「脱敏」开关**（默认建议开启）：开启后，Pentou 在落盘前会把对话里常见的密钥形态（API key、私钥等）替换成占位符。采集是自动的，agent 会话里难免混进凭据，这个开关是最后一道防线。

---

## 2. 通道 A：CLI 采集器（桌面 agent）

> 也可装 Agent 技能 [`pentou-collect`](./agent-skills/pentou-collect/SKILL.md)，用自然语言驱动 `collect init / pull / watch`（含排除与 dry-run 闸门）。下面仍是完整手写步骤。

### 2.1 它能采哪些

采集器读取各个 agent **自己在本机存的会话记录**，不需要你导出任何东西。本机没装的来源会自动跳过。

| 来源 | 会话存在哪 | 备注 |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/` | 开箱即用 |
| Codex（CLI 与桌面版共用） | `~/.codex/sessions/` | 入库后归到 **ChatGPT** 文件夹 |
| Grok CLI | `~/.grok/sessions/` | |
| Pi | `~/.pi/agent/sessions/` | |
| GitHub Copilot（VS Code 插件） | VS Code 的 workspaceStorage | |
| GitHub Copilot（CLI 与桌面版共用） | `~/.copilot/session-store.db` | 需 Node ≥ 22.5 |
| OpenCode | `~/.local/share/opencode/opencode.db` | 需 Node ≥ 22.5；设了 `XDG_DATA_HOME` 则跟随该目录 |
| Hermes | `~/.hermes/state.db` | 需 Node ≥ 22.5 |
| Cursor | Cursor 的 `state.vscdb` | 需 Node ≥ 22.5 |
| waylog | 你显式登记的目录 | 要加 `--waylog-dir`，见 §2.6 |

**三个平台都支持。** 上表用的是 Unix 写法，`~` 指你的用户主目录 —— Windows 上就是 `C:\Users\你的用户名`，例如 Claude Code 的会话在 `C:\Users\你\.claude\projects`。这些 agent 在 Windows 上同样把会话存在用户主目录下，路径结构一致。两个例外是 **VS Code 的 Copilot 插件**和 **Cursor**：它们的用户数据目录本来就按平台不同（macOS 在 `~/Library/Application Support`，Windows 在 `%APPDATA%`，Linux 在 `~/.config`），采集器会自动按你的系统定位，不用手填。

装在非默认位置（比如 VS Code Insiders、多 profile、自定义安装路径）时，改配置文件里对应来源的 `root` / `db` 即可，见 §2.7。

**关于 Node 版本**：跑 Pentou 本身只要 Node ≥ 20；但上表标注的四个来源把会话存在 SQLite 数据库里，读取它们需要 **Node ≥ 22.5**。版本不够时这四个来源会整组跳过并给出提示，其余来源照常工作。用 `node -v` 查看，升级去 [nodejs.org](https://nodejs.org/) 装 LTS。

同名产品的不同形态（比如 Copilot 的 CLI 与插件）**不会拆成两个文件夹**，都归到同一个产品文件夹下，靠对话顶栏标题后的**形态徽章**区分来源。

### 2.2 第一步：初始化

采集命令要在**另一个终端窗口**执行——跑 Pentou 的那个窗口被占用着，别关它。

```bash
npx -y @startist/pentou@latest collect init
```

命令会逐项询问：

```text
Pentou URL [http://localhost:5173]:
Ingest token:
```

- **第一项别直接回车**：方括号里是默认值（源码开发地址），npx 用户要手动输入自己的地址，例如 `http://127.0.0.1:7766`；
- 第二项粘贴 §1 复制的令牌。

也可以一行写完：

```bash
npx -y @startist/pentou@latest collect init \
  --server http://127.0.0.1:7766 \
  --token 你的令牌
```

成功后会打印配置文件路径和本机来源检测结果（下面是 macOS 上的样子，Windows / Linux 打印的是各自的路径）：

```text
collector config written: /Users/你/.pentou/collector.json
  ✓ claude-code: /Users/你/.claude/projects
  ✓ codex: /Users/你/.codex/sessions
  - grok-cli: not found (will be skipped)
  ✓ cursor: /Users/你/Library/Application Support/Cursor/User/globalStorage/state.vscdb
```

`✓` 表示本机有这个 agent 的数据，`-` 表示没有、会自动跳过（不用手动关）。

init 会先向 Pentou 验证一次令牌，所以**执行时 Pentou 必须在运行**。报 `cannot verify ingest token` 就先确认另一个窗口里 Pentou 还开着、地址和令牌没抄错。

### 2.3 第二步：先演习，看看会采到什么

正式导入前**务必**先跑一次演习模式。它只列清单，**不上传任何内容**：

```bash
npx -y @startist/pentou@latest collect pull --dry-run --verbose
```

逐行看一遍清单，重点确认没有你不想入库的项目。发现敏感项目就按 §2.6 加排除规则，然后重跑演习，直到清单干净为止。

### 2.4 第三步：导入历史会话

清单确认无误后，去掉 `--dry-run` 正式导入：

```bash
npx -y @startist/pentou@latest collect pull
```

输出示例：

```text
scanned=120 sent=118 excluded=2
created=90 merged=20 skipped=8 error=0
```

| 字段 | 含义 |
| --- | --- |
| `scanned` | 扫到的会话数 |
| `sent` | 实际上报数 |
| `excluded` | 被排除规则跳过的 |
| `created` | 新建的对话 |
| `merged` | 合并进已有对话（同一会话有了新内容） |
| `skipped` | 内容没变化，或是空会话（比如只跑了个 `/exit`）——**正常，不是失败** |
| `error` | 出错数 |

导入完成后回到浏览器刷新 Pentou，对话列表里能看到新会话——这才是成功的最终判据。

首次导入历史较多时会跑一会儿，属正常。

### 2.5 第四步：常驻监听，新会话自动进库

`pull` 是一次性的；`watch` 会一直挂在终端里，新会话写盘后自动同步：

```bash
npx -y @startist/pentou@latest collect watch
```

启动成功会打印：

```text
collector watching. Press Ctrl+C to stop.
```

日常使用注意：

- **这个终端窗口不能关**，关掉监听就停了。下次要么重新 `watch`，要么跑一次 `pull` 补齐——历史不会丢，只是不实时；
- 会话结束后**等 15 秒左右**再去 Pentou 里找（防抖窗口，避免 agent 边写边传）；
- 停止：在该窗口按 `Ctrl + C`；
- Pentou 中途关了也不要紧，恢复后继续同步；
- 想开机自动常驻（launchd / systemd）目前还没有现成模板，暂时靠手动启动。

### 2.6 排除不想上传的项目

采集器默认会采所有能发现的会话。有不想入库的项目，在 init 时用 `--exclude` 登记（可多次）：

```bash
npx -y @startist/pentou@latest collect init \
  --server http://127.0.0.1:7766 \
  --token 你的令牌 \
  --exclude "secret-project/**" \
  --exclude "*.secret.jsonl" \
  --exclude "~/private/**"
```

**全局且累积**：`collect init --exclude` 写入 `~/.pentou/collector.json`，对**所有项目、所有 adapter**（含对话采集）生效；多次 init 的 exclude 是**并集累积**，不会自动清理。只想单次推文档时请用 `push docs --exclude`（不写配置），见 [cli-doc-push-guide.md §6](./cli-doc-push-guide.md)。

常用写法：

| 模式 | 含义 |
| --- | --- |
| `secret-project/**` | 任意路径下名为 `secret-project` 的目录及其全部内容 |
| `*.secret.jsonl` | 任意目录下以 `.secret.jsonl` 结尾的文件 |
| `~/private/**` | 你 home 目录下的 `private` 目录 |
| `**/tmp/**` | 任意层级的 `tmp` 目录 |

按**路径段**匹配，不是包含关系：`test` 只匹配名为 `test` 的那一段，不会匹配 `my-latest-app`。相对 pattern 会被隐式前缀 `**/`。

改完排除规则，用 §2.3 的演习模式验证是否生效。

两个例外要知道：

- **排除规则只对文件型来源生效**。存在 SQLite 里的来源（OpenCode / Copilot CLI / Hermes / Cursor）不参与匹配，要跳过整个来源，改配置文件把它的 `enabled` 设为 `false`（见 §2.7）；
- 重复执行 `collect init` **会保留**已有的排除规则、waylog 目录和同步进度，只更新地址、令牌和你这次显式传入的项——不用担心重新初始化把排除清单洗掉。

登记 waylog 目录同理：

```bash
npx -y @startist/pentou@latest collect init \
  --server http://127.0.0.1:7766 \
  --token 你的令牌 \
  --waylog-dir /path/to/project
```

### 2.7 配置文件在哪

```text
~/.pentou/collector.json
```

Windows 上即 `C:\Users\你的用户名\.pentou\collector.json`。可以直接用文本编辑器改，常用字段：

| 字段 | 说明 |
| --- | --- |
| `server` / `token` | Pentou 地址与采集令牌 |
| `adapters.<来源>.enabled` | 设为 `false` 即彻底关闭该来源 |
| `adapters.<来源>.root` / `.db` | 会话路径。装在非默认位置、或用 VS Code Insiders / 多 profile 时改这里 |
| `exclude` | 排除规则清单 |
| `debounceMs` | watch 的防抖窗口，默认 `15000`（15 秒） |
| `snapshots` | 同步进度记录，**不要手改** |

改完重新跑 `pull` 或 `watch` 生效。

### 2.8 只采某一个来源

排查问题或只想导某个 agent 时：

```bash
npx -y @startist/pentou@latest collect pull --adapter cursor --verbose
```

可选值：`claude-code`、`waylog`、`codex`、`grok-cli`、`pi`、`copilot`、`copilot-vscode`、`opencode`、`hermes`、`cursor`。

---

## 3. 通道 B：浏览器插件（网页端）

### 3.1 现状说明

插件目前支持 **ChatGPT**（`chatgpt.com` / `chat.openai.com`）和 **DeepSeek**（`chat.deepseek.com`）的会话页，浏览器为 **Chrome**（Edge 等 Chromium 内核浏览器同为 MV3、加载方式一致，但未逐一验证）。

**插件尚未上架 Chrome 应用商店**，当前需要从源码构建后以开发者模式加载。介意这一步的话，先用通道 A，或者用 Pentou 导入面板手动粘贴分享链接 / 导出文件。

### 3.2 构建并加载插件

需要本机有 Node.js ≥ 20 和 pnpm，以及一份仓库代码：

```bash
git clone https://github.com/STArtppt/PenTou.git
cd PenTou
pnpm install
pnpm --dir extension install
pnpm --dir extension exec vite build
```

产物在 `extension/dist/`。然后在 Chrome 里加载：

1. 地址栏输入 `chrome://extensions/` 回车；
2. 打开右上角**开发者模式**；
3. 点**「加载已解压的扩展程序」**；
4. 选择 `extension/dist/` 目录（注意是 `dist/`，不是 `extension/` 本身）；
5. 建议把插件**固定到工具栏**：点地址栏右侧的拼图图标，找到 Pentou Collector，点旁边的图钉。手动采集全靠点这个图标。

### 3.3 配置插件

打开插件选项页：扩展卡片上点「详情」→「扩展程序选项」；或在工具栏图标上右键 → 选项。

填两项：

- **Pentou server**：你打开 Pentou 的地址，如 `http://127.0.0.1:7766`（只填到端口，别带后面的路径）；
- **Ingest token**：§1 复制的采集令牌。

保存后点 **Test connection**，三种结果：

| 结果 | 含义 | 怎么办 |
| --- | --- | --- |
| Connected | 一切正常 | 可以开始采集 |
| Token rejected | 令牌错误或已被重置 | 回设置页重新复制令牌 |
| Pentou is unreachable | Pentou 没启动或地址填错 | 启动 Pentou / 核对地址 |

### 3.4 手动采集

1. 打开一个**具体的对话页**（地址栏里要有会话 id，例如 `chatgpt.com/c/<一串 id>`；停在平台首页或刚开的新对话是采不了的）；
2. 点工具栏上的 Pentou Collector 图标；
3. 看图标上的角标反馈。

角标含义：

| 角标 | 含义 |
| --- | --- |
| `NEW`（蓝） | 新建了一条对话 |
| `UPD`（蓝） | 更新了已有对话 |
| `SKIP`（蓝） | 内容与库里完全一致，无需改动——**正常，不是失败** |
| `OK`（蓝） | 已被接受 |
| 数字（橙 / 红） | Pentou 连不上，已暂存待补传（红色表示队列满、丢了最旧的一条） |
| `AUTH`（红） | 令牌被拒，自动采集已暂停 |
| `ERR`（红） | 采集或上报失败 |
| `N/A`（灰） | 当前页面采不了 |

手动采集成功还会弹一条系统通知（点它可直接跳到 Pentou）。**看不到通知不代表失败**——macOS 常默认屏蔽 Chrome 通知，以角标为准；想恢复通知去「系统设置 → 通知 → Google Chrome」允许，并检查专注模式。

角标是「最近一次事件」的残留，不会实时清空，可能看到一个早就过期的 `ERR`。**判断某次采集成没成，最可靠的依据始终是 Pentou 的对话列表。**

### 3.5 自动采集（默认关闭）

在插件选项页勾选对应平台的 **Auto collect after idle** 并保存即可开启。触发时机：

| 触发 | 行为 |
| --- | --- |
| 页面内容变化后静默约 60 秒 | 自动采集一次 |
| 切走标签页 / 页面隐藏 | 尝试采集 |
| 关闭页面 | 尝试采集 |

自动采集是静默的：只设角标，不弹通知，不打扰。没开这个开关时，插件**不会**发起任何回拉或上报。令牌被拒（角标 `AUTH`）后自动采集会暂停，回选项页重新保存配置即恢复。

### 3.6 Pentou 没开着的时候

采到的内容不会丢：插件会存进本地队列（最多 200 条，超了丢最旧的），Pentou 恢复后按序补传，最长每 5 分钟重试一次。角标显示数字就代表有待补传的内容。想立刻补传，去选项页重新保存一次配置。

---

## 4. 采集之后

- **去哪看**：对话按平台自动落进左侧对应文件夹；桌面顶栏第二行用徽章标明来源——
  - **品牌 / 形态**（如 Claude、Grok CLI）：同一产品的网页壳与 CLI 共库，靠形态徽章区分；
  - **采集方式**：终端（CLI 采集）/ 网页（浏览器插件）/ 手工（导出或分享链接导入）；
  - **项目**（可选）：agent 会话带工作目录时显示所属项目名，方便和仓库对齐。
- **重复采集不会产生副本**：同一平台的同一会话由 `平台 + 会话 id` 唯一标识，再采只会更新或跳过；
- **接着聊了再采**：新内容合并进原对话（`merged` / `UPD`），不新建一条；
- **超长会话**：CLI 采集器遇到超大会话（单个超过 10MB）会自动降级处理并做确定性瘦身，不会因为体积直接失败。

---

## 5. 隐私边界

- 两条通道的对话数据都**只发往你自己配置的那个 Pentou 地址**（通常是本机），不经过任何第三方服务器，也不会发给 Pentou 作者；
- 采集令牌只有上报权限，且只存在本机（CLI 存 `~/.pentou/collector.json`，插件存 Chrome 本地存储）；
- 插件用的是你**浏览器里已有的登录态**调用平台自己的接口，不接触你的平台账号密码；
- 自动采集默认关闭，需要你逐平台手动开启；
- CLI 采集器建议配合**排除规则**（§2.6）与设置页的**脱敏开关**（§1）一起用。

---

## 6. 排障速查

### CLI 采集器

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `cannot verify ingest token` | Pentou 没运行 / 地址填错 / 令牌抄错 | 确认 Pentou 在跑，地址与浏览器地址栏一致，重新复制令牌 |
| `401 unauthorized` | 令牌错误或已被重置 | 设置页复制新令牌，重跑 `collect init --token 新令牌` |
| `collector config not found` | 还没初始化 | 先跑 `collect init` |
| `node:sqlite unavailable (need Node >= 22.5)` | Node 版本低 | 升级到 Node ≥ 22.5；其余来源不受影响可继续用 |
| watch 一直没反应 | 还没过防抖窗口 / 该来源路径不存在 | 等 15 秒；再用 `pull --dry-run --verbose` 确认这个来源能被发现 |
| 结果里一堆 `skipped` | 内容没变化或是空会话 | 正常态，不是错误 |
| 同一对话每次都 `merged` | 续跑会话产生了多个记录文件 | 数据不丢、版本完整，已知待优化 |
| 排除规则没生效 | 写法不匹配，或目标是 SQLite 类来源 | 用演习模式验证写法；SQLite 来源改配置 `enabled: false` |

### 浏览器插件

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 点了图标没反应、也没通知 | 系统屏蔽了 Chrome 通知（macOS 常见） | 看角标：出现 `NEW`/`UPD`/`SKIP` 就是成功了 |
| 角标 `N/A`，通知写 **Open a conversation page on:** | 当前不是会话页 | 确认地址栏里有会话 id，而不是平台首页 |
| 角标 `N/A`，通知写 **Pentou can collect from:** | 页面脚本没起来 | 刷新该平台页面再试 |
| 角标 `SKIP` 以为失败了 | 内容与库中一致 | 正常态 |
| 角标 `AUTH` | 令牌被拒，自动采集已暂停 | 重新复制令牌并在选项页保存，自动恢复 |
| 角标显示数字 | Pentou 连不上，内容在队列里 | 启动 Pentou，等待重试或在选项页重新保存配置 |
| Test connection 显示不可达 | Pentou 没启动 / 地址带了多余路径 | 确认 Pentou 在跑；地址只填到端口 |
| 提示 ChatGPT / DeepSeek 未登录 | 浏览器里该平台登录态失效 | 在浏览器里重新登录该平台 |
| 某平台突然采不了了 | 平台改了自己的接口 | 先升级 Pentou（解析在服务端），仍不行则重新构建插件 |

---

## 7. 延伸阅读

| 文档 | 用途 |
| --- | --- |
| [`cli-doc-push-guide.md`](./cli-doc-push-guide.md) | 用 CLI 把项目里的 Markdown 推进文档平面 |
| [`user-guide.md`](./user-guide.md) | 本机 `npx` 启动、数据目录、桌面一键脚本、FAQ |
| [`deployment.md`](./deployment.md) | Docker 部署与反向代理 |
| [`pentou-introduction.md`](./pentou-introduction.md) | 产品介绍与能力说明 |
| [`releases.md`](./releases.md) | 版本发布说明 |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 从源码运行、想加新采集来源 |
