# PenTou 笔头 — AI Conversation Manager

[English](./README.en.md) | 简体中文

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/platform-linux%2Famd64%20%7C%20linux%2Farm64-blue.svg)

**PenTou (笔头)** 是一款轻量、本地优先的 AI 对话管理器，旨在帮助您安全、高效地沉淀和整理跨平台的 AI 对话记录。“好记性不如烂笔头”，PenTou 可以将您的灵感碎片固化为可管理的本地资产。

## ✨ 核心特性

- **📂 本地优先 (Local-First)**: 所有数据全部**以原生 Markdown (`.md`) 格式**安全保存在您本地的 `data/conversations/` 文件夹中。不依赖厚重的云端数据库，数据完全归属于您。
- **🚀 自动识别与抓取**:
  - **网页分享解析**: 复制并粘贴 DeepSeek 等平台的共享链接，内置服务端插件可绕过跨域限制 (CORS)，直接提取对话并生成 Markdown。
  - **导出库处理**: 直接上传或拖拽 ChatGPT 批量导出的 `conversations.json` 文件或各种 `.jsonl` 日志，PenTou 将自动切分出每次对话。
- **🏷 动态数据整理**:
  - 侧边栏支持文件夹树形分类 (可自由移动/创建/重命名)。
  - 对话数据利用 Markdown **Frontmatter** 原生存储元信息（平台标识、交互时间等）。
- **🌗 极致纯净的 UI 体验**:
  - 精美的暗黑/明亮双主题模式无缝切换。
  - 原生代码高亮、一键复制。
  - 右侧提供智能的时间轴/问答节点**滚动定位刻度**，快速穿梭长篇历史对话。

## 🛠 技术架构

该应用维持了轻量级的全栈体验，前后端同构在单一的开发环境中：
- **前端核心**: React + Tailwind CSS (v4) + Vite
- **本地网关 (Vite Server Plugin)**: 利用 Node.js `fs` 原生接口搭建 Express 风格的本地中间件，接管所有本地 I/O 和跨域请求代理。
- **渲染引擎**: React Markdown, Framer Motion (精美微交互)

## 🐳 Docker 一键部署（推荐）

将 PenTou 作为长期运行的私人服务部署到云主机或家用 NAS：

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

容器只暴露 HTTP（默认 7766），TLS / 域名通过你自己的反代（Caddy / Nginx / NPM / Traefik）挂载。完整部署指南、反代配置示例、备份恢复与故障排查见 [`docs/deployment.md`](./docs/deployment.md)。

- 支持架构：`linux/amd64` + `linux/arm64`（NAS 群晖 / 极空间通用）
- 默认非 root（uid 1000），数据卷与代码彻底解耦
- 升级 = `docker pull && docker compose up -d`；数据不动

## 📦 本地开发

确保您已经在机器上安装了 [Node.js](https://nodejs.org/) 与 [pnpm](https://pnpm.io/)。

1. **安装依赖**

   ```bash
   pnpm install
   ```

2. **启动开发服务**

   ```bash
   pnpm dev
   ```

   开发模式**不接入鉴权**（本地直连无远程访问风险），方便快速迭代。

3. **进入应用**

   打开终端提示的本地地址 (如 `http://localhost:5173/`)。点击 **"Import"** 导入您的第一个 AI 对话。

### 生产模式本机验证

```bash
PENTOU_PASSWORD='your-password' DATA_DIR='./data' pnpm build:all && pnpm start
# 浏览器打开 http://localhost:7766/，会被引导到 /login
```

## 📖 文档

- [完整部署指南](./docs/deployment.md) — 反代配置 / 备份恢复 / 故障排查
- [贡献指南](./CONTRIBUTING.md) — 如何提 Issue / PR
- [安全策略](./SECURITY.md) — 漏洞披露流程

## 📜 协议

[MIT](./LICENSE) © 2026 STArtppt

