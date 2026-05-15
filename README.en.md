# PenTou — Local-First AI Conversation Manager

English | [简体中文](./README.md)

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/platform-linux%2Famd64%20%7C%20linux%2Farm64-blue.svg)

**PenTou** ("笔头", literally "pen tip") is a lightweight, **local-first** AI conversation manager. It helps you safely capture and organize chats from ChatGPT / DeepSeek / Claude / etc., turning scattered LLM exchanges into searchable, structured Markdown that lives entirely on your machine.

## ✨ Features

- **📂 Local-first**: All data stored as native Markdown (`.md`) files under `data/conversations/`. No cloud database. Your data, your disk.
- **🚀 Smart import**:
  - Paste a shared link (e.g. DeepSeek share URL) — built-in server plugin bypasses CORS and extracts the conversation as Markdown.
  - Drop a ChatGPT `conversations.json` export or `.jsonl` log — PenTou splits it into per-conversation files.
- **🏷 Folder organization**: Drag-and-drop folder tree in the sidebar. Each conversation carries platform / time metadata in YAML frontmatter.
- **🌗 Clean UI**: Dark / light themes, native code highlighting, one-click copy, right-side scroll-anchor timeline for long conversations.
- **📝 Excerpt to doc**: Highlight any chunk of a conversation and turn it into a standalone editable document.

## 🐳 Quick start with Docker (recommended)

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

The container exposes plain HTTP on port 7766 (bound to localhost only). Terminate TLS with your own reverse proxy (Caddy / Nginx / NPM / Traefik). Multi-arch image: `linux/amd64` + `linux/arm64`.

Full guide: [docs/deployment.md](./docs/deployment.md) (reverse proxy examples, backup / restore, troubleshooting).

## 🛠 Local development

```bash
git clone https://github.com/STArtppt/pentou.git
cd pentou
pnpm install
pnpm dev   # opens http://localhost:5173
```

Dev mode skips auth (safe for local-only use).

Production build verification:

```bash
PENTOU_PASSWORD='your-password' DATA_DIR='./data' pnpm build:all && pnpm start
# Visit http://localhost:7766/ → redirected to /login
```

## 🧱 Stack

- **Frontend**: React 18 + Tailwind CSS v4 + Vite 6
- **Local gateway**: Custom Vite server plugins (`pentouServerPlugin`) wrapping Node `fs` for local I/O and CORS-bypassing fetch
- **Rendering**: react-markdown + Framer Motion

## 📖 Documentation

- [Deployment guide](./docs/deployment.md)
- [Contributing](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)

## 📜 License

[MIT](./LICENSE) © 2026 STArtppt
