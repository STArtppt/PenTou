---
name: topic-digest
description: 用户点名一个主题（「整理我聊过的检索方案」）时使用。经语义检索把散落在各处的相关片段捞出来，汇总成一篇带来源清单的主题文档，落进 AI 空间。
---

# Topic Digest

> Plane B 产品技能。被 skill-runtime 的客户端 runner 加载执行；外部 agent 可读本文件 + 打同一 `/api/*` 数据层，自带 LLM 复现。

## 前置检查

- 探活：`GET /api/health` 返回 `status: "ok"`。

## 输入 / 输出

- 输入 schema：`schema/input.schema.json` — `{ topic, topK?, projectId? }`
- 输出 schema：`schema/output.schema.json` — `{ docId, folderId, topic, sourceCount, citations[] }`

## Workflow（线性）

| # | id | kind | 说明 |
| --- | --- | --- | --- |
| 1 | `search` | `api` | `GET /api/search?q=<topic>&mode=hybrid&limit=<topK\|12>` → 命中片段；零命中直接失败并提示换说法 |
| 2 | `prompt` | `transform` | 把片段编号拼成上下文，套汇总 system prompt |
| 3 | `generate` | `llm` | 客户端调 LLM 产出 Markdown 汇总 |
| 4 | `persist` | `api` | `POST /api/documents` 落进目标项目的 AI 空间，正文尾部附来源清单 |

## 本期范围：用户点名主题，不做自动聚类

无监督主题发现（把上千条会话自动聚成簇）**不在本技能内**。理由：map-reduce 需要与会话数同量级的
客户端 LLM 调用，而自动发现的簇通常有相当比例是噪音或用户不关心的。点名主题这条路用现成的
`/api/search` 就能交付，且产出的东西用户一定想要。自动聚类另行立项。

## 落位规则

汇总是 **AI 的自主产物**，因此 MUST 落进 AI 空间（`projectId` 指定哪个项目就落哪个项目的 AI 空间，
省略则落默认目录的 AI 空间）。

## `/api` 依赖

| 端点 | 用途 |
| --- | --- |
| `GET /api/health` | 探活 |
| `GET /api/search?q&mode=hybrid&limit` | 语义/混合检索片段 |
| `POST /api/documents` | 落汇总文档 |

## 边界

- **被引用的会话与文档一个字都不改** —— 会话的整理只以产出新文档的方式表达。
- 只写片段里确实有的内容；片段没覆盖到的地方明说「片段中未涉及」，不补常识。
- LLM 由消费者自备（内部 = 客户端 `src/app/llm.ts`；外部 agent = 自带）。
