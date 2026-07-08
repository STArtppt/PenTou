# PenTou 笔头

[English](./README.en.md) | 简体中文

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/platform-linux%2Famd64%20%7C%20linux%2Farm64-blue.svg)
![npm](https://img.shields.io/npm/v/@startist/pentou?label=npm)

PenTou 是一款本地优先的 AI 对话管理器，用来收集、整理、检索和再加工散落在 ChatGPT、Claude、DeepSeek、Gemini、Doubao、Qianwen、Codex 等工具里的 AI 对话。

它的核心取舍很简单：有价值的 AI 对话不应该只躺在某个平台的聊天列表里，而应该变成你自己电脑上的 Markdown 资产。你可以用 PenTou 浏览、搜索、批注、改写，也可以直接用 VS Code、Obsidian、Git 或任何文本工具接管这些文件。

## 快速开始

本机单人使用，推荐直接用 npx 启动。无需克隆仓库，也无需安装 pnpm。

```bash
npx -y @startist/pentou@latest
```

启动后浏览器会自动打开 `http://127.0.0.1:7766`。数据默认保存在当前目录的 `pentou-data/` 中，再次在同一目录运行会继续使用原有数据。

常用参数：

```bash
npx -y @startist/pentou@latest --port 8899
npx -y @startist/pentou@latest --data-dir ~/Pentou
npx -y @startist/pentou@latest --host 0.0.0.0 --password your-password
```

安全边界：

- 默认只监听 `127.0.0.1`，仅本机可访问，因此不强制登录。
- 一旦绑定到非回环地址，必须同时设置 `--password`。
- 服务器、NAS、公网访问场景建议使用 Docker，并放在自己的反向代理之后。

完整的一键启动教程见 [docs/user-guide.md](./docs/user-guide.md)。

## 让 AI 替你完成

如果你完全没有编程基础，可以把下面整段提示词复制给任意 AI Agent（Claude Code、Cursor、Codex 等），让它替你检查环境、处理报错、启动 Pentou 并创建桌面脚本：

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

## 当前亮点

### 本地 Markdown 仓库

PenTou 会把对话、文档和 AI 侧边栏会话保存到本地数据目录。对话文件是可读、可迁移、可 Git 化的 Markdown：

```markdown
---
id: conv_...
title: ...
platform: ChatGPT
date: 2026-05-12T...
folderId: ...
---

## User

...

## AI

...
```

你不需要相信某个专有数据库会永远可用。备份就是复制整个数据目录，迁移就是把目录搬到另一台机器后重新启动。

### 多源 AI 对话导入

PenTou 已经支持把多种来源统一收进同一个本地仓库：

| 来源 | 输入形式 | 处理方式 |
| --- | --- | --- |
| ChatGPT 官方导出 | `conversations.json` | 沿活跃分支还原消息流 |
| DeepSeek 导出 | `conversations.json` | 还原请求、回答和思考内容 |
| CLI 工具日志 | `.jsonl` | 解析 Claude CLI、Codex 等逐行日志 |
| Markdown 归档 | `.md` | 识别 frontmatter 与角色标题 |
| 平台分享链接 | URL | 服务端抓取并解析分享页内容 |

导入时会做规范化、去重和增量合并。重复导入同一批内容不会制造一堆副本；当新导出包含更完整的上下文时，PenTou 会合并到原对话并保留版本记录。

### 搜索、组织和长文导航

- 文件夹树形组织，支持创建、重命名、移动和归类。
- 对话与文档统一检索，支持全文搜索；配置嵌入模型后可启用混合检索。
- 长对话右侧自动生成问题大纲，点击即可跳到对应轮次。
- Markdown、代码块、Mermaid 图和图片资源都按阅读场景优化渲染。

### 对话到文档的加工闭环

PenTou 不只是归档工具。你可以把对话沉淀成文档，再继续批注和重写：

- 从对话生成结构化文档。
- 把高价值消息摘录为文档片段。
- 导入 Markdown、CSV、XML 等本地文件；配置外部转换器后可扩展到更多文档格式。
- 在阅读模式中高亮和评论，批注会作为 sidecar 数据持久化。
- 用批注驱动 AI 重写，生成新版本，并可在版本历史中回滚。

### 常驻 AI 侧边栏

应用内置本地持久化的 AI 侧边栏会话：

- 可以围绕当前对话或文档追问。
- 多会话保存到 `data/ai-chats/`，不污染导入语料。
- 侧边栏产出可以继续转为文档，进入批注、重写、版本和归档流程。

### 私有化部署与单人密码保护

生产模式支持单人密码登录、会话 Cookie、失败节流和反向代理部署。适合把 PenTou 放到 NAS、家用服务器或自己的云主机上，作为长期运行的私人 AI 对话库。

## Docker 部署

将 PenTou 作为长期服务运行：

```bash
mkdir -p /srv/pentou/data

docker run -d \
  --name pentou \
  --restart unless-stopped \
  -p 127.0.0.1:7766:7766 \
  -e PENTOU_PASSWORD='your-strong-password' \
  -v /srv/pentou/data:/app/data \
  ghcr.io/startppt/pentou:latest
```

建议通过 Caddy、Nginx、Nginx Proxy Manager 或 Traefik 负责 TLS 与域名。完整部署指南、反代配置、备份恢复、升级回滚和故障排查见 [docs/deployment.md](./docs/deployment.md)。

Docker 镜像支持：

- `linux/amd64`
- `linux/arm64`
- 非 root 运行
- 数据卷与应用镜像分离

## 数据目录

常见目录结构：

```text
pentou-data/
  conversations/
  documents/
  ai-chats/
  assets/
  search/
```

你可以把整个目录用于：

- 本地备份
- 跨设备迁移
- Git 版本管理
- Obsidian 或其他 Markdown 工作流

## 本地开发

前置条件：

- Node.js 20 或更高版本
- pnpm

安装依赖并启动开发服务：

```bash
pnpm install
pnpm dev
```

开发模式默认不启用登录，便于本机调试。

生产模式本机验证：

```bash
PENTOU_PASSWORD='your-password' DATA_DIR='./data' pnpm build:all
pnpm start
```

测试：

```bash
pnpm test
```

## 技术栈

- React + Vite + Tailwind CSS v4
- React Markdown + Mermaid
- Node.js 本地服务层
- Markdown frontmatter 文件存储
- better-sqlite3 用于本地索引能力
- Docker multi-arch build
- npm npx launcher

## 文档

- [npx 一键启动指南](./docs/user-guide.md)
- [完整部署指南](./docs/deployment.md)
- [产品介绍](./docs/pentou-introduction.md)
- [贡献指南](./CONTRIBUTING.md)
- [安全策略](./SECURITY.md)

## 协议

[MIT](./LICENSE) © 2026 STArtppt
