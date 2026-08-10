# PenTou 发布说明

## v0.1.1

> 发布日期：2026-08-10

本版的主题是 **「从归档工具走向会动手的工作台」**：AI 侧栏从一个问答框变成技能编排入口——点名主题它跨全库汇总成文，点一下它为满库文档起草归类计划，而每一步都摊开可查、每一次改库都先问过你。同时**浏览器插件已上架 Chrome 应用商店**，网页端采集不再需要克隆仓库、构建、开发者模式加载；采集面进一步铺到**豆包 / 通义千问（国内 + 国际）/ Gemini**，模型的搜索链与思考链也从正文里剥了出来。

### 新特性

- **AI 技能与「AI 空间」**：内置五个技能——`topic-digest`（整理会话）、`doc-folder-organize`（整理目录）、`conversation-to-doc`（转成文档）、`annotation-driven-rewrite`（批注重写）、`ask-ai-context`（Ask AI）。技能定义是 `data/skills/<name>/SKILL.md` 的纯文本工作流 + JSON Schema，运行时依赖只写 `/api/*` 契约，外部 Agent 可读同一份文件指向运行中的实例复现。产物统一落进服务端注入的「AI 空间」文件夹，不与导入语料混淆。
- **主题汇总（跨库提问首期）**：点名一个主题 → 扩展查询词 → 跨全库混合检索 → 多维统计（平台 / 采集来源 / 项目 / 按月）→ 深读最相关的几条 → 汇总成一篇带可点击来源清单的文档。Roadmap A 由此兑现首期。
- **文档目录整理**：判定项目类型（开发 / 知识工作）并比对典型目录结构，为待归类文档起草**带复选框的行动计划**——批准前一篇文档都不动。清理提议的执行语义是**归入 `_待清理` 文件夹，没有任何删除调用**。
- **意图执行可见**：每次技能执行是一次可追踪的 run——步骤类型与耗时实时呈现在回答下方，长跑可中止，失败态区分「失败 / 中断 / 已停止」；后台 registry 保证切走页面也不丢执行。
- **AI 侧栏常驻布局与意图 chip**：桌面端常驻 dock；输入框下方的 chip 一点即跑，chip 选中后回车即执行；条件不满足时给出明确前置提示（未配模型 / 未选会话 / 无带评论批注 / 未输入主题）；上下文头常驻显示当前挂的是哪一篇。
- **计划文档执行状态**：行动计划正文上方常驻状态条——未执行 / 已执行 / 中断 / 失败，附执行时间与「已落 N 条」，并可查看执行轨迹与失败原因。状态存 frontmatter `aiPlanRun`，不写进正文，解决「这份计划到底跑没跑」的误导。
- **正文末元数据面板**：可折叠的两段式面板——固定字段（平台 / 采集方式 / 会话时间 / 更新时间 / 目录 / 来源项目 / 消息数…）与文档自带的 YAML frontmatter **原样区**并列，可一键复制；展示层与真源剥离，面板只读不改盘。
- **消息推理过程独立成面板**：豆包的搜索链、DeepSeek / 通义千问的思考链不再混在正文里——采集侧就把它拆进 `Message.reasoning`，会话页以**默认收起**的「搜索链、思考链等文本」面板承载，正文只留最终回答。会话 `.md` 用成对 HTML 注释往返，**复制 / 摘录 / 全文检索都不含推理过程**。
- **浏览器插件上架 Chrome 应用商店**：[Pentou Collector](https://chromewebstore.google.com/detail/pentou-collector/kfepbkfbnminfhcenaookdnikccdfmip) 已发布，安装后在选项页填「Pentou 地址 + 采集令牌」即可采集 ChatGPT / DeepSeek 网页对话；同时移除了不必要的 `tabs` 权限，权限说明一并优化。
- **网页采集扩展到豆包 / 通义千问双站 / Gemini**：服务端新增 `doubao`、`qwen`、`qwen-intl`、`gemini` 四路登录态 raw normalizer（`Platform` 枚举补入 Doubao、Qwen），插件同步新增四份 adapter 与域名权限，选项页按支持平台动态渲染开关。通义千问两站拆 slug 防 `externalKey` 串档，归类层仍统一为一个 `Qwen` 文件夹。插件版本升至 **0.2.1，已提交 Chrome 商店送审**。
- **关于页版本号按 git tag 解析**：设置-关于经 `/api/health` 展示 `resolveAppVersion` 结果（环境变量 → 发版注入的 `package.json` → 最新 `v*` tag，开发态带 `-dev`），CLI `--version` 与 dev 服务端同源，不再需要手改版本常量。导入面板也补上了 Chrome 应用商店的安装指引。
- **Pi coding agent 采集支持**：新增 adapter 与 normalizer，CLI 采集器可用来源增至 9 个。
- **面向用户的 Agent Skill**：`docs/agent-skills/` 下交付 `pentou-setup` / `pentou-collect` / `pentou-docs-push` 三份可整夹复制的技能，让任意 AI Agent 用自然语言替你完成安装、采集配置与文档推送。
- **文档推送标题按路径拼串**：同名 `README.md` 不再互相覆盖或难以分辨，标题带上路径段。
- **文档页保持上下文**：刷新后保留当前项目与选中项，导入的文档自动归属当前项目。
- **LLM 设置简化**：移除全局系统提示词，改由各技能内置默认值——不同技能不再被同一段全局 prompt 拉偏。

### 修复

- 文档刷新丢失选中、计划执行失败态展示、AI 侧栏若干体验问题。
- **通义千问分享导入**：消息按 list 倒序错乱、`image_waterfall` / `layout` ref 数组里的图片丢失、`qianwen.my.cn` 分享域名未命中。
- Markdown 单个波浪号被误解析为删除线。
- Base UI Tooltip / Button 的 `nativeButton` 误用。
- i18n 重复 key 触发的 Vite Duplicate key 警告。
- 对话页用户消息头像与气泡右对齐。

### 工程

- **分享解析真源下沉**：豆包 / 通义千问 / Gemini 的分享页映射从 obscura 内联代码抽到 `src/shared/share-parsers/`，分享链接导入与插件登录态 normalizer 共用同一份实现，两条采集路径的输出契约由等价性测试守住。
- **typecheck 零容忍**：清零存量类型错误并将 typecheck 提为交付闸门。
- **lint:ui 加固**：基线改用行号无关的分组计数键消除误报；规则前导守卫改零宽 lookbehind，修掉紧邻违规的漏检。

### 文档

- README / 英文 README / [pentou-introduction.md](./pentou-introduction.md) 新增「AI 技能」章节并更新三张演示截图。
- [auto-collect-guide.md](./auto-collect-guide.md) §3 改为「商店安装」，源码构建降级为折叠的开发者备选。
- 浏览器插件规划补入豆包、通义千问（国内版 / 国际版）与 Gemini 的支持路线，并按真实勘测结果落成 R3 平台接口表（页面形态、会话 ID、最小请求形态、鉴权口径）。
- [PRIVACY.md](../PRIVACY.md) 补充四个新采集域名与对应权限说明。

### 说明

- **浏览器插件自带版本号，与 Pentou 版本号无关**：商店在架的是插件 v0.1.1（仅 ChatGPT / DeepSeek）；含豆包 / 通义千问 / Gemini 的插件 v0.2.1 **正在商店审核中**，四平台的端到端采集已实机验收通过，商店审核通过后由 Chrome 自动更新；急用可用 `extension/pentou-collector-chrome-v0.2.1.zip` 开发者模式加载。
- 技能的 LLM 调用走 **BYOK**：未在设置里配好模型时，意图 chip 为禁用态并提示「请先配置模型」。
- 技能 runner 目前只支持**线性工作流**（无分支 / 循环）。
- 行动计划**不支持中断续跑**：中断后请让 AI 重新起草一份。
- 元数据面板与顶栏属性徽章仍为**桌面**路径；移动端不展示完整徽章组。

---

## v0.0.6

> 发布日期：2026-07-29

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
