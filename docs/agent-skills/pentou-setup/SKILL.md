---
name: pentou-setup
description: >-
  Install and start Pentou locally via CLI, with machine-changing actions gated
  by confirmation. Trigger when the user says: 装 Pentou / 启动 Pentou /
  帮我把笔头跑起来 / install pentou / 创建一键启动脚本 / 帮我装 pentou.
version: "1.0.0"
---

# pentou-setup

用自然语言驱动在本机安装并启动 Pentou（`npx -y @startist/pentou@latest`），可选创建桌面一键启动脚本。

**运行环境**：用户自己的任意机器（不依赖 Pentou 源码仓库）。本技能只依赖公开 CLI 契约。

**入口命令**（本机已装全局 CLI 时可用 `pentou` 代替）：

```bash
npx -y @startist/pentou@latest [选项]
```

**重要：本技能没有 dry-run。** 不得伪造「先 dry-run 预览再执行」的闸门。风险控制靠**动作计划 + 改机器动作逐项确认 + 客观成功判据**。

---

## 工作流（六步，顺序固定）

### 1. 环境自检

确认：

- `node` / `npm` / `npx` 是否可用
- Node 版本 **≥ 20**（`node -v`）

不足时列入动作计划（装/升级 Node），**不要**在未确认前直接安装。

### 2. 动作计划并停等（必须停等）

输出本次将执行的动作清单，至少写清：

| 项 | 内容 |
| --- | --- |
| 启动命令 | 完整命令行（含拟用 flag） |
| 数据目录落点 | 默认 = **启动时 cwd** 下的 `pentou-data/`（写成将采用的绝对路径意图） |
| 端口 | 默认起始 `7766`；占用时会自动改用 7767~7776 |
| 监听 | 默认 `127.0.0.1`、不设密码 |
| 是否装/升级 Node | 是 / 否 |
| 是否改 npm registry | 是 / 否（若是，附恢复命令） |
| 是否创建桌面脚本 | 是 / 否（可后做） |

**用户确认前，不得开始安装、改配置或启动。**

### 3. 执行与排障重试

执行启动命令。失败时判断原因、处理后**重新运行目标命令验证**，不得停在报错处、也不得在未成功启动时报告完成。

常见原因见「常见故障处理」。

### 4. 客观判据验证

成功判据（两条同时满足）：

1. 终端打印出访问地址（形如 `http://127.0.0.1:7766`）
2. 该地址在浏览器中可打开

「命令没报错」「退出码 0」**单独不算**成功。

### 5. 桌面脚本（可选，单独确认）

属改机器动作：须用户确认后再写文件；创建后**实际运行一次**验证，通过后可再停掉服务。

### 6. 汇报

见「成功判据与汇报模板」。

---

## 改机器的动作须逐项确认

下列动作各自单独获得确认后才执行，确认前说明影响与恢复方式：

| 动作 | 说明 | 恢复 / 回退 |
| --- | --- | --- |
| 安装或升级 Node.js | 可能改变系统默认 `node` | 按所用安装方式回退/切换版本 |
| 修改 npm registry | 改全局 npm 配置 | `npm config set registry https://registry.npmjs.org` |
| 写桌面（或任意用户目录）启动脚本 | 新增可执行文件 | 删除该文件即可 |

### 红线

- **不得**安装与启动 Pentou **无关**的任何软件
- **不得**修改与 Node.js / npm **无关**的系统配置
- **不得**在未获确认时改变监听地址或写入桌面脚本

---

## 监听地址安全约束

| Flag | 语义 | 默认 |
| --- | --- | --- |
| `--port <n>` | 起始端口；占用时向上探测至多约 +10（7767~7776 一带空闲口） | `7766` |
| `--data-dir <路径>` | 数据目录 | 当前目录下 `pentou-data/` |
| `--password <密码>` | 开启登录鉴权 | 不开启（仅本机可访问） |
| `--host <地址>` | 监听地址；**非 `127.0.0.1` 时必须同时 `--password`** | `127.0.0.1` |
| `--no-open` | 启动后不自动打开浏览器 | 自动打开 |

**硬约束：**

- `--host` 取值不是 `127.0.0.1` 时，**同一条命令必须**带 `--password`
- Agent **不得**为了「让手机/局域网也能访问」而自行放宽监听
- 用户明确要求外网/局域网访问时：说明风险与密码要求，**停等用户决定**，再写出完整命令

默认路径：只监听 `127.0.0.1`、不设密码。

示例（仅用户明确要求时）：

```bash
npx -y @startist/pentou@latest --host 0.0.0.0 --password '<user-chosen-password>'
```

---

## 成功判据与汇报模板

### 判据

终端打印地址 **且** 浏览器可打开该页。「没报错」不算完成。

端口占用时服务会自动改用 **7767~7776** 之间的空闲端口；汇报地址以**终端实际打印**为准，不要默认写死 `7766`。

### 汇报须包含

1. **访问地址**（终端实际打印）
2. **数据目录的绝对路径**，并说明：数据目录取决于**启动时的当前工作目录**（默认为其下的 `pentou-data/`）；换目录启动会得到另一份独立数据；备份 = 整夹复制该目录
3. **桌面脚本完整路径**与使用方式（若已创建）

---

## 常见故障处理

按技能语气处理，处理后**重跑目标命令**再下结论：

| 现象 | 处理方向 |
| --- | --- |
| 缺少 Node 或版本 &lt; 20 | 引导安装/升级 LTS（偶数版如 20 / 22 / 24）；属改机器动作，须确认 |
| 下载很慢 / registry 超时 | 可改镜像（如 `npm config set registry https://registry.npmmirror.com`）后重试；须确认，并告知恢复：`npm config set registry https://registry.npmjs.org` |
| 报错含 `node-gyp` / `prebuild` / 编译失败 | 多为 Node 过新或过旧、缺预编译包 → 换 [nodejs.org](https://nodejs.org/) 的 **LTS 偶数版本** 重试 |
| 浏览器未自动打开 | 服务多半仍在跑；把终端打印的地址完整交给用户手动打开 |
| 权限 / 缓存 / PATH / npm 配置异常 | 修复后重试；一般可不 `npm cache clean --force`，仅在强缓存怀疑时再议 |

---

## 桌面一键启动脚本

用户确认后按 OS 创建；数据目录约定可与用户对齐（下例用 `~/Pentou`，可改）。

### macOS：`启动Pentou.command`

```bash
#!/bin/bash
mkdir -p "$HOME/Pentou" && cd "$HOME/Pentou"
npx -y @startist/pentou@latest
```

```bash
chmod +x ~/Desktop/启动Pentou.command
```

首次双击若被 Gatekeeper 拦截：右键 → 打开。

### Windows：`启动Pentou.bat`

```bat
@echo off
if not exist "%USERPROFILE%\Pentou" mkdir "%USERPROFILE%\Pentou"
cd /d "%USERPROFILE%\Pentou"
npx -y @startist/pentou@latest
pause
```

扩展名须是 `.bat`（不是 `.bat.txt`）。

### Linux：`start-pentou.sh`

```bash
#!/bin/bash
mkdir -p "$HOME/Pentou" && cd "$HOME/Pentou"
npx -y @startist/pentou@latest
```

```bash
chmod +x start-pentou.sh
```

### 创建后验证

**必须实际运行一次**脚本，确认能启动（终端出地址且浏览器可开）。验证后可停止服务。不要只写文件不跑。

---

## 边界

- **不覆盖 Docker / 长期服务部署**（反代、TLS、多设备共用）。见仓库文档 `docs/deployment.md`
- **不修改**用户 Agent 的配置文件、技能目录约定由用户自行落位
- 本技能不写 Pentou 内部实现路径；只依赖公开启动 flag
- CLI 出现不兼容变更时，回到仓库 `docs/agent-skills/` 复制新版技能；用 frontmatter `version` 对照
