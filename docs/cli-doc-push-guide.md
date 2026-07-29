# 使用 CLI 上传文档指南

本文档讲清楚怎么把**项目目录里的 Markdown**（README、设计文档、skills 说明、调研笔记…）一条命令推进 Pentou 的**文档平面**，以及怎么让它在你改文件时自动同步。

面向已经把 Pentou 跑起来的用户（还没跑起来？先看 [user-guide.md](./user-guide.md)）。想采的是**对话**而不是文档，去 [auto-collect-guide.md](./auto-collect-guide.md)。

> **先看一眼边界**：推送是**单向**的——本地文件 → Pentou。在 Pentou 里编辑文档不会写回你的磁盘，删掉本地文件也不会删掉 Pentou 里的文档。

**推送之后怎么认出来**：打开任意一份文档，桌面顶栏第二行会显示「更新于」和来源徽章 **「来自终端」**（与「来自对话」「来自导入」互斥）。侧栏顶部的项目下拉里能按仓库切换；对话若是 CLI 采的，顶栏还会带采集方式「终端」和可选的项目徽章。

---

## 1. 前置：拿到采集令牌

文档推送和对话采集共用同一个令牌，走同一个上报通道。

1. 启动 Pentou 并**保持开着**；
2. 记下地址栏里的地址（npx 启动通常是 `http://127.0.0.1:7766`，源码开发是 `http://localhost:5173`）；
3. 顶栏 **「设置」→「采集」标签** → 复制**「采集令牌」**。

令牌只有上报权限：拿到它的程序只能往你的库里写，不能读、不能删。

同一页的**「脱敏」开关**建议保持开启——文档里混进 API key 的概率不比对话低，开启后 Pentou 会在落盘前把常见密钥形态替换成占位符。

---

## 2. 两种用法，选一个开始

| 用法 | 什么时候用 | 会不会写配置 |
| --- | --- | --- |
| **一次性推送** `pentou push docs <目录>` | 偶尔手动推一次、CI 里跑 | 不写配置、不留同步记录 |
| **常驻同步** `collect init --docs-dir` + `collect watch` | 日常写文档，希望保存即入库 | 写配置、记录同步进度 |

两者的扫描范围、标题推导、归属规则**完全一致**，可以混用。

### 2.1 一次性推送

```bash
npx -y @startist/pentou@latest push docs ./docs \
  --server http://127.0.0.1:7766 \
  --token 你的令牌
```

已经跑过 `collect init` 的机器上，地址和令牌会自动从采集器配置里读，可以省掉两个参数：

```bash
npx -y @startist/pentou@latest push docs ./docs
```

**正式推之前先演习一次**，它只列清单、不发任何请求：

```bash
npx -y @startist/pentou@latest push docs ./docs --dry-run
```

```text
  /Users/you/proj/pentou/docs
    project: pentou (git repository root)
README.md -> project "pentou"
guides/deploy.md -> project "pentou"
scanned=2 sent=0 excluded=0
```

清单确认干净后去掉 `--dry-run`：

```text
scanned=42 sent=42 excluded=0
created=42 merged=0 skipped=0 error=0
```

| 字段 | 含义 |
| --- | --- |
| `scanned` | 扫到的 `.md` 文件数 |
| `sent` | 实际上报数 |
| `excluded` | 被排除规则跳过的 |
| `created` | 新建的文档 |
| `merged` | 覆盖了已有文档（文件改过） |
| `skipped` | 内容没变化——**正常，不是失败** |
| `error` | 出错数（有值时进程退出码为 1，方便 CI 判断） |

`push docs` **每次都全量推送**，不记录同步进度。重复推同一个目录不会产生重复文档：内容没变的一律返回 `skipped`。

### 2.2 常驻同步

登记目录（可重复，一次登记多个项目）：

```bash
npx -y @startist/pentou@latest collect init \
  --server http://127.0.0.1:7766 \
  --token 你的令牌 \
  --docs-dir ~/proj/pentou/docs --doc-project pentou \
  --docs-dir ~/proj/other/notes
```

`--doc-project` 修饰**紧挨着它前面**的那个 `--docs-dir`，用来指定这批文档进哪个项目；不写就自动按 git 仓库名推导（见 §3.1）。

登记后先演习：

```bash
npx -y @startist/pentou@latest collect pull --adapter docs --dry-run --verbose
```

确认无误后正式拉一次，再挂上监听：

```bash
npx -y @startist/pentou@latest collect pull --adapter docs
npx -y @startist/pentou@latest collect watch
```

`watch` 会连对话来源一起监听。保存 `.md` 后**等 15 秒左右**（防抖窗口）文档就会更新。这个终端窗口不能关；关掉后下次 `pull` 一次即可补齐。

> **默认不扫任何目录。** 没用过 `--docs-dir` 的话，`pull` 与 `watch` 的行为和以前完全一样，一个字节的文档都不会碰。

---

## 3. 文档会落到哪里

### 3.1 项目：按仓库分组

Pentou 的文档平面有一个**项目**维度，在侧边栏文件夹列表**上方**的下拉菜单里切换。

**项目名怎么定**，按这个顺序：

1. 你显式指定的 `--doc-project pentou`（一次性推送是 `--project pentou`）；
2. 否则取该目录所在 **git 仓库根目录的名字**——登记 `~/proj/pentou/docs` 会得到项目 `pentou`，而不是 `docs`；
3. 目录不在任何 git 仓库里时**问你一句**，直接回车就取目录名：

   ```text
   resolving document project names:
     /Users/you/notes
       not a git repository. Project name [notes]:
   ```

4. CI 之类的非交互环境**不会卡住等输入**，直接取目录名。

项目名在**登记 / 推送那一刻定下来就写死**，之后不会因为你删了 `.git` 而变。项目不存在就自动创建，已存在就复用。

新项目的**描述**初始化为你本地的目录绝对路径——这样一眼能看出它对应磁盘上的哪儿。描述随时可以在界面上改成人话（比如「笔头的产品与部署文档」）。

### 3.2 文件夹：一律落「未分类」，由你来归类

**推送不会创建任何文件夹**，新文档全部落在所属项目的**未分类**里。

这是有意为之：`docs/guides/` 是仓库的组织方式，未必是你浏览文档时想要的分类；机器猜错的代价是你得先删掉一堆没用的文件夹再重建。所以归类权在你手上：

1. 在侧边栏切到目标项目；
2. 「新建文件夹」——新文件夹自动属于当前项目（同名文件夹在不同项目下互不干扰）；
3. 把文档拖进去，或用条目菜单的**「移动至…」**。

选中项目后，选择器右侧的「…」里有**编辑**（同一个对话框里改名称和描述）和**删除**两项。默认目录没有这两个入口。

「移动至…」是**项目 → 文件夹**的两层菜单，可以跨项目移动；批量多选后的移动用的是同一套菜单，一次搬多份。

### 3.3 你手动归好的类不会被推送打回

文档一旦被你移进某个文件夹，之后**再怎么推送都不会被打回未分类**——推送只更新正文，不动归属。

---

## 4. 同一份文件推很多次会怎样

Pentou 用「项目名 + 相对路径」给每份文档一个稳定身份，因此：

- **内容没变** → `skipped`，什么都不做；
- **内容变了** → `merged`：旧正文自动存档为一个 `pre-import-overwrite` 版本，新正文作为 `import` 版本成为当前版本。文档 id、归属、批注全部保留；
- 你在 Pentou 里手动改过的内容**不会阻断推送**（执行推送就是在声明「以我的文件为准」），但也**不会丢**——在版本面板里能看到并一键回滚。

改标题、改开头段落都不会产生第二份文档。

---

## 5. 改项目名 / 删项目

**改名和改描述都只是展示层**，在选择器右侧「…」→「编辑」里一次改完。项目和本地目录的对应关系认的是一个不可变的内部标识，改名后再推送同一个目录，文档照样进这个项目，不会冒出第二个同名项目。

**删项目不会删文档**：

- 该项目下的**文件夹**会被一并删除；
- 它的**文档全部保留**，落进「默认目录」的未分类。

删掉之后再推一次同一个目录，项目会按原标识重建，已有文档被认领回去、不产生重复——但你之前手建的文件夹已经没了，需要重新归类。所以删项目是个低风险操作，误删可恢复。

---

## 6. 排除不想上传的目录

内置就跳过这些目录，不用你操心：

`node_modules`、`.git`、`dist`、`dist-server`、`build`、`.next`、`coverage`、`.venv`

在此之上，采集器的 `--exclude` 规则同样对文档生效（`push docs` 也会读取配置里的 exclude）：

```bash
npx -y @startist/pentou@latest collect init \
  --server http://127.0.0.1:7766 \
  --token 你的令牌 \
  --docs-dir ~/proj/pentou/docs \
  --exclude "**/drafts/**" \
  --exclude "**/private/**"
```

改完用 `--dry-run` 验证是否生效。排除规则的完整写法见 [auto-collect-guide.md §2.6](./auto-collect-guide.md)。

---

## 7. 已知限制

这几条现在就该知道，免得日后困惑：

- **只收 `.md`**。`.txt` / `.mdx` / PDF / DOCX 都不在范围内——PDF / DOCX 走 Web 端的导入通道。
- **重命名文件会新建一份文档**。身份认的是路径，`a.md` 改名成 `b.md` 就是一份新文档，旧的仍留在库里，需要你手动删。
- **正文里的本地相对路径图片不会被上传**。`![](./assets/a.png)` 这类链接会原样保留（渲染成坏图），因为服务端读不到你磁盘上的文件。`https://` 开头的远程图片会被自动下载到本地资产库。
- **删本地文件不会删 Pentou 里的文档**。推送是单向的，删除不同步。
- **单个文件超过 10MB 会被跳过并报错**，不会截断上传——截断的文档是错误的文档。真遇到多半是目录指错了（比如指到了含大 base64 的产物目录）。

---

## 8. 排障速查

| 现象 | 原因 / 处理 |
| --- | --- |
| `401` / `invalid_token` | 令牌抄错或已被重置。回「设置 → 采集」重新复制，重跑 `collect init`（或给 `push docs` 传 `--token`）。 |
| `429` / `too_many_attempts` | 用错令牌反复重试触发了 IP 限速。**令牌本身可能是对的**——重启 Pentou 或等几分钟解除，别急着改令牌。 |
| `invalid format` + 提示服务端版本过低 | 这台 Pentou 还不认文档推送。升级 Pentou 后重试。 |
| 报错指向 `pentou collect init` | 没配置过、也没传 `--server` / `--token`。二选一：跑一次 `collect init`，或在命令行显式传。 |
| `--docs-dir` 登记了却没采到 | ① 目录路径写错或不存在（`collect init` 的输出里会标 `-`）；② 目录里没有 `.md`；③ 被 `--exclude` 或内置跳过目录挡掉了。用 `collect pull --adapter docs --dry-run --verbose` 看清单和被跳过的路径。 |
| `document exceeds the 10MB ingest limit` | 该文件太大，已被跳过（见 §7）。确认是不是目录指错了。 |
| 两个仓库的文档混在一个项目里 | 两个目录都不在 git 仓库里、且回车用了同名的目录名（比如都叫 `docs`）。用 `--doc-project <仓库名>` 分开，重新推送，再把旧项目删掉。 |
| 推送后界面没变化 | 刷新页面。文档列表是在页面加载时拉取的。 |
| 文档被推回未分类了 | 不应该发生——推送不改归属。若确实遇到，请带上复现步骤提 issue。 |

---

## 9. 相关文档

- [auto-collect-guide.md](./auto-collect-guide.md) —— 对话的自动采集（CLI 采集器 + 浏览器插件）
- [user-guide.md](./user-guide.md) —— 从零把 Pentou 跑起来
- [pentou-introduction.md](./pentou-introduction.md) —— 产品介绍与能力说明
- [releases.md](./releases.md) —— 版本发布说明
- [deployment.md](./deployment.md) —— 部署到服务器 / NAS
