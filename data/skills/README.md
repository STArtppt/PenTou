# Plane B · 产品技能（Production Skills）

> Pentou 三平面之一，总览与判据见根目录 [AGENTS.md](../../AGENTS.md) 第 3 节。

**本目录只放产品技能 —— 产品对外生产结果、可安装/可分发的 Agent Skill。**
它们**不是**约束我们怎么写代码的工程纪律（那在 [`skills/`](../../skills/)），也**不是**运行时本身（那在 `src/server/`）。

判据一句话：**「产品跑起来给用户生产结果」→ 这里；「指导我们写代码」→ `skills/`；「加载技能并驱动它打 /api/*」→ `src/server/` 运行时。**

## 运行模型

```
用户在 Pentou 点按钮（转文档 / 批注 / Ask AI）
        │
        ▼
技能编排器（src/server，POST /api/skills/run，SSE）
        │  加载 data/skills/<name>/SKILL.md + schema
        ▼
按 SKILL 工作流驱动 LLM，调用 Pentou 自身 /api/*（search / llm / documents / annotations …）
        │
        ▼
产物落 data/（gitignore 的产物目录，非本目录）
```

**关键契约**：技能里**不写死内部函数调用**，运行时依赖一律表达为 **`/api/*` 端点 + schema**。
于是同一技能既能被 Pentou 内部运行时消费，也能被**外部 Agent** 指向一个运行中的 Pentou 实例消费——
一套契约，两个消费者，**预留外部分发零额外打包成本**。

## 目录格式（对齐可安装范式）

```
data/skills/
├── README.md            # 本文件
├── registry.json        # 技能登记表
├── _template/           # 新技能脚手架
└── <name>/
    ├── SKILL.md         # 标准 frontmatter(name/description) + 工作流 + 任务分类
    ├── schema/          # I/O 契约（输入参数、输出结构、/api 依赖）
    ├── examples/        # 样例输入输出
    └── (evals/)         # 可选，成熟后补
```

- 技能**源码**（本目录）随仓库 track；**运行产物**落 gitignore 的 `data/` 子目录，切勿混入本目录。
- 成熟后可整体抽取为独立仓库 `pentou-skills` 发布。

### SKILL 契约（runner 消费约定）

- `SKILL.md` 的 **Workflow** 是**线性有序**步骤，每步标注 `kind`：
  - `api` — 调声明的 `/api/*` 端点取数据；
  - `llm` — 客户端调 LLM（复用 `src/app/llm.ts`），带 `promptRef`；
  - `transform` — 纯变换（拼接上下文、套 prompt 等）。
- `schema/input.schema.json` / `schema/output.schema.json` 为 **JSON Schema（draft-07）**，runner 执行前用 input schema 校验入参。
- runner 顺序执行步骤并串联上下文；本期只支持线性工作流（无分支/循环）。
- `SKILL.md` 是**人读 + 外部 agent 读**的权威描述；runner 的可执行定义（`src/app` 内建注册）须与之对齐。

## 当前技能（规划中）

| 技能 | 场景 | 运行时依赖 `/api/*` | 状态 |
| --- | --- | --- | --- |
| `conversation-to-doc` | 对话转文档（选风格） | 读对话、`llm`、`documents` | planned |
| `annotation-driven-rewrite` | 批注驱动 AI 重写 | `annotations`、`llm`、`documents` | planned |
| `ask-ai-context` | Ask AI 上下文 + 语义检索 | `search`/`embedding`、`llm` | planned |

> 先落**技能编排器**（首个 OpenSpec 立项 `skill-orchestrator`），再逐个补上述技能。
> 平面切分提醒：批注**渲染 UI** 属 plane A（`src/app/annotations.ts`）；批注的 **AI 处理工作流**才是 plane B。

## 新增技能

走 [`skills/skill-creator`](../../skills/skill-creator/SKILL.md)：复制 `_template/` → 填 SKILL.md + schema/ + examples/ → 在 `registry.json` 登记 → 同步 `src/docs/project-overview.md`。
