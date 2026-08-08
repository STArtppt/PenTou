---
name: pentou-docs-push
description: >-
  Push local project Markdown into Pentou's document plane via CLI.
  Trigger when the user says: 推送到 pentou / push docs / 把本地项目或目录的 Markdown
  入库 / 整仓文档入库 / 排除目录后推送 / 帮我推 markdown 到笔头.
version: "1.0.0"
---

# pentou-docs-push

用自然语言驱动 `npx @startist/pentou push docs`，把本机项目里的 Markdown 推入 Pentou 文档平面。

**运行环境**：用户自己的任意项目（不依赖 Pentou 源码仓库）。本技能只依赖公开 CLI 契约。

**入口命令**（本机已装全局 CLI 时可用 `pentou` 代替）：

```bash
npx -y @startist/pentou@latest push docs <dir> [flags]
```

---

## 强制四段闸门

**禁止**在未获用户确认时执行正式上传。顺序固定：

### 1. 侦察

根据用户给出的路径（及可选 server/token）查看：

- 顶层目录结构；是否 git 仓库
- 是否已有 `docs/`、`skills/`（或 `**/SKILL.md`）、`openspec/`、顶层 `README*.md`
- 本机是否已有 `~/.pentou/collector.json`（server/token/exclude）

### 2. 闸门 A — 建议并确认（必须停等）

即使用户没提排除，也必须给出建议并等确认。不得静默全仓盲推。

输出可勾选清单，至少包括：

| 项 | 内容 |
| --- | --- |
| 推送根 | 仓库根，或收窄到 `docs/` 等 |
| 建议排除 | glob 列表（见下方启发式） |
| 建议保留 | 将推送的文档区域说明 |
| 标题副作用 | 收窄根会改变侧栏标题（见「推送根与标题」） |

**默认倾向排除**（目录存在时再建议；部分已是内置跳过，仍可说明）：

- 依赖/构建：`node_modules`、`dist`、`build`、覆盖率、虚拟环境
- 源码/脚本：`src/**`、`scripts/**`、`bin/**`
- CI/编辑器：`.github/**`、`.claude/**`、`.git`（内置）
- 发布/静态产物：`release/**`、`public/**`（视项目而定）

**默认倾向保留**（整仓意图明确时）：

- 顶层 `README*.md`、产品说明 md
- `docs/**`、Agent skill 文档（`skills/**` 或 `**/SKILL.md`）、`openspec/**`

**推送根启发式**：

1. 若几乎只有 `docs/` 下有 md → 可建议以 `docs/` 为根，并对比「整仓根 + exclude」
2. 若顶层有 README + skills/openspec → 建议以**仓库根**为根，用 `--exclude` 削掉代码树
3. 两种策略写进建议，由用户确认；不替用户静默丢掉 skills/openspec

### 3. 闸门 B — dry-run 预览并确认（必须停等）

按闸门 A 结果生成命令，**先**执行 dry-run，展示：

- 将推送的文件规模与路径摘要
- 排除计数
- 每行的展示标题（`title "..."`）
- 是否有 `[duplicate title]` 重名组

用户确认前**不得**发起非 dry-run 上传。用户拒绝则停止；默认路径不写任何配置，中止后本机状态与开始前一致。

### 4. 正式执行

仅闸门 B 确认后执行。汇报：`scanned` / `sent` / `created` / `merged` / `skipped` / `error`（及 `excluded`）。

---

## CLI 契约（稳定接口）

### 单次推送（默认路径）

```bash
npx -y @startist/pentou@latest push docs <dir> \
  --exclude 'src/**' \
  --exclude 'scripts/**' \
  --dry-run
```

| Flag | 语义 |
| --- | --- |
| `--exclude <glob>` | **可重复**；仅本次调用生效；与配置里的 exclude **合并**（配置为底、flag 叠加）；**不写** `~/.pentou/collector.json` |
| `--project <name>` | 项目 key；缺省为 git 仓库根目录名 |
| `--server` / `--token` | 显式凭据；缺省读 collector 配置 |
| `--dry-run` | 只列清单与标题，不上传 |
| `--verbose` | 打印被 exclude 跳过的路径 |

### 常驻采集（仅用户明确要求时）

`collect init --exclude` 写入的是**全局且累积**的配置：

- 影响所有项目、所有 adapter（含对话采集）
- 多次 `init --exclude` **并集累积**，不会清理旧规则
- 相对 pattern 同样会隐式前缀 `**/`

仅当用户要让规则对常驻 `collect watch/pull` **长期生效**时才用；事先说明全局/累积语义，并展示合并后的完整 exclude 列表，获确认后再写。

单次推送的默认路径 **只用** `push docs --exclude`，不要为了一次推送去 `collect init --exclude`。

---

## exclude glob 语义（易踩坑）

相对 pattern（不含 `/` 或不以 `/` 开头的）会被隐式前缀为 `**/`：

- `src/**` → 实际匹配**任意层级**下任何名为 `src` 的目录（可能连带命中 `docs/src/`）
- 需要精确限定时写**绝对路径**
- **必须**用 dry-run 的 `excluded` 计数复核规则是否如预期

内置已跳过：`node_modules`、`.git`、`dist`、`dist-server`、`build`、`.next`、`coverage`、`.venv`。

---

## 推送根与侧栏标题

展示标题公式：`{父目录名}-{文件名 stem}`

- 文件在推送根下：父目录名 = **项目 key**（例：`pentou-README`）
- 文件在子目录：父目录名 = **直接父文件夹名**（例：`design-system-loop-SKILL`）
- **不再**用 frontmatter `title` 或正文 `#` 作为侧栏标题

**收窄根的副作用**：以仓库根推时 `docs/guide.md` → `docs-guide`；以 `docs/` 为根推时同一文件 → `{projectKey}-guide`。建议收窄根时必须在文案中说明。

同批若出现相同拼串标题，dry-run 会标 `[duplicate title]`——身份仍靠路径 `externalId`，可收窄根或事后在 Pentou 内手改标题。

重推且正文未变时，侧栏标题会刷新，**不追加版本、不改 `updatedAt`**。

---

## 凭据

1. 优先复用 `~/.pentou/collector.json` 中的 server/token
2. 若缺失：引导用户打开 Pentou「设置 → 采集」复制令牌，以 `--server` / `--token` 传给 `push docs`；需要常驻采集时再 `collect init --server … --token …`
3. **不在日志或对话中回显完整 token**（可用前后截断提示）

---

## 命令模板

闸门 B dry-run 示例：

```bash
npx -y @startist/pentou@latest push docs /path/to/proj \
  --exclude 'src/**' \
  --exclude 'scripts/**' \
  --exclude '.github/**' \
  --dry-run
```

正式推送：去掉 `--dry-run`（保留已确认的 `--exclude`）。

若配置里尚无 server/token：

```bash
npx -y @startist/pentou@latest push docs /path/to/proj \
  --server http://127.0.0.1:7766 \
  --token '<token>' \
  --exclude 'src/**' \
  --dry-run
```

---

## 边界

- 只收 `.md`；推送单向（本地 → Pentou）
- 本技能不修改用户 Agent 配置文件、不写 Pentou 内部实现路径
- CLI 出现不兼容变更时，请回到仓库 `docs/agent-skills/` 复制新版技能
