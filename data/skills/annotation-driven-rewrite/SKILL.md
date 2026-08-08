---
name: annotation-driven-rewrite
description: 用户在文档上留了批注、点「根据批注重写」时使用。读文档正文与带评论的批注，调 LLM 产出修订后的完整 Markdown 提案 —— 只产出提案，落盘由确认对话框完成。
---

# Annotation Driven Rewrite

> Plane B 产品技能。被 skill-runtime 的客户端 runner 加载执行；外部 agent 可读本文件 + 打同一 `/api/*` 数据层，自带 LLM 复现。

## 前置检查

- 探活：`GET /api/health` 返回 `status: "ok"`。
- 目标文档至少有一条**带评论**的批注；没有则技能失败并说明原因。

## 输入 / 输出

- 输入 schema：`schema/input.schema.json` — `{ docId, annotationIds? }`
- 输出 schema：`schema/output.schema.json` — `{ docId, proposedBody, annotationCount, usedAnnotationIds[] }`

## Workflow（线性）

| # | id | kind | 说明 |
| --- | --- | --- | --- |
| 1 | `load` | `api` | `GET /api/documents/:id` + `GET /api/documents/:id/annotations`；先过写权限校验 |
| 2 | `prompt` | `transform` | 原文 + 批注列表（含定位上下文），套 `DEFAULT_PROMPT_REWRITE`（技能内置，非用户设置） |
| 3 | `rewrite` | `llm` | 客户端调 LLM 产出修订后的**完整** Markdown（不是 diff） |

## 只产出提案，不落盘

本技能 MUST NOT 自行写入文档。确认与落盘由既有的重写确认对话框完成 ——
那个对话框就是这件事的「计划」，不该再套一层计划文档（单件 + 产物即预览的操作不应因统一入口而增加步骤）。

调用方在用户确认后负责：
1. `POST /api/documents/:id/commit-version`（`type: "pre-llm-rewrite"`）留下改写前的正文
2. `POST /api/documents/:id/commit-version`（`type: "llm-rewrite"`，带 `sourceAnnotationIds`）落新正文
3. 重定位批注并 `PUT /api/documents/:id/annotations`

## 写权限

改写正文按**出身**划权限，且校验在 LLM 调用**之前**完成 —— 改不了的文档不该让用户先等一次生成再被拒绝：

- 可改：带 `generatedBy` / `sourceConversationId` / `sourceAiChatId` 的 AI 产物，以及 AI 空间内的一切
- 不可改：用户导入或手写的文档正文

## `/api` 依赖

| 端点 | 用途 |
| --- | --- |
| `GET /api/health` | 探活 |
| `GET /api/documents/:id` | 读原文与出身元数据 |
| `GET /api/documents/:id/annotations` | 读批注 |

## 边界

- 输出是**完整 Markdown 全文**，不是 diff；批注与原文矛盾时按批注优先。
- 不落盘、不改批注 —— 那是确认环节的职责。
- LLM 由消费者自备（内部 = 客户端 `src/app/llm.ts`；外部 agent = 自带）。
