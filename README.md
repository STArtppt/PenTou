<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/images/logo_dark.png">
  <img src="./assets/images/logo.png" alt="PenTou 笔头" width="112">
</picture>

# PenTou 笔头

**好记性不如烂笔头。**

和 AI 聊出来的东西，关掉标签页就找不回了。<br>
PenTou 把散落在十几个平台的对话收进本机，沉淀成**可检索、可加工、可迁移**的 Markdown 知识资产。

简体中文 | [English](./README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/@startist/pentou?label=npm)](https://www.npmjs.com/package/@startist/pentou)
![Platform](https://img.shields.io/badge/platform-linux%2Famd64%20%7C%20linux%2Farm64-blue.svg)

</div>

![PenTou 主界面：左侧平台文件夹侧栏，中间对话正文，右侧常驻 AI 问答面板](./assets/demo/screenshot-Chats-main-interface.png)

<sub>三栏主界面：平台文件夹侧栏（含条数） · 对话正文 · 常驻 AI 问答（自动携带当前对话作为上下文）</sub>

---

## 适合谁

- 每天跨多个 AI 产品工作、需要**统一留存与回查**的重度用户
- 要把对话提炼成文章、方案、笔记的**知识工作者**
- 用 Claude Code / Cursor / Codex 等 agent、希望会话**自动归档**的开发者
- 坚持数据自持、拒绝云端锁定的隐私敏感用户
- 已有 Obsidian / Markdown / Git 工作流的人

---

## 为什么现在值得用

**当前状态：已具备日常高可用价值。** 一条命令即可在本机跑起来；采集、检索、文档提炼、AI 二次问答、私有化部署形成完整闭环——不是 demo，是可以天天用的工作台。

| 痛点 | PenTou 的答案 |
| --- | --- |
| 对话散落在十几个平台 | **统一入库**：导出文件 / 分享链接 / CLI 自动采集 / 浏览器插件 |
| 项目里的 Markdown 也想归档 | **CLI 文档推送**：按仓库落「项目」维度，可 `watch` 常驻同步 |
| 想回查却搜不到 | **本地全文 + 可选语义检索**，跨对话与文档一键跳转高亮 |
| 入库后分不清哪来的 | **顶栏来源徽章**：采集方式（网页/终端/手工）、项目、文档来源三态 |
| 长对话难以沉淀成知识 | **对话 → 文档 → 批注 → AI 重写 → 推送 Obsidian** |
| 数据在云上、导不出 | **原生 Markdown 落盘**，可用 VSCode / Git / Obsidian 直接消费 |
| 部署门槛高 | **`npx` 本机一键** 或 **Docker 私有化**，数据可在实例间迁移 |

---

## 核心能力一览

### 1. 多源采集：发生即归档

- **手动导入**：ChatGPT / DeepSeek 导出 JSON、各类 `.jsonl`、Markdown、平台分享链接；批量拖入，单文件失败不拖垮整批。
- **CLI Collector**：监听桌面 agent 会话并自动上报——覆盖 Claude Code、Codex、Cursor、Copilot、OpenCode、Hermes、Grok CLI、Pi 等；`pull` 批量 + `watch` 差量。
- **浏览器插件**：网页端哑采集，解析与去重在服务端统一完成。
- **Ingest Gateway**：幂等 upsert、密钥脱敏、超长会话自动降级瘦身，反复同步不产生垃圾副本。
- **导入自动归类**：按平台落入对应文件夹，减少手动整理。
- **CLI 文档推送**：项目里的 Markdown（README、设计文档、笔记）一条命令进**文档平面**；按 git 仓库自动落「项目」维度，支持 `watch` 常驻同步。

两条自动通道怎么开、怎么排除敏感项目，见 [`docs/auto-collect-guide.md`](./docs/auto-collect-guide.md)。
文档推送与项目分组，见 [`docs/cli-doc-push-guide.md`](./docs/cli-doc-push-guide.md)。

![导入面板：拖拽导出文件、粘贴分享链接，以及 CLI 采集器与浏览器插件的接入说明](./assets/demo/screenshot-Import-interface.png)

<sub>导入面板一处收口四条通道：平台导出文件、分享链接、CLI 采集器、浏览器插件，并直接列出各通道已支持的平台</sub>

### 2. 本地 Markdown 即真相源

每条对话是数据目录下的一个 Markdown 文件（frontmatter + 消息正文）：npx 形态为 `pentou-data/conversations/<id>.md`，源码 / Docker 形态为 `data/conversations/<id>.md`。索引可随时重建；目录可 Git 化、可整夹备份、可跨机拷贝。

### 3. 检索与再加工

- **混合检索**：SQLite FTS5 全文（默认）+ 可选 embedding 语义路，RRF 融合排序。
- **文档闭环**：一键转文档 / 消息摘录 / MinerU 解析 PDF·Docx·PPTX；批注驱动 AI 重写，版本可回滚。
- **AI 侧边栏**：基于当前对话/文档上下文即时问答（BYOK），回答可再沉淀为文档。
- **Obsidian 推送**：加工完成后一键进入你的最终知识库。

![文档视图：正文居中排版，右侧自动生成目录，顶栏可编辑、让 AI 重写、查看版本历史、导入 Obsidian](./assets/demo/screenshot-Docs-main-interface.png)

<sub>文档视图：右侧自动目录导航；顶栏一排就是加工闭环——编辑、让 AI 重写、版本历史、导入 Obsidian、问问 AI</sub>

### 4. 可用的产品体验

- 三栏布局：文件夹侧栏 · 对话/文档正文 · 问题大纲导航；明暗主题、中英文。
- **顶栏来源一目了然**：对话顶栏展示品牌/形态、采集方式（网页 / 终端 / 手工）与所属项目；文档顶栏展示「更新于」与来源三态（来自对话 / 来自终端 / 来自导入）——同一会话是插件采的还是 CLI 采的、文档是仓库推上来的还是对话转的，不用点开设置就能看清。
- 代码高亮、Mermaid 图示、图片资产本地化与灯箱预览。
- 设置、导入、搜索在桌面与**手机端**均有适配布局。
- UI 基于统一设计系统，批量选择、拖拽归类、时间排序等日常操作已齐。

### 5. 三种部署形态，数据可搬家

| 形态 | 适合谁 | 入口 |
| --- | --- | --- |
| **本机 `npx`** | 个人日常、零运维 | `npx -y @startist/pentou@latest` → [`docs/user-guide.md`](./docs/user-guide.md) |
| **Docker** | NAS / 云主机长期服务 | [`docs/deployment.md`](./docs/deployment.md) |
| **源码开发** | 贡献者 / 二次开发 | [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) |

实例之间支持**一键迁移**（推送 / 拉取 + 差异预览），试用转正、多端同步、云回迁本机不必手拷文件。迁移能力目前是 R1：功能可用，真实双实例验收、中断续传与大媒体库流式传输仍在补。

---

## 30 秒上手

```bash
# 1. 需要 Node.js ≥ 20
node -v

# 2. 在你想放数据的目录执行
npx -y @startist/pentou@latest

# 3. 浏览器打开终端提示的地址（默认 http://127.0.0.1:7766）
# 4. 点 Import 导入第一条对话，或配置自动采集（docs/auto-collect-guide.md）
```

数据默认落在当前目录的 `pentou-data/`，只监听本机、无需密码；备份就是把这个文件夹整夹复制走。完整入门见 [`docs/user-guide.md`](./docs/user-guide.md)。

Docker（私有服务）：

```bash
mkdir -p /srv/pentou/data && chown -R 1000:1000 /srv/pentou/data

docker run -d \
  --name pentou \
  --restart unless-stopped \
  -p 127.0.0.1:7766:7766 \
  -e PENTOU_PASSWORD='your-strong-password' \
  -v /srv/pentou/data:/app/data \
  -m 1g \
  ghcr.io/startppt/pentou:latest
```

镜像支持 `linux/amd64` + `linux/arm64`。公网务必经反代挂 TLS，完整说明见 [`docs/deployment.md`](./docs/deployment.md)。

---

## 让 AI 替你完成

完全没有编程基础也能装。把下面整段提示词复制给任意 AI Agent（Claude Code、Cursor、Codex 等），让它替你检查环境、处理报错、启动 PenTou 并创建桌面一键启动脚本：

<details>
<summary>点开复制提示词</summary>

```text
请帮我在当前目录启动 Pentou（一个本地优先的 AI 对话管理器），并确保以后可以一键启动。

目标命令：
npx -y @startist/pentou@latest

请严格按以下步骤执行：

1. 环境检查：确认 node、npm、npx 是否可用，node 版本是否 >= 20。
2. 执行目标命令。如果失败，不要停在报错处，请判断原因并处理，直到命令可以成功执行：
   - 缺少 Node.js 或版本过低：按我当前的操作系统安装或引导我安装 LTS 版本；
   - 网络 / registry 超时：尝试配置可用的 npm 镜像源后重试；
   - 权限、缓存、PATH 或 npm 配置问题：修复后重试；
   - 每次修复后重新运行目标命令验证，直到成功。
3. 启动成功的判定标准：终端出现访问地址（形如 http://127.0.0.1:7766），且浏览器能打开该页面。
   如果浏览器没有自动打开，把终端里的访问地址完整复制给我。
4. 在我的桌面创建一个一键启动脚本，供以后直接启动：
   - macOS：创建可双击的 .command 脚本（记得 chmod +x）；
   - Windows：创建 .bat 脚本；
   - Linux：创建可执行的 .sh 脚本；
   - 脚本逻辑：进入本次启动所用的数据目录，然后执行 npx -y @startist/pentou@latest。
5. 实际运行一次这个脚本，确认它能正确启动 Pentou（验证后可以停止服务）。
6. 最后用简洁的中文告诉我：
   - Pentou 的访问地址；
   - 数据保存在哪个文件夹（备份时复制它即可）；
   - 桌面脚本的完整路径，以及以后双击哪个文件启动。

注意：不要安装与上述目标无关的任何软件；不要修改与 Node.js / npm 无关的系统配置。
```

</details>

想自己动手的话，[`docs/user-guide.md`](./docs/user-guide.md) 里有三平台的桌面脚本写法与 FAQ；想跑源码或提 PR 见 [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md)。

---

## 文档导航

| 文档 | 用途 |
| --- | --- |
| [`docs/pentou-introduction.md`](./docs/pentou-introduction.md) | 产品介绍与能力说明 |
| [`docs/user-guide.md`](./docs/user-guide.md) | 本机 `npx` 用户指南 |
| [`docs/auto-collect-guide.md`](./docs/auto-collect-guide.md) | 自动采集指南（CLI 采集器 + 浏览器插件） |
| [`docs/cli-doc-push-guide.md`](./docs/cli-doc-push-guide.md) | 使用 CLI 上传文档指南（项目 Markdown → 文档平面） |
| [`docs/agent-skills/README.md`](./docs/agent-skills/README.md) | 面向用户的 Agent Skill（自然语言推文档，可整夹复制） |
| [`docs/releases.md`](./docs/releases.md) | 版本发布说明 |
| [`docs/deployment.md`](./docs/deployment.md) | Docker 部署与反代 |
| [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) | 贡献指南 |
| [`docs/SECURITY.md`](./docs/SECURITY.md) | 安全策略与漏洞报告 |

---

## 协议

[MIT](./LICENSE) © 2026 STArtppt

---

<div align="center">

**PenTou — 停止碎片化对话，开始构建属于你的 AI 知识资产。**

</div>
