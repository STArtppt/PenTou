---
name: <skill-name>
description: <何时该用这个技能：用户在 Pentou 里做什么会触发它，产出什么>
---

# <Skill Name>

> Plane B 产品技能。被技能编排器（`POST /api/skills/run`）加载后驱动 LLM 调 Pentou `/api/*`。
> 运行时依赖只写 API 契约，不写死内部函数（保外部分发）。

## 前置检查

1. 探活运行时：`GET /api/health` 返回 `status: "ok"` 再继续；否则提示用户启动 Pentou 实例。

## 输入

- `<param>`：<说明>（schema 见 `schema/input.schema.json`）

## 工作流

1. <步骤 1> → 调 `<GET/POST /api/...>`
2. <步骤 2> → LLM：<做什么>
3. <步骤 3> → 产出 → 写回 `<POST /api/...>` / 落 `data/<产物目录>`

## 输出

- <产物形态>（schema 见 `schema/output.schema.json`）

## /api 依赖

| 端点 | 用途 |
| --- | --- |
| `GET /api/health` | 探活 |
| `<...>` | `<...>` |

## 边界

- 不写死内部函数调用；一律经 `/api/*`。
- 单一职责；产物落 gitignore 的 `data/` 子目录，不混入 `data/skills/`。
