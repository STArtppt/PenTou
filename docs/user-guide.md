# Pentou 一键启动指南（npx）

本文档面向想在自己电脑上运行 Pentou 的用户。无需克隆代码、无需安装 Git / pnpm、无需任何构建知识。
适用平台：macOS / Windows / Linux。
如果你要部署到服务器 / NAS 供公网或多人访问，请改用 Docker 部署（见 [deployment.md](./deployment.md)）。

---

## 1. 一句话开始

在你想存放数据的目录打开终端，执行：

```bash
npx -y @startist/pentou@latest
```

发生什么：

1. npm 自动下载 Pentou（首次约十几秒，之后有缓存）
2. 服务在本机 `7766` 端口启动（被占用时自动换到 7767~7776 之间的空闲端口，终端会提示）
3. 默认浏览器自动打开 Pentou 页面；如果没打开，手动访问终端里打印的地址（如 `http://127.0.0.1:7766`）
4. 数据保存在当前目录下的 `pentou-data/` 文件夹

停止：在终端按 `Ctrl + C`。

> **安全说明**：默认只监听 `127.0.0.1`，只有你这台电脑能访问，无需设置密码。

---

## 2. 前置条件：Node.js ≥ 20

这是唯一的前置条件。检查方法——终端执行：

```bash
node -v
```

- 输出 `v20.x` 或更高 → 直接用 §1 的命令
- 提示"命令不存在"或版本低于 20 → 去 [nodejs.org](https://nodejs.org/) 下载 **LTS 版本** 安装（一路下一步即可），装完重开终端再试

各平台打开终端的方法：

| 平台 | 方法 |
| --- | --- |
| macOS | 启动台搜索「终端」/「Terminal」 |
| Windows | 开始菜单搜索「PowerShell」或「cmd」 |
| Linux | 你应该已经知道了 |

> 完全不想自己折腾？直接跳到 [§6 让 AI 替你完成](#6-让-ai-替你完成)。

---

## 3. 常用参数

```bash
npx -y @startist/pentou@latest [选项]
```

| 选项 | 作用 | 默认 |
| --- | --- | --- |
| `--port <n>` | 指定起始端口 | `7766` |
| `--data-dir <路径>` | 指定数据目录 | 当前目录下 `pentou-data/` |
| `--password <密码>` | 开启登录鉴权 | 不开启（仅本机可访问） |
| `--host <地址>` | 监听地址；非 `127.0.0.1` 时**必须**同时设置 `--password` | `127.0.0.1` |
| `--no-open` | 启动后不自动打开浏览器 | 自动打开 |
| `--version` / `--help` | 查看版本 / 帮助 | - |

示例——给局域网其他设备访问（必须带密码）：

```bash
npx -y @startist/pentou@latest --host 0.0.0.0 --password 你的密码
```

---

## 4. 数据在哪里？

- 默认在**启动命令时所在目录**的 `pentou-data/` 中：对话、文档、搜索索引全在里面
- 备份 = 复制整个 `pentou-data/` 文件夹；迁移 = 把它拷到新位置后在那个目录重新启动
- 想要多个独立的库：在不同目录分别启动即可，互不影响
- 在同一目录再次启动会继续使用原有数据，不会重置

---

## 5. 桌面一键启动脚本

每次都打终端命令太麻烦？建一个双击即可启动的脚本（下面假设数据放在 `~/Pentou`，按需替换）。

### macOS：`启动Pentou.command`

在桌面创建文件 `启动Pentou.command`，内容：

```bash
#!/bin/bash
mkdir -p "$HOME/Pentou" && cd "$HOME/Pentou"
npx -y @startist/pentou@latest
```

赋予执行权限（终端执行一次）：

```bash
chmod +x ~/Desktop/启动Pentou.command
```

之后双击即可。首次双击如被 Gatekeeper 拦截，右键 → 打开。

### Windows：`启动Pentou.bat`

在桌面创建文件 `启动Pentou.bat`（注意扩展名是 `.bat` 不是 `.bat.txt`），内容：

```bat
@echo off
if not exist "%USERPROFILE%\Pentou" mkdir "%USERPROFILE%\Pentou"
cd /d "%USERPROFILE%\Pentou"
npx -y @startist/pentou@latest
pause
```

之后双击即可。

### Linux：`start-pentou.sh`

```bash
#!/bin/bash
mkdir -p "$HOME/Pentou" && cd "$HOME/Pentou"
npx -y @startist/pentou@latest
```

`chmod +x start-pentou.sh` 后在终端运行，或自行包一个 `.desktop` 条目。

---

## 6. 让 AI 替你完成

如果你完全没有编程基础，把下面整段提示词复制给任意 AI Agent（Claude Code、Cursor、Codex 等），让它替你检查环境、处理报错、启动 Pentou 并创建桌面脚本：

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

---

## 7. 常见问题（FAQ）

### Q1：下载很慢或卡住不动？

多为 npm 官方源网络不佳。配置国内镜像后重试：

```bash
npm config set registry https://registry.npmmirror.com
npx -y @startist/pentou@latest
```

恢复官方源：`npm config set registry https://registry.npmjs.org`。

### Q2：提示端口被占用？

Pentou 会自动换用 7767~7776 之间的空闲端口并在终端提示实际地址。也可以自己指定：`--port 8899`。

### Q3：报错里出现 `node-gyp` / `prebuild` / 编译失败字样？

通常是 Node 版本过新或过旧，没有对应的预编译组件。换到 [nodejs.org](https://nodejs.org/) 的 **LTS 偶数版本**（如 20 / 22 / 24）重试。

### Q4：浏览器没有自动打开？

服务仍在运行。手动打开终端里打印的地址即可（如 `http://127.0.0.1:7766`）。

### Q5：怎么升级 / 固定版本？

- 命令里的 `@latest` 意味着每次启动都用最新版
- 想锁定版本：`npx -y @startist/pentou@1.2.3`
- 想强制刷新缓存：先执行 `npm cache clean --force` 再启动（一般不需要）

### Q6：怎么彻底停止 / 卸载？

- 停止：启动它的终端窗口里按 `Ctrl + C`，或直接关闭该终端窗口
- 卸载：删除数据目录 `pentou-data/` 即可；npx 缓存可用 `npm cache clean --force` 清理

### Q7：和 Docker 部署是什么关系？

npx 方式适合**本机单人使用**：零运维、免登录、数据在本地目录。要挂域名、公网访问、多设备共用，请用 Docker 部署并配置密码与反向代理。两者数据目录结构一致，可互相迁移。
