# Agent Skills（面向用户）

这里放的是**可复制到你自己的编码 Agent** 的技能文档，不是 Pentou 内部的工程纪律技能，也不是产品运行时里的 plane B 技能。

装好后，你可以在 Claude Code / Cursor / Codex 等里用自然语言驱动安装、采集与文档推送。

**三者链路：** 装起来（setup）→ 在设置页拿令牌 → 采会话（collect）/ 推文档（docs-push）。

| 技能 | 用途 |
| --- | --- |
| [pentou-setup](./pentou-setup/SKILL.md) | 本机安装 / 启动 Pentou，可选桌面一键脚本 |
| [pentou-collect](./pentou-collect/SKILL.md) | 把本机 agent 会话经 CLI 采入对话平面 |
| [pentou-docs-push](./pentou-docs-push/SKILL.md) | 把本地项目 Markdown 推入文档平面 |

先 setup 跑起来并拿到采集令牌后，collect 与 docs-push 可按需单独使用。

---

## 怎么装

Agent 认的是「目录名 + 其中的 `SKILL.md`」。请**整夹复制**，不要只复制文件内容却改目录名或改 `SKILL.md` 文件名。

### 已克隆本仓库

**全局（所有项目可用）—— Claude Code 示例：**

```bash
mkdir -p ~/.claude/skills
cp -r docs/agent-skills/pentou-setup ~/.claude/skills/
cp -r docs/agent-skills/pentou-collect ~/.claude/skills/
cp -r docs/agent-skills/pentou-docs-push ~/.claude/skills/
```

**仅当前项目：**

```bash
mkdir -p .claude/skills
cp -r docs/agent-skills/pentou-setup .claude/skills/
cp -r docs/agent-skills/pentou-collect .claude/skills/
cp -r docs/agent-skills/pentou-docs-push .claude/skills/
```

### 未克隆仓库（GitHub raw）

```bash
# setup
mkdir -p ~/.claude/skills/pentou-setup
curl -fsSL -o ~/.claude/skills/pentou-setup/SKILL.md \
  https://raw.githubusercontent.com/STArtppt/PenTou/main/docs/agent-skills/pentou-setup/SKILL.md

# collect
mkdir -p ~/.claude/skills/pentou-collect
curl -fsSL -o ~/.claude/skills/pentou-collect/SKILL.md \
  https://raw.githubusercontent.com/STArtppt/PenTou/main/docs/agent-skills/pentou-collect/SKILL.md

# docs-push
mkdir -p ~/.claude/skills/pentou-docs-push
curl -fsSL -o ~/.claude/skills/pentou-docs-push/SKILL.md \
  https://raw.githubusercontent.com/STArtppt/PenTou/main/docs/agent-skills/pentou-docs-push/SKILL.md
```

或打开仓库里对应的 `SKILL.md` 页面，复制正文，另存为：

```text
~/.claude/skills/pentou-setup/SKILL.md
~/.claude/skills/pentou-collect/SKILL.md
~/.claude/skills/pentou-docs-push/SKILL.md
```

### 其他 Agent

不同 Agent 的技能目录名可能不同（例如项目内 `.cursor/skills`、Codex 的约定等）。请对照你所用工具的文档，把同一夹放到对应位置。**本仓库不会猜测或改写任何 Agent 的配置文件。**

---

## 更新

技能正文只依赖稳定的 CLI 子命令与 flag。当 `@startist/pentou` 出现不兼容变更时，回到本页重新复制新版即可；`SKILL.md` frontmatter 里的 `version` 便于对照。

---

## 相关文档

- [用户指南](../user-guide.md) —— 本机 `npx` 启动与 §6 提示词路径
- [使用 CLI 上传文档指南](../cli-doc-push-guide.md) —— 标题规则、`push docs --exclude`、重推行为
- [自动采集指南](../auto-collect-guide.md) —— 常驻 `collect` 与全局 exclude
