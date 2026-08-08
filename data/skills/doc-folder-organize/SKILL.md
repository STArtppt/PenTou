---
name: doc-folder-organize
description: 用户点「整理这个项目的文档目录」时使用。列出现有目录与待归类文档，让 LLM 提议归类，产出一篇带复选框的行动计划文档等待批准 —— 在批准前一篇文档都不改。
---

# Doc Folder Organize

> Plane B 产品技能。被 skill-runtime 的客户端 runner 加载执行；外部 agent 可读本文件 + 打同一 `/api/*` 数据层，自带 LLM 复现。

## 前置检查

- 探活：`GET /api/health` 返回 `status: "ok"`。

## 输入 / 输出

- 输入 schema：`schema/input.schema.json` — `{ projectId?, planTitle? }`
- 输出 schema：`schema/output.schema.json` — `{ planDocId, folderId, itemCount, candidateCount, notes[] }`

## Workflow（线性）

| # | id | kind | 说明 |
| --- | --- | --- | --- |
| 1 | `inventory` | `api` | 列文档元数据 + 文件夹 + 项目；筛出本项目的归类候选，并审计数据异常 |
| 2 | `prompt` | `transform` | 把「已有文件夹」与「待归类文档」拼成上下文，要求模型只输出 JSON |
| 3 | `propose` | `llm` | 客户端调 LLM 产出 `{"items":[{docId, folderName, reason}]}` |
| 4 | `plan` | `api` | `POST /api/documents` 把计划落进 AI 空间：正文是复选框条目，`aiPlan` frontmatter 存结构化绑定与快照 |

## 计划文档批准协议

这是本期唯一「批量且改动既有数据」的操作，因此 MUST 先出计划、经用户勾选批准后才执行。

- 正文每条以 `- [ ]` 开头；**执行时只读复选框、不解析条目文字** —— 用户可以随便改写描述或加注解
- 只执行被勾选的条目（支持部分批准）
- `aiPlan` 记录 `snapshot`（涉及文档的 `id` + `updatedAt`）与 `folderBaseline`（文件夹表基底）
- 执行前逐条比对：任一失配即**中止并要求重新生成**，绝不在陈旧计划上行动

## 候选集边界

- 记忆文档与 AI 空间里的一切**不进候选集**，也不会出现在计划的任何条目里
- 只看当前项目的文档；跨项目的归类不在本技能范围

## 遇到不一致的既有数据

孤儿文件夹（`projectId` 指向已不存在的项目）、重名文件夹等异常，MUST **只在计划的
「只报告，不处置」区如实列出**，MUST NOT 自动删除、合并或改写。首次跑整理时这是最容易出事的地方 ——
一个「聪明」的 agent 很可能顺手把用户的数据清理掉。

## `/api` 依赖

| 端点 | 用途 |
| --- | --- |
| `GET /api/health` | 探活 |
| `GET /api/documents?fields=meta` | 列待归类文档（不取正文） |
| `GET /api/document-folders` | 列现有文件夹（含 AI 空间） |
| `GET /api/document-projects` | 判定孤儿文件夹 |
| `POST /api/documents` | 落计划文档 |

执行阶段（用户批准后）另用 `POST /api/document-folders`（只增不改删）与 `PUT /api/documents/:id`（只改归属）。

## 边界

- 本技能到**产出计划**为止，不改动任何文档。
- AI 不删除文档或文件夹；删除只能作为计划条目提议，由用户自己执行。
- 文件夹写入只增不改删，且写前重读为基底 —— 文件夹表是整表覆写且无并发控制。
- LLM 由消费者自备（内部 = 客户端 `src/app/llm.ts`；外部 agent = 自带）。
