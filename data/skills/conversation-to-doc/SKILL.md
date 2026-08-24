---
name: conversation-to-doc
description: 用户点「把这个会话转成文档」时使用。读会话原文，调 LLM 整理成结构化 Markdown，落成一篇文档；同一会话再转一次会覆盖既有产物，但先落新版本保证可回滚。
---

# Conversation to Doc

> Plane B 产品技能。被 skill-runtime 的客户端 runner 加载执行；外部 agent 可读本文件 + 打同一 `/api/*` 数据层，自带 LLM 复现。

## 前置检查

- 探活：`GET /api/health` 返回 `status: "ok"`。

## 输入 / 输出

- 输入 schema：`schema/input.schema.json` — `{ conversationId, projectId? }`
- 输出 schema：`schema/output.schema.json` — `{ docId, title, created, projectId, versionId? }`

## Workflow（线性）

| # | id | kind | 说明 |
| --- | --- | --- | --- |
| 1 | `load` | `api` | `GET /api/conversations/:id` → 会话原文 |
| 2 | `prompt` | `transform` | 序列化会话，套 `DEFAULT_PROMPT_CONVERT`（技能内置，非用户设置） |
| 3 | `generate` | `llm` | 客户端调 LLM 产出 Markdown 全文 |
| 4 | `persist` | `api` | 无既有产物 → `POST /api/documents`；有 → `POST /api/documents/:id/commit-version` 再 `PUT` 更新标题与血缘 |

标题取产出正文的首个 H1，没有则退回会话标题。

## 落位规则

产物是**用户点名要的**，因此落用户的地盘、**不落 AI 空间**：

- 来源会话带项目属性 → 继承该项目
- 来源跨多个项目 / 无项目属性 → 落默认目录

新建时 `folderId` 为空（落该项目的「未分类」），由用户或「整理文档目录」后续归类。

## 覆盖既有产物

同一会话再次转文档会覆盖既有正文。这在写权限模型下属于「AI 改自己生成的文档」（该文档带
`sourceConversationId`），**允许**；但改写 MUST 经 `commit-version` 落为新版本 ——
可回滚是这个行为可被接受的唯一前提。

## `/api` 依赖

| 端点 | 用途 |
| --- | --- |
| `GET /api/health` | 探活 |
| `GET /api/conversations/:id` | 读会话原文（带 `favorite`） |
| `GET /api/conversations?fields=meta&favorite=1` | 批量场景下只取**我收藏的**那批候选（可选） |
| `GET /api/documents?fields=meta` | 找同一会话的既有产物 |
| `POST /api/documents` | 新建文档 |
| `POST /api/documents/:id/commit-version` | 覆盖既有产物（落新版本） |
| `PUT /api/documents/:id` | 更新标题与生成血缘 |

## 注意力权重（spec content-favorites）

会话与文档都带 `favorite`（缺键即未收藏）。它的语义是「用户常看 / 关注」，在本技能里有两处用法：

- **批量挑选候选时**：列表接口支持 `?favorite=1`，可直接把范围收敛到用户收藏的那批，
  而不是让模型在几十条里自己猜哪些重要。
- **给模型的候选清单**：收藏条目 MUST 标 `★` 并附一句「★ = 我收藏的，优先阅读」。
  **只标「有」不标「无」** —— 给未收藏项挂一句否定说明纯属噪声。

权重只影响**读的优先级**，MUST NOT 影响产物的落位、覆盖判定或版本策略。

## 边界

- **不改动会话本身**（内容、标题、`folderId` 一概不动）——会话按来源平台归类，那是采集来源而非分类。
- 不落 AI 空间；AI 空间只放 AI 的自主产物。
- LLM 由消费者自备（内部 = 客户端 `src/app/llm.ts`；外部 agent = 自带）。
