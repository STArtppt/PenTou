# PenTou 笔头 —— 本地优先的 AI 对话知识库

> 把散落在各平台的 AI 对话，变成**可检索、可加工、可迁移**的本地资产。  
> **现在已经具备日常高可用价值**——不是概念原型，是可以天天打开的工作台。

**产品成熟度：日常高可用。**  
从「一条命令启动」到「多源自动采集 → 检索 → 文档提炼 → AI 再问答 → 私有部署 / 实例迁移」，主路径已贯通，适合作为个人 AI 对话的**默认归档与加工工作台**。

---

## 一句话

**PenTou（笔头）** 是本地优先的 AI 对话知识库：多源采集入库、全文/语义检索、对话提炼为文档、上下文 AI 问答，数据以原生 Markdown 落在你自己的机器上。

取名来自「好记性不如烂笔头」——灵感与方案不该只活在某个平台的历史记录里。

---

## 为什么是 PenTou

如果你日常在 ChatGPT、Claude、DeepSeek、Gemini、Cursor、Copilot、Codex、Claude Code 之间频繁切换，会很快意识到三个痛点：

1. **对话散落**：每个平台一套历史记录，账号注销、服务下线、平台改版都可能让一段灵感悄无声息地丢失。
2. **难以再加工**：平台原生 UI 是给「聊天」设计的，不是给「知识管理」设计的——没有跨平台文件夹、没有统一搜索、没法对长对话做摘要或重写。
3. **数据不归你**：所谓的「历史记录」放在云上，导不出、改不动、搜不到。

核心设计原则：

> **数据归用户所有，以原生 Markdown 形式存储在本地文件系统中。**

没有专有数据库锁定、没有强制云服务——你随时可以用 VSCode、Obsidian、Git 直接消费这些 `.md` 文件。

---

## 你现在就能用到的价值

### 1. 一条命令，本机即用

```bash
npx -y @startist/pentou@latest
```

无需 Git、无需构建；数据在 `pentou-data/`，默认仅本机访问。  
长期服务可上 Docker（NAS / 云主机）；两种形态数据可互迁。详见 [user-guide.md](./user-guide.md)、[deployment.md](./deployment.md)。

### 2. 对话不再散落

| 方式 | 价值 |
| --- | --- |
| 导出文件 / 分享链接导入 | 历史资产一次性归仓 |
| CLI 自动采集 | Claude Code、Codex、Cursor、Copilot、OpenCode、Hermes、Grok 等桌面会话「发生即归档」 |
| 浏览器插件 | 网页对话哑采集，服务端统一解析与去重 |
| 平台自动归类 | 导入后按产品落入文件夹，少做手工整理 |
| CLI 文档推送 | 仓库里的 Markdown 进文档平面，按项目分组；`watch` 可常驻同步 |

### 3. 找得到、用得上

- **本地全文检索**（SQLite FTS5）跨对话与文档，点击直达并高亮  
- **可选语义检索**：用自己的 embedding Key，模糊回忆也能命中  
- **AI 侧边栏**：基于当前对话/文档追问，回答可再存成文档（BYOK）  
- **顶栏来源属性**：一眼区分网页 / 终端 / 手工采集，以及文档「来自对话 / 终端 / 导入」

### 4. 从聊天记录到知识资产

**导入 / 采集 → 浏览整理 → 摘录或一键转文档 → 批注 → AI 重写（带版本）→ 推送 Obsidian**

PDF / Docx / PPTX 等外部资料也可经 MinerU 解析入库，与 AI 对话放在同一知识平面。

### 5. 数据真正归你

- 一对话一 Markdown，无专有数据库锁定  
- 可用 VSCode、Obsidian、Git 直接打开数据目录  
- 不强制上传云端；LLM 与 embedding 均为自带 Key  
- 多实例之间可一键推送 / 拉取迁移

---

## 能力地图（当前已落地）

```text
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  多源采集     │   │  统一仓库     │   │  再加工       │
│ 导入/CLI/插件 │ → │ Markdown+FTS │ → │ 文档/批注/AI  │
└──────────────┘   └──────────────┘   └──────┬───────┘
                                             ↓
                                    Obsidian / Git / 备份
```

| 能力域 | 已具备 |
| --- | --- |
| 采集 | 多格式导入、分享链接、Ingest 幂等、CLI 多源、浏览器插件、超限降级、CLI 文档推送 |
| 组织 | 文件夹、文档项目维度、批量选择、自动归类、时间排序、品牌图标 |
| 检索 | 全文 + 可选混合语义、命令面板、跳转高亮 |
| 加工 | 转文档、摘录、MinerU、批注重写、版本历史、AI 侧边栏 |
| 体验 | 明暗主题、中英、Mermaid、图片灯箱、手机端浏览布局；顶栏来源属性（采集方式 / 项目 / 文档来源） |
| 部署 | npx、Docker amd64/arm64、实例间一键迁移 |

---

## 能力详解

### 1. 多源对话导入

| 来源 | 输入形式 | 处理方式 |
| --- | --- | --- |
| ChatGPT 官方导出 | `conversations.json` / ZIP | 沿 `mapping` 活跃分支还原消息流；图片资产本地化 |
| DeepSeek 导出 | `conversations.json` | 还原 REQUEST / RESPONSE / THINK；思考链转为引用块 |
| CLI / Agent 日志 | `.jsonl` 等 | 按平台 normalizer 解析角色与工具消息 |
| IDE / 脚本产物 | `.md`（含 frontmatter） | 按角色标题边界切分 |
| 平台分享链接 | URL（DeepSeek 等） | 后端双轨抓取：API 优先，渲染降级，绕过 CORS |

**一次能拖入多个文件**，单个失败不中断同批次。导入后按**默认 AI 产品清单自动归入平台文件夹**。

### 2. AI 对话自动采集（发生即归档）

- **Ingest Gateway**（`POST /api/ingest`）：token 鉴权；以平台 + 外部 ID 幂等 upsert；密钥脱敏；CORS 对采集端点友好。
- **CLI Collector**（`pentou collect init/pull/watch`）：
  - 文件型：Claude Code、Codex、Grok CLI、Copilot VS Code 会话文件、waylog 等  
  - 查询型：OpenCode、Copilot、Hermes、Cursor 等本地 SQLite 会话库  
  - 超大会话：超限时本地降级解析 / 确定性瘦身后再上报  
- **浏览器扩展（MV3）**：网页端捕获原始数据，服务端统一解析入库。

归一原则：**一厂商一主产品文件夹**；CLI / 桌面壳等形态差异用顶栏徽章区分，避免文件夹爆炸。

操作指南：[auto-collect-guide.md](./auto-collect-guide.md)。

### 3. CLI 文档推送与项目维度

`pentou collect push docs` / 登记 `--docs-dir` 后 `pull`·`watch`：把项目目录里的 Markdown 推入**文档平面**，按 git 仓库（或显式 `--doc-project`）落到「项目」维度；与对话采集共用令牌与 Ingest 通道。

操作指南：[cli-doc-push-guide.md](./cli-doc-push-guide.md)。

### 4. 本地 Markdown 存储

```text
data/conversations/<id>.md   # 或 npx 形态下的 pentou-data/conversations/
```

结构为人类可读的 frontmatter + 消息正文（含逐条时间戳保真）。**Markdown 是唯一权威数据源**——检索索引可随时重建。文档、AI 侧边栏会话、图片资产、文件夹元数据均在同一数据根下：**拷贝数据目录 = 拷贝你的库**。

### 5. 全文与语义混合检索

- **全文检索**：本地 SQLite FTS5 + BM25，跨对话与文档召回，带片段与跳转高亮。
- **语义检索（可选）**：配置 OpenAI 兼容 `/embeddings` 后支持模糊语义提问；关键词与语义双路经 RRF 融合。Key 在服务端持久化且不回显。

### 6. 沉浸式浏览与列表体验

- **左侧栏**：对话 / 文档双 Tab、文件夹树、**文档项目**下拉、拖拽分类、批量选择、时间排序、关键词过滤、明暗主题与中英文切换。
- **中央区**：气泡阅读；代码高亮与一键复制；Mermaid 预览；图片灯箱。
- **内容顶栏（属性徽章）**：对话与文档统一双行布局——标题一行，第二行展示「更新于」与来源徽章。对话侧：品牌/形态、**采集方式**（网页 / 终端 / 手工）、有 cwd 时的**项目**；文档侧：来源三态（来自对话 / 来自终端 / 来自导入）。
- **右侧导航**：基于 User 提问的大纲，点击滚动定位。
- **手机端**：`< md` 下提供顶栏 + 抽屉侧栏 + 底部 Sheet + 全屏搜索（顶栏属性徽章为桌面路径）。

### 7. 对话 → 文档：知识沉淀闭环

| 入口 | 行为 |
| --- | --- |
| **一键转文档** | 调用你配置的 LLM（BYOK，OpenAI 兼容），把整段对话重写为结构化文档 |
| **消息摘录** | 不依赖 LLM，高价值片段按模板写入同源文档 |
| **外部资料导入** | MinerU：PDF / Docx / PPTX 等高质量转 Markdown；本地 `.md` 等直接入库 |

### 8. 阅读、批注、AI 重写

- **阅读模式**：选中文字高亮、评论；批注 sidecar 持久化。  
- **编辑模式**：Markdown 所见即所得编辑。  
- **批注驱动重写**：多条批注作为修订意见交给 LLM，生成新版本并保留历史，可对比与回滚。  
- **导入去重与版本**：同一对话再次导入时合并 / 跳过 / 新版本策略清晰。

### 9. AI 问答侧边栏

- **上下文感知**：默认携带当前对话 / 文档，也可临时关闭。  
- **多会话持久化**：独立存于 `data/ai-chats/`，不污染导入语料。  
- **生成即沉淀**：回答可一键转文档。  
- 桌面常驻 dock；移动端为 FAB + 底部抽屉。

### 10. 推送到 Obsidian

PenTou 专注**采集与加工**；长期归档可交给 Obsidian。一键推送经 `obsidian://` URI 唤起 Vault；超长内容自动降级剪贴板。

### 11. 安装、部署与迁移

**本机一键（推荐入门）**——Node.js ≥ 20：

```bash
npx -y @startist/pentou@latest
```

- 自动打开浏览器；端口占用时换相邻端口  
- 数据在启动目录 `pentou-data/`  
- 默认绑定 `127.0.0.1`、免登录；对外暴露须 `--host` + `--password`  
- 零基础用户可参考 [user-guide.md](./user-guide.md)

**Docker 私有化**——NAS / 云服务器长期服务：

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

- `linux/amd64` + `linux/arm64`  
- 非 root、数据卷与代码解耦  
- TLS / 域名由你的反代承担；详见 [deployment.md](./deployment.md)

**一键迁移**：设置页完成端到端推送 / 拉取——填写对端 → 预览差异 → 执行。数据在用户自有实例间直连，不经第三方中转。迁移能力目前是 R1：功能可用，真实双实例验收、中断续传与大媒体库流式传输仍在补。

---

## 适合谁

- **AI 重度用户**：每天跨 ChatGPT / Claude / DeepSeek / 各类 Agent 工作  
- **开发者**：需要把 agent 会话与技术方案自动归档、可搜可回滚  
- **知识工作者 / 创作者**：从长对话里提炼文章、策划与笔记  
- **隐私敏感用户**：坚持本地自持，拒绝对话被第三方云库绑架  
- **Obsidian / Markdown 用户**：希望 AI 产出无缝并入既有知识库  

非技术用户也可：装好 Node.js LTS 后一条 `npx`，或把 [user-guide.md](./user-guide.md) 里的提示词交给 AI Agent 代劳。

| 角色 | 立刻可用的价值 |
| --- | --- |
| AI 重度用户 | 跨平台统一留存与回查，不再只靠各站历史 |
| 非技术用户 | 一条 `npx` 或让 AI Agent 代启，本机私有 |
| 知识工作者 / 创作者 | 对话作素材池，提炼文章与笔记 |
| 开发者 / Agent 用户 | CLI 自动归档技术方案与长会话；文档推送按仓库进项目 |
| 隐私敏感者 | 数据自持，BYOK，无强制云端 |
| Obsidian 用户 | 加工后无缝并入 Vault |

---

## 设计原则

1. **本地优先**：Markdown 是权威数据源，索引只是可重建的派生物  
2. **工具中立**：不为锁死用户而做专有格式  
3. **BYOK**：模型与向量由你选择，无强制付费墙  
4. **够用即美**：聚焦「采集 → 找回 → 提炼 → 流转」，不做大而全社交产品  

| 选择 | 不选择 | 原因 |
| --- | --- | --- |
| 本地 Markdown 文件 | 专有数据库 | 数据归属用户，工具链通用 |
| 一对话一文件 | 单一巨型索引文件 | 易备份、易 diff、易迁移 |
| BYOK 自带 Key | 内置模型 / 付费墙 | 成本与隐私完全可控 |
| 自研轻量后端 | 重型框架 | 单一仓库即可端到端运行 |
| Spec 驱动开发 | 直接堆功能 | 每个能力可追溯、可评审 |

---

## 后续规划（在已可用基座上演进）

主路径已可用；下列方向继续加深，不阻塞当前日常使用：

### Roadmap A：跨库提问

混合检索与 AI 侧边栏的汇合：对**全量历史**发起「汇总我所有关于 X 的讨论」类追问——从被动归档走向主动思考伙伴。

### Roadmap B：分栏对比

同屏并排打开两段对话 / 文档对照阅读（规划已评审，待实施）。

### Roadmap C：迁移与传输增强

一键迁移 R1 已落地；后续补强真实双实例验收、中断续传、大媒体库 streaming 等。

---

## 技术栈（简）

- **前端**：React + Vite + Tailwind CSS v4；UI 走统一 registry / 设计系统  
- **后端**：开发态自研 Vite 插件中间件，生产态同构的独立 Node 服务（`src/server/` → `dist-server/`），承载 I/O、导入、ingest、检索、文档、采集配置等 `/api/*`；npm 包以预构建产物分发  
- **存储**：Markdown 真相源 + SQLite FTS（及可选向量层）  
- **协作**：spec 驱动建设闭环 / debug 修复闭环，详见 [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [user-guide.md](./user-guide.md) | npx 本机用户指南 |
| [auto-collect-guide.md](./auto-collect-guide.md) | 自动采集（CLI + 浏览器插件） |
| [cli-doc-push-guide.md](./cli-doc-push-guide.md) | CLI 上传文档与项目维度 |
| [deployment.md](./deployment.md) | Docker 部署 |
| [releases.md](./releases.md) | 版本发布说明 |
| [../README.md](../README.md) | 仓库入口 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 贡献指南 |

---

> **PenTou — 停止碎片化对话，开始构建属于你的 AI 知识资产。**
