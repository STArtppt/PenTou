# PenTou 笔头 — 本地优先的 AI 对话知识库

[English](./README.en.md) | 简体中文

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/platform-linux%2Famd64%20%7C%20linux%2Farm64-blue.svg)
![npm](https://img.shields.io/npm/v/@startist/pentou?label=npm)

> **好记性不如烂笔头。**  
> 把散落在 ChatGPT、Claude、DeepSeek、Cursor、Codex、Copilot 等平台的 AI 对话，沉淀为**可检索、可加工、可迁移**的本地知识资产。

**当前状态：已具备日常高可用价值。** 一条命令即可在本机跑起来；采集、检索、文档提炼、AI 二次问答、私有化部署形成完整闭环——不是 demo，是可以天天用的工作台。

```bash
npx -y @startist/pentou@latest
```

数据默认落在当前目录的 `pentou-data/`，只监听本机，无需密码。完整入门见 [`docs/user-guide.md`](./docs/user-guide.md)。

---

## 为什么现在值得用

| 痛点 | PenTou 的答案 |
| --- | --- |
| 对话散落在十几个平台 | **统一入库**：导出文件 / 分享链接 / CLI 自动采集 / 浏览器插件 |
| 想回查却搜不到 | **本地全文 + 可选语义检索**，跨对话与文档一键跳转高亮 |
| 长对话难以沉淀成知识 | **对话 → 文档 → 批注 → AI 重写 → 推送 Obsidian** |
| 数据在云上、导不出 | **原生 Markdown 落盘**，可用 VSCode / Git / Obsidian 直接消费 |
| 部署门槛高 | **`npx` 本机一键** 或 **Docker 私有化**，数据可在实例间迁移 |

---

## 核心能力一览

### 1. 多源采集：发生即归档

- **手动导入**：ChatGPT / DeepSeek 导出 JSON、各类 `.jsonl`、Markdown、平台分享链接；批量拖入，单文件失败不拖垮整批。
- **CLI Collector**：监听桌面 agent 会话并自动上报——覆盖 Claude Code、Codex、Cursor、Copilot、OpenCode、Hermes、Grok CLI 等；`pull` 批量 + `watch` 差量。
- **浏览器插件**：网页端哑采集，解析与去重在服务端统一完成。
- **Ingest Gateway**：幂等 upsert、密钥脱敏、超长会话自动降级瘦身，反复同步不产生垃圾副本。
- **导入自动归类**：按平台落入对应文件夹，减少手动整理。

### 2. 本地 Markdown 即真相源

每条对话是 `data/conversations/<id>.md`（frontmatter + 消息正文）。索引可随时重建；目录可 Git 化、可整夹备份、可跨机拷贝。

### 3. 检索与再加工

- **混合检索**：SQLite FTS5 全文（默认）+ 可选 embedding 语义路，RRF 融合排序。
- **文档闭环**：一键转文档 / 消息摘录 / MinerU 解析 PDF·Docx·PPTX；批注驱动 AI 重写，版本可回滚。
- **AI 侧边栏**：基于当前对话/文档上下文即时问答（BYOK），回答可再沉淀为文档。
- **Obsidian 推送**：加工完成后一键进入你的最终知识库。

### 4. 可用的产品体验

- 三栏布局：文件夹侧栏 · 对话/文档正文 · 问题大纲导航；明暗主题、中英文。
- 代码高亮、Mermaid 图示、图片资产本地化与灯箱预览。
- 设置、导入、搜索在桌面与**手机端**均有适配布局。
- UI 基于统一设计系统，批量选择、拖拽归类、时间排序等日常操作已齐。

### 5. 三种部署形态，数据可搬家

| 形态 | 适合谁 | 入口 |
| --- | --- | --- |
| **本机 `npx`** | 个人日常、零运维 | `npx -y @startist/pentou@latest` → [`docs/user-guide.md`](./docs/user-guide.md) |
| **Docker** | NAS / 云主机长期服务 | [`docs/deployment.md`](./docs/deployment.md) |
| **源码开发** | 贡献者 / 二次开发 | 见下方「本地开发」 |

实例之间支持**一键迁移**（推送 / 拉取 + 差异预览），试用转正、多端同步、云回迁本机不必手拷文件。

---

## 30 秒上手

```bash
# 1. 需要 Node.js ≥ 20
node -v

# 2. 在你想放数据的目录执行
npx -y @startist/pentou@latest

# 3. 浏览器打开终端提示的地址（默认 http://127.0.0.1:7766）
# 4. 点 Import 导入第一条对话，或配置 CLI 采集 / 浏览器插件
```

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

## 文档导航

| 文档 | 用途 |
| --- | --- |
| [`docs/product-intro.md`](./docs/product-intro.md) | 短版产品介绍（对外分享） |
| [`docs/pentou-introduction.md`](./docs/pentou-introduction.md) | 完整产品介绍与能力说明 |
| [`docs/user-guide.md`](./docs/user-guide.md) | 本机 `npx` 用户指南 |
| [`docs/deployment.md`](./docs/deployment.md) | Docker 部署与反代 |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 贡献指南 |
| [`SECURITY.md`](./SECURITY.md) | 安全策略与漏洞报告 |

---

## 本地开发

```bash
pnpm install
pnpm dev          # http://localhost:5173 ，开发态免鉴权
```

生产模式本机验证：

```bash
PENTOU_PASSWORD='your-password' DATA_DIR='./data' pnpm build:all && pnpm start
# http://localhost:7766/
```

- **前端**：React + Vite + Tailwind CSS v4  
- **后端**：自研 Vite 插件中间件（本地 I/O、导入解析、ingest、检索等）  
- **存储**：Markdown 文件 + SQLite FTS（索引可重建）

测试：

```bash
pnpm test
```

---

## 适合谁

- 每天跨多个 AI 产品工作、需要**统一留存与回查**的重度用户  
- 要把对话提炼成文章、方案、笔记的**知识工作者**  
- 用 Claude Code / Cursor / Codex 等 agent、希望会话**自动归档**的开发者  
- 坚持数据自持、拒绝云端锁定的隐私敏感用户  
- 已有 Obsidian / Markdown / Git 工作流的人  

---

## 设计取舍

| 选择 | 不选择 | 原因 |
| --- | --- | --- |
| 本地 Markdown | 专有云库 | 数据归属用户，工具链通用 |
| 一对话一文件 | 巨型单一库文件 | 易备份、易 diff、易迁移 |
| BYOK | 内置付费模型墙 | 成本与隐私由你掌控 |
| 轻量自研后端 | 重型框架 | 单仓即可端到端运行 |

> **PenTou — 停止碎片化对话，开始构建属于你的 AI 知识资产。**

---

## 协议

[MIT](./LICENSE) © 2026 STArtppt
