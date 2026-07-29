# PenTou 发布说明

## v0.0.6

> 发布日期：待发布

### 新特性

- **CLI 文档推送与文档项目维度**：把项目目录里的 Markdown（README、设计文档、笔记等）推入文档平面；按 git 仓库（或 `--doc-project`）分组；支持 `push docs` 与登记 `--docs-dir` 后的 `pull` / `watch` 同步。详见 [cli-doc-push-guide.md](./cli-doc-push-guide.md)。
- **内容顶栏来源属性**：对话与文档顶栏统一为双行布局；对话展示品牌/形态、采集方式（网页 / 终端 / 手工）与可选项目徽章；文档展示「更新于」与来源三态（来自对话 / 来自终端 / 来自导入）。
- **用户向自动采集指南**：新增 [auto-collect-guide.md](./auto-collect-guide.md)，覆盖 CLI 采集器与浏览器插件的安装、排除规则与排障。

### 修复

- **一键迁移**漏搬 `document-projects.json`，迁移后文档项目维度不可见。
- **Grok CLI** 采集时间塌成入库时刻，恢复会话原始时间。
- **采集器路径**：对 `XDG_DATA_HOME` 与 exclude 中 `~` 的环境假设过强，导致部分机器漏采或排除失效。

### 文档

- README / 英文 README 强化「CLI 文档推送」「顶栏来源徽章」等卖点；产品介绍合并为单一 [pentou-introduction.md](./pentou-introduction.md)。
- 部署与扩展相关文档修订（含 MinerU 口径、Chrome Web Store 隐私政策入口等）。

### 说明

- 顶栏属性徽章目前为**桌面**路径；移动端仍由 MobileTopBar 承接标题，不展示完整徽章组。
- 一键迁移仍为 R1：大媒体库流式传输与中断续传后续补强。

---

## v0.0.4

### 亮点

- 添加了具有持久聊天历史记录的人工智能侧边栏。
- 添加了混合/全文搜索功能。
- 添加了媒体资产解析和渲染。
- 添加了 npx 启动程序包支持。
- 用 MinerU 替换了 MarkItDown 文档解析。

### 注释

此版本还发布了多架构 Docker 映像和 npm 包。
