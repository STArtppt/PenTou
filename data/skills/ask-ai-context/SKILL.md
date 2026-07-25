---
name: ask-ai-context
description: 用户在 Pentou 点「Ask AI」提问时使用。读取上下文 + 语义检索相关片段，组上下文后调 LLM 作答，产出带引用的回答。
---

# Ask AI Context

> Plane B 产品技能。被 skill-runtime 的客户端 runner 加载执行；外部 agent 可读本文件 + 打同一 `/api/*` 数据层，自带 LLM 复现。

## 前置检查

- 探活：`GET /api/health` 返回 `status: "ok"`。

## 输入 / 输出

- 输入 schema：`schema/input.schema.json` — `{ query, scope?, topK? }`
- 输出 schema：`schema/output.schema.json` — `{ answer, citations[] }`

## Workflow（线性）

| # | id | kind | 说明 |
| --- | --- | --- | --- |
| 1 | `search` | `api` | `GET /api/search?q=<query>&mode=hybrid&limit=<topK\|6>` → 命中片段 |
| 2 | `context` | `transform` | 拼装上下文（`scope` + 检索片段 + 问题），套 `DEFAULT_PROMPT_AI_SIDEBAR` 为 system |
| 3 | `answer` | `llm` | 客户端 `chatCompletion` 作答（promptRef: `DEFAULT_PROMPT_AI_SIDEBAR`） |

产物：`answer` + `citations`（由检索命中的 `{type,id,title}` 得出）。无命中时上下文标注「（无检索命中）」，回答须说明上下文不足，`citations` 为空数组。

## `/api` 依赖

| 端点 | 用途 |
| --- | --- |
| `GET /api/health` | 探活 |
| `GET /api/search?q&mode=hybrid&limit` | 语义/混合检索片段 |

## 边界

- 检索经 `/api/search`，不直接调 search-service 函数。
- LLM 由消费者自备（内部 = 客户端 `src/app/llm.ts`；外部 agent = 自带）。
