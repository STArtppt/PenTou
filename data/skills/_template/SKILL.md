---
name: <skill-name>
description: <何时该用这个技能：用户在 Pentou 里做什么会触发它，产出什么>
---

# <Skill Name>

> Plane B 产品技能。被 **skill-runtime** 的客户端 runner 加载后执行：`api` 步调 Pentou `/api/*` 取数据，
> `llm` 步在客户端调 LLM（复用 `src/app/llm.ts`），`transform` 步做纯变换。
> 运行时依赖只写 `/api/*` 契约，不写死内部函数（保外部分发；外部 agent 自带 LLM 消费同一契约）。

## 前置检查

- 探活运行时：`GET /api/health` 返回 `status: "ok"` 再继续。

## 输入 / 输出

- 输入 schema：`schema/input.schema.json`
- 输出 schema：`schema/output.schema.json`

## Workflow（线性、有序）

每步标注 `kind`：`api`（调 `/api/*`）| `llm`（客户端调 LLM）| `transform`（纯变换）。

| # | id | kind | 说明 |
| --- | --- | --- | --- |
| 1 | `<step-id>` | `api` | `<GET/POST /api/...>` → 取 `<数据>` |
| 2 | `<step-id>` | `transform` | 拼装上下文 / 套 prompt |
| 3 | `<step-id>` | `llm` | 作答 / 改写（promptRef: `<DEFAULT_PROMPT_*>`） |

## `/api` 依赖

| 端点 | 用途 |
| --- | --- |
| `GET /api/health` | 探活 |
| `<GET/POST /api/...>` | `<用途>` |

## 边界

- 不写死内部函数调用；数据依赖一律经 `/api/*`。
- 单一职责；运行产物落 gitignore 的 `data/` 子目录，不混入 `data/skills/`。
