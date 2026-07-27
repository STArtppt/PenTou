# PenTou — A Local-First Knowledge Base for AI Conversations

English | [简体中文](./README.md)

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/platform-linux%2Famd64%20%7C%20linux%2Farm64-blue.svg)
![npm](https://img.shields.io/npm/v/@startist/pentou?label=npm)

> **The palest ink beats the best memory.**
> Turn AI conversations scattered across ChatGPT, Claude, DeepSeek, Cursor, Codex and Copilot into local knowledge that is **searchable, editable, and portable**.

**Status: ready for daily use.** One command gets it running on your machine. Capture, search, distillation into documents, follow-up Q&A, and self-hosted deployment form a complete loop — this is a workbench you can use every day, not a demo.

```bash
npx -y @startist/pentou@latest
```

Data lands in `pentou-data/` in the current directory. It listens on localhost only, so no password is required. Full walkthrough: [`docs/user-guide.md`](./docs/user-guide.md) (in Chinese).

![PenTou main window: platform folder sidebar on the left, conversation body in the middle, docked AI chat panel on the right](./assets/demo/screenshot-Chats-main-interface.png)

<sub>The three-pane window: platform folders with counts · conversation body · a docked AI panel that already carries the open conversation as context</sub>

---

## Why it's worth using now

| Pain point | What PenTou does |
| --- | --- |
| Conversations scattered across a dozen platforms | **One inbox**: export files, share links, automatic CLI capture, browser extension |
| You know you discussed it, but can't find it | **Local full-text plus optional semantic search**, jump-and-highlight across conversations and documents |
| Long threads never become knowledge | **Conversation → document → annotation → AI rewrite → push to Obsidian** |
| Data sits in the cloud and won't come out | **Plain Markdown on disk**, consumable directly by VS Code, Git or Obsidian |
| Deployment is a project in itself | **One `npx` command** locally, or **Docker** for self-hosting, with data portable between instances |

---

## Core capabilities

### 1. Multi-source capture: archived as it happens

- **Manual import**: ChatGPT / DeepSeek JSON exports, assorted `.jsonl` files, Markdown, and platform share links. Drop them in as a batch — one bad file won't sink the rest.
- **CLI collector**: watches desktop agent sessions and reports them automatically, covering Claude Code, Codex, Cursor, Copilot, OpenCode, Hermes, Grok CLI and more. `pull` for batches, `watch` for incremental updates.
- **Browser extension**: dumb capture in the page; parsing and deduplication happen server-side.
- **Ingest gateway**: idempotent upserts, secret redaction, and automatic slimming of oversized sessions — syncing repeatedly won't litter your library with duplicates.
- **Auto-filing on import**: conversations land in the folder matching their platform, so there's less to tidy by hand.

![Import panel: drag in export files, paste a share link, and set up the CLI collector or browser extension](./assets/demo/screenshot-Import-interface.png)

<sub>One panel for all four channels — platform exports, share links, CLI collector, browser extension — each listing the platforms it already supports</sub>

### 2. Local Markdown as the source of truth

Each conversation is a Markdown file (frontmatter plus message body) under your data directory: `pentou-data/conversations/<id>.md` when launched via npx, `data/conversations/<id>.md` from source or in Docker. The index can be rebuilt at any time; the directory can be put under Git, backed up wholesale, or copied to another machine.

### 3. Search and rework

- **Hybrid search**: SQLite FTS5 full-text by default, plus an optional embedding-based semantic path, fused with RRF ranking.
- **Document loop**: one-click conversion to a document, message excerpts, and MinerU parsing for PDF / Docx / PPTX. Annotations drive AI rewrites, and every version can be rolled back.
- **AI sidebar**: ask questions against the current conversation or document (bring your own key); answers can be saved back as documents.
- **Obsidian export**: push finished material into your permanent knowledge base.

![Document view: body text centred, an auto-generated outline on the right, and a toolbar for editing, AI rewriting, version history and Obsidian export](./assets/demo/screenshot-Docs-main-interface.png)

<sub>The document view (shown with the Chinese UI): an auto-generated outline on the right, and the whole rework loop in one toolbar — edit, AI rewrite, version history, push to Obsidian, ask AI</sub>

### 4. A product you can actually live in

- Three-pane layout — folder sidebar, conversation/document body, question outline — with light and dark themes in English and Chinese.
- Syntax highlighting, Mermaid diagrams, localized image assets, and a lightbox viewer.
- Settings, import and search all have adapted layouts on desktop **and mobile**.
- The UI runs on a unified design system; batch selection, drag-to-file, and time sorting are all in place.

### 5. Three deployment shapes, with portable data

| Shape | Who it's for | Entry point |
| --- | --- | --- |
| **Local `npx`** | Personal daily use, zero ops | `npx -y @startist/pentou@latest` → [`docs/user-guide.md`](./docs/user-guide.md) |
| **Docker** | Long-running service on a NAS or cloud host | [`docs/deployment.md`](./docs/deployment.md) |
| **From source** | Contributors and forks | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |

Instances support **one-click migration** (push / pull with a diff preview), so moving from a trial to a permanent setup, syncing across machines, or pulling from the cloud back to your laptop never requires copying files by hand. Migration is at R1: it works, but acceptance against two real instances, resume-after-interruption and streaming transfer for large media libraries are still being filled in.

---

## 30 seconds to first run

```bash
# 1. Node.js >= 20 is required
node -v

# 2. Run this in whichever directory should hold your data
npx -y @startist/pentou@latest

# 3. Open the address printed in the terminal (http://127.0.0.1:7766 by default)
# 4. Click Import for your first conversation, or set up the CLI collector / browser extension
```

Docker (self-hosted service):

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

The image supports `linux/amd64` and `linux/arm64`. Anything exposed to the internet must terminate TLS at your own reverse proxy — see [`docs/deployment.md`](./docs/deployment.md) for the full story.

---

## Let an AI agent do it for you

You don't need to write a line of code to install this. Paste the prompt below into any AI agent (Claude Code, Cursor, Codex, …) and let it check your environment, work through any errors, start PenTou, and leave a one-click launcher on your desktop:

<details>
<summary>Click to copy the prompt</summary>

```text
Please start Pentou (a local-first AI conversation manager) in the current directory,
and make sure I can start it with one click from now on.

Target command:
npx -y @startist/pentou@latest

Follow these steps strictly:

1. Environment check: confirm node, npm and npx are available, and that node is >= 20.
2. Run the target command. If it fails, do not stop at the error — diagnose and fix it,
   then retry until the command succeeds:
   - Node.js missing or too old: install (or walk me through installing) the LTS release
     for my operating system;
   - Network / registry timeouts: configure a working npm mirror and retry;
   - Permission, cache, PATH or npm config problems: fix them and retry;
   - Re-run the target command after every fix until it works.
3. Success means: the terminal prints an address (like http://127.0.0.1:7766) and that page
   opens in a browser. If the browser does not open by itself, give me the full address.
4. Create a one-click launcher on my desktop for future use:
   - macOS: a double-clickable .command script (remember chmod +x);
   - Windows: a .bat script;
   - Linux: an executable .sh script;
   - The script should cd into the data directory used for this run, then execute
     npx -y @startist/pentou@latest.
5. Actually run that script once to confirm it starts Pentou (you can stop the server after).
6. Finally, tell me in plain language:
   - the address where Pentou is running;
   - which folder holds my data (copying that folder is my backup);
   - the full path of the desktop script, and which file to double-click next time.

Do not install anything unrelated to the goal above, and do not change system configuration
unrelated to Node.js / npm.
```

</details>

Prefer doing it yourself? [`docs/user-guide.md`](./docs/user-guide.md) (Chinese) has the desktop launcher scripts for all three platforms plus an FAQ. To run from source or open a PR, see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/product-intro.md`](./docs/product-intro.md) | Short product introduction, for sharing (Chinese) |
| [`docs/pentou-introduction.md`](./docs/pentou-introduction.md) | Full product introduction and capability reference (Chinese) |
| [`docs/user-guide.md`](./docs/user-guide.md) | Local `npx` user guide (Chinese) |
| [`docs/deployment.md`](./docs/deployment.md) | Docker deployment and reverse proxy (Chinese) |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Contribution guide |
| [`SECURITY.md`](./SECURITY.md) | Security policy and vulnerability reporting |

---

## Who it's for

- Heavy users working across several AI products daily who need **one place to keep and re-find** everything
- **Knowledge workers** turning conversations into articles, proposals and notes
- Developers running Claude Code / Cursor / Codex who want sessions **archived automatically**
- Privacy-minded people who insist on owning their data rather than renting it from a cloud
- Anyone already living in an Obsidian / Markdown / Git workflow

---

## Design tradeoffs

| Chosen | Rejected | Why |
| --- | --- | --- |
| Local Markdown | Proprietary cloud store | The data belongs to you, and the tooling is universal |
| One file per conversation | A single monolithic library file | Easy to back up, diff and migrate |
| Bring your own key | A built-in paywalled model | You control both cost and privacy |
| A small purpose-built backend | A heavyweight framework | One repo runs the whole thing end to end |

> **PenTou — stop fragmenting your conversations, start building your own AI knowledge base.**

---

## License

[MIT](./LICENSE) © 2026 STArtppt
