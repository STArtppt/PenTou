---
name: topic-digest
description: 用户点名一个主题（「整理我聊过的检索方案」）时使用。先理解主题并扩展查询词，检索后做多维统计、深读最相关的 3 条，汇总成一篇带可点击来源清单的主题文档，落进 AI 空间。
---

# Topic Digest

> Plane B 产品技能。被 skill-runtime 的客户端 runner 加载执行；外部 agent 可读本文件 + 打同一 `/api/*` 数据层，自带 LLM 复现。

## 前置检查

- 探活：`GET /api/health` 返回 `status: "ok"`。

## 输入 / 输出

- 输入 schema：`schema/input.schema.json` — `{ topic, topK?, projectId?, lang? }`
- 输出 schema：`schema/output.schema.json` — `{ docId, folderId, topic, sourceCount, deepReadCount, stats, citations[] }`

## Workflow（线性）

| # | id | kind | 说明 |
| --- | --- | --- | --- |
| 1 | `understand` | `llm` | 语义理解主题：产出 3-5 个**扩展查询词**（同义 / 近义 / 英文表述）与一句主题界定；输出走 JSON 解析，模型给不出可用结果时退回原短语 |
| 2 | `search` | `api` | 每个扩展词各打一次 `GET /api/search?q=&mode=hybrid&limit=50`，按 `type:id` 去重取最高分、按相关度截前 50；再 `GET /api/conversations?fields=meta` 合并 `platform` / `ingestSource` / `sourceProject` / `date`。零命中直接失败并提示换说法 |
| 3 | `stats` | `transform` | **纯客户端**按平台 / 采集来源 / 所属项目 / 时间（按月）分桶计数，零 LLM |
| 4 | `deepRead` | `api` | 取相关度前 **3** 条的完整正文（`GET /api/conversations/:id` 或 `GET /api/documents/:id`），按 12000 字符截断：保留头 8000 + 尾 4000，中段标注略去条数 |
| 5 | `compose` | `llm` | 一次 LLM 产出：`## 主题界定` + `## 深读`（每条固定「概览 / 问题关注点与回答详情 / 评估总结」三小节）+ `## 整体评估` |
| 6 | `persist` | `api` | `POST /api/documents` 落进目标项目的 AI 空间。**统计表格与来源清单由客户端拼装，不经模型** |

### 检索上限为什么是 50

`/api/search` 服务端把 `limit` 硬夹在 50（`Math.min(50, n)`），写 100 只会被静默夹掉。因此统计口径是
**「相关度最高的 N 条」而不是全库普查**，产物的统计小节 MUST 显式标注这一点。

### 数字的来源

| 用途 | 取多少 |
| --- | --- |
| 多维统计 | 本次检索的全部命中（上限 50） |
| 深读 | 相关度前 3 |
| 来源清单 | 相关度前 10 |

命中不足时按**实际数量**输出，MUST NOT 补空位或编造。

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
| `GET /api/conversations?fields=meta` | 合并统计维度（平台 / 采集来源 / 所属项目 / 时间） |
| `GET /api/conversations/:id` | 深读会话全文 |
| `GET /api/documents/:id` | 深读文档全文 |
| `POST /api/documents` | 落汇总文档 |

## 边界

- **被引用的会话与文档一个字都不改** —— 会话的整理只以产出新文档的方式表达。
- **统计与来源清单不经模型**：分桶计数是确定性算术，链接目标一律取自检索结果的真实 id；
  模型输出的任何内容都不影响统计数字与跳转目标。
- 来源用应用内链接协议 `pentou://conversation|document/<id>` 书写，点击在应用内跳转。
- 只写材料里确实有的内容；材料没覆盖到的地方明说「材料中未涉及」，不补常识。
- LLM 由消费者自备（内部 = 客户端 `src/app/llm.ts`；外部 agent = 自带）。
