/**
 * topic-digest — plane B 产品技能（主题会话汇总）。
 * 权威描述见 data/skills/topic-digest/SKILL.md。
 *
 * 本期由**用户点名主题**（不做无监督聚类）。六步：
 *   understand(llm) → search(api) → stats(transform) → deepRead(api) → compose(llm) → persist(api)
 *
 * 三条纪律（spec topic-digest-format）：
 *   - **统计不经模型**：分桶计数是确定性算术，模型做它只会更慢更容易错；
 *   - **来源清单不经模型**：链接目标一律取自检索结果的真实 id，模型说什么都不影响跳转到哪；
 *   - **命中不足就少给**，绝不补空位、绝不编造。
 *
 * 汇总是 AI 自主产物，因此落 AI 空间；被引用的会话一个字都不动（spec agent-write-policy）。
 */
import type { SkillDef, RunCtx } from "../skill-runtime";
import type { ChatMessage } from "../llm";
import { apiGet, apiSend, extractJson, newDocId } from "./skill-api";
import { fetchRetrievalHits, type RetrievalHit } from "./ask-ai-context";
import { buildInAppLink } from "../in-app-links";
import { normalizeSkillLang, skillStrings, type SkillLang } from "./skill-i18n";
import { aiWorkspaceFolderId, projectKey } from "@/shared/ai-workspace";

/**
 * 检索规模上限。**不要写 100** —— `/api/search` 服务端把 limit 硬夹在 50
 * （`Math.min(50, n)`），写大了只会被静默夹掉，反而让「统计覆盖多少」这件事对不上账。
 */
const SEARCH_TOP_K = 50;
/** 深读条数与来源条数：用户明确要的「最强相关 3 条」「10 条来源」。 */
const DEEP_READ_COUNT = 3;
const CITATION_COUNT = 10;
/** 扩展查询词上限：再多只是把同一批结果重取一遍。 */
const MAX_QUERIES = 4;

/** 深读截断（design D3）：头尾保留、中段丢弃。 */
export const DEEP_READ_MAX_CHARS = 12000;
export const DEEP_READ_HEAD_CHARS = 8000;
export const DEEP_READ_TAIL_CHARS = 4000;

const BLOCK_SEP = "\n\n";

const UNDERSTAND_SYSTEM = `你在为一次语义检索做主题理解。给你一个用户口语化的主题短语，你要：
1. 给出 3-5 个扩展查询词：同义说法、近义说法、对应的英文表述（用户很可能用中英混着聊）
2. 给出一句主题界定：这个主题实际指的是什么、边界在哪
只输出 JSON，形如 {"queries":["原短语","近义说法","English phrasing"],"scope":"一句话界定"}`;

const COMPOSE_SYSTEM = `你在写一篇主题汇总文档的正文。给你：一个主题、它的界定、以及相关度最高的几条对话的完整正文。要求：

1. 先写一节 \`## 主题界定\`：说清这个主题在这批对话里实际指什么、边界在哪
2. 再写一节 \`## 深读\`：给到的每条对话各起一个 \`### <序号> <标题>\`，其下**固定三个小节**：
   - \`#### 概览\`：这条对话在讲什么、走到哪一步
   - \`#### 问题关注点与回答详情\`：提问者真正关心什么、得到的回答给了什么
   - \`#### 评估总结\`：这条对话解决了没有、留了什么尾巴
3. 最后写一节 \`## 整体评估\`：这批对话合起来说明了什么、还缺什么
4. 只写材料里确实有的内容；材料没覆盖的地方明说「材料中未涉及」，不要补充常识
5. **不要**输出 H1 标题，**不要**写统计数字，**不要**列来源清单 —— 这三样由程序拼装
6. 直接输出 Markdown，不要任何前后说明`;

export interface TopicDigestStats {
  /** 本次统计所依据的命中数（即检索实际取回的条数）。 */
  total: number;
  platform: [string, number][];
  ingestSource: [string, number][];
  project: [string, number][];
  month: [string, number][];
}

export interface TopicDigestOutput {
  docId: string;
  folderId: string;
  topic: string;
  sourceCount: number;
  deepReadCount: number;
  stats: TopicDigestStats;
  citations: { type: string; id: string; title: string }[];
}

interface ConversationMeta {
  id: string;
  title: string;
  platform?: string;
  date?: string;
  ingestSource?: string;
  sourceProject?: string;
}

/** 命中 + 合并进来的元数据。文档命中没有平台/来源等维度，按「未标注」计。 */
export interface EnrichedHit extends RetrievalHit {
  platform?: string;
  ingestSource?: string;
  sourceProject?: string;
}

interface UnderstandResult {
  queries: string[];
  scope: string;
}

interface DeepReadEntry {
  hit: EnrichedHit;
  text: string;
  omitted: number;
}

/**
 * 深读截断（design D3）：**保留开头 8000 + 结尾 4000**，中段丢弃。
 *
 * 为什么头尾而不是从开头截：AI 对话的开头是问题、结尾是结论 —— 正是用户要的
 * 「问题关注点」与「评估总结」。从中间截能同时保住两端，从开头截会把结论全丢掉。
 *
 * 略去条数按**字符区间完全落在被丢弃中段内**的消息计，因此对「一条超长消息」这种
 * 边界也给得出诚实的数字。
 */
export function truncateDeepRead(
  blocks: string[],
  marker: (omitted: number) => string,
  max = DEEP_READ_MAX_CHARS,
  head = DEEP_READ_HEAD_CHARS,
  tail = DEEP_READ_TAIL_CHARS,
): { text: string; omitted: number } {
  const joined = blocks.join(BLOCK_SEP);
  if (joined.length <= max) return { text: joined, omitted: 0 };

  const dropStart = head;
  const dropEnd = joined.length - tail;

  let cursor = 0;
  let omitted = 0;
  for (const block of blocks) {
    const start = cursor;
    const end = cursor + block.length;
    if (start >= dropStart && end <= dropEnd) omitted++;
    cursor = end + BLOCK_SEP.length;
  }

  return { text: `${joined.slice(0, head)}${marker(omitted)}${joined.slice(dropEnd)}`, omitted };
}

/** 纯客户端分桶计数（spec：统计 MUST NOT 交由模型生成）。 */
export function bucketCount(
  values: (string | undefined | null)[],
  unknownLabel: string,
): [string, number][] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const key = raw && String(raw).trim() ? String(raw).trim() : unknownLabel;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function computeStats(hits: EnrichedHit[], unknownLabel: string): TopicDigestStats {
  return {
    total: hits.length,
    platform: bucketCount(hits.map((h) => h.platform), unknownLabel),
    ingestSource: bucketCount(hits.map((h) => h.ingestSource), unknownLabel),
    project: bucketCount(hits.map((h) => h.sourceProject), unknownLabel),
    // 时间按月分桶：日粒度太碎，年粒度看不出节奏
    month: bucketCount(hits.map((h) => (h.date ? String(h.date).slice(0, 7) : undefined)), unknownLabel),
  };
}

function renderStatsTable(title: string, rows: [string, number][], s: ReturnType<typeof skillStrings>): string {
  const lines = [`### ${title}`, "", `| ${s.digest.tableValue} | ${s.digest.tableCount} |`, "| --- | --- |"];
  for (const [value, count] of rows) lines.push(`| ${value} | ${count} |`);
  return lines.join("\n");
}

/** 来源清单：链接目标一律取自检索结果的真实 id，绝不经模型（spec）。 */
export function renderCitations(hits: EnrichedHit[], lang: SkillLang): string {
  const s = skillStrings(lang).digest;
  return hits
    .map((hit) => {
      const href = buildInAppLink(hit.type, hit.id);
      const kind = hit.type === "conversation" ? s.conversationLabel : s.documentLabel;
      const facts = [kind, hit.platform, hit.date?.slice(0, 10)].filter(Boolean).join(" · ");
      return `- [${hit.title}](${href})（${facts}）`;
    })
    .join("\n");
}

export const topicDigest: SkillDef = {
  id: "topic-digest",
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string" },
      topK: { type: "integer" },
      projectId: { type: "string" },
      lang: { type: "string" },
    },
    required: ["topic"],
    additionalProperties: false,
  },
  steps: [
    {
      id: "understand",
      kind: "llm",
      run: async (ctx: RunCtx): Promise<UnderstandResult> => {
        const { topic } = ctx.input as { topic: string };
        const messages: ChatMessage[] = [
          { role: "system", content: UNDERSTAND_SYSTEM },
          { role: "user", content: `# 主题\n${topic}` },
        ];
        const { content } = await ctx.deps.callLLM(ctx.deps.llmConfig, messages, { signal: ctx.deps.signal });
        const parsed = extractJson<{ queries?: unknown; scope?: unknown }>(content);
        const queries = Array.isArray(parsed?.queries)
          ? parsed!.queries.map((q) => String(q).trim()).filter(Boolean)
          : [];
        // 模型没给出可用的扩展词时退回原短语 —— 召回打折，但不该因此整条流程失败
        const merged = [topic, ...queries.filter((q) => q !== topic)].slice(0, MAX_QUERIES);
        return { queries: merged, scope: typeof parsed?.scope === "string" ? parsed.scope : "" };
      },
    },
    {
      id: "search",
      kind: "api",
      run: async (ctx: RunCtx): Promise<EnrichedHit[]> => {
        const { topic, topK } = ctx.input as { topic: string; topK?: number };
        const { queries } = ctx.results.understand as UnderstandResult;
        const limit = typeof topK === "number" ? topK : SEARCH_TOP_K;

        // 多个查询词各检索一次，按 id 去重取最高分 —— 扩展词是为了召回，不是为了重复计数
        const best = new Map<string, RetrievalHit>();
        for (const query of queries) {
          const hits = await fetchRetrievalHits(query, ctx.deps, limit);
          for (const hit of hits) {
            const key = `${hit.type}:${hit.id}`;
            const prev = best.get(key);
            if (!prev || (hit.score ?? 0) > (prev.score ?? 0)) best.set(key, hit);
          }
        }
        const ranked = [...best.values()]
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, limit);
        if (!ranked.length) {
          throw new Error(`没有检索到与「${topic}」相关的内容，换个说法或换个主题试试`);
        }

        // 元数据合并：平台 / 采集来源 / 所属项目 / 时间，四个维度服务端已就绪，无需新契约
        const metas = await apiGet<ConversationMeta[]>(ctx.deps, "/api/conversations?fields=meta");
        const metaById = new Map(metas.map((m) => [m.id, m]));
        return ranked.map((hit) => {
          const meta = hit.type === "conversation" ? metaById.get(hit.id) : undefined;
          return {
            ...hit,
            date: hit.date ?? meta?.date,
            platform: meta?.platform,
            ingestSource: meta?.ingestSource,
            sourceProject: meta?.sourceProject,
          };
        });
      },
    },
    {
      id: "stats",
      kind: "transform",
      run: async (ctx: RunCtx): Promise<TopicDigestStats> => {
        const lang = normalizeSkillLang((ctx.input as { lang?: string }).lang);
        const hits = ctx.results.search as EnrichedHit[];
        return computeStats(hits, skillStrings(lang).digest.unknownBucket);
      },
    },
    {
      id: "deepRead",
      kind: "api",
      run: async (ctx: RunCtx): Promise<DeepReadEntry[]> => {
        const s = skillStrings(normalizeSkillLang((ctx.input as { lang?: string }).lang)).digest;
        const hits = (ctx.results.search as EnrichedHit[]).slice(0, DEEP_READ_COUNT);
        const entries: DeepReadEntry[] = [];
        for (const hit of hits) {
          let blocks: string[] = [];
          if (hit.type === "conversation") {
            const conv = await apiGet<{ messages?: { role: string; content: string }[] }>(
              ctx.deps,
              `/api/conversations/${hit.id}`,
            );
            blocks = (conv.messages ?? []).map(
              (m) => `**${m.role === "user" ? "User" : "AI"}**: ${m.content}`,
            );
          } else {
            const doc = await apiGet<{ body?: string }>(ctx.deps, `/api/documents/${hit.id}`);
            blocks = (doc.body ?? "").split(/\n{2,}/);
          }
          const { text, omitted } = truncateDeepRead(blocks, s.truncated);
          entries.push({ hit, text, omitted });
        }
        return entries;
      },
    },
    {
      id: "compose",
      kind: "llm",
      run: async (ctx: RunCtx): Promise<string> => {
        const { topic } = ctx.input as { topic: string };
        const { scope } = ctx.results.understand as UnderstandResult;
        const entries = ctx.results.deepRead as DeepReadEntry[];

        const blocks = entries
          .map((entry, i) => `## [${i + 1}] ${entry.hit.title}\n\n${entry.text}`)
          .join("\n\n---\n\n");

        const messages: ChatMessage[] = [
          { role: "system", content: COMPOSE_SYSTEM },
          {
            role: "user",
            content:
              `# 主题\n${topic}\n\n# 主题界定（检索前的初步理解，可修正）\n${scope || "（未给出）"}\n\n` +
              `# 相关度最高的 ${entries.length} 条对话正文\n\n${blocks}`,
          },
        ];
        const { content } = await ctx.deps.callLLM(ctx.deps.llmConfig, messages, { signal: ctx.deps.signal });
        if (!content.trim()) throw new Error("模型没有产出任何内容");
        return content;
      },
    },
    {
      id: "persist",
      kind: "api",
      run: async (ctx: RunCtx): Promise<{ docId: string; folderId: string }> => {
        const { topic, projectId, lang: rawLang } = ctx.input as {
          topic: string;
          projectId?: string;
          lang?: string;
        };
        const lang = normalizeSkillLang(rawLang);
        const s = skillStrings(lang);
        const hits = ctx.results.search as EnrichedHit[];
        const stats = ctx.results.stats as TopicDigestStats;
        const composed = ctx.results.compose as string;

        const scope = projectId && projectId !== projectKey(null) ? projectId : null;
        const docId = newDocId();
        const folderId = aiWorkspaceFolderId(scope);
        const now = new Date().toISOString();

        // 统计表格与来源清单由**客户端**拼装，不经模型：数字要准、链接要真
        const statsSection = [
          s.digest.statsHeading,
          "",
          s.digest.statsScopeNote(stats.total),
          "",
          renderStatsTable(s.digest.dimPlatform, stats.platform, s),
          "",
          renderStatsTable(s.digest.dimIngestSource, stats.ingestSource, s),
          "",
          renderStatsTable(s.digest.dimProject, stats.project, s),
          "",
          renderStatsTable(s.digest.dimMonth, stats.month, s),
        ].join("\n");

        // 命中不足 10 条就列实际条数（spec：MUST NOT 补空位）
        const citations = renderCitations(hits.slice(0, CITATION_COUNT), lang);

        const body = [
          `# ${s.digest.docTitle(topic)}`,
          "",
          composed.trim(),
          "",
          "---",
          "",
          statsSection,
          "",
          "---",
          "",
          s.digest.sourcesHeading,
          "",
          citations,
          "",
        ].join("\n");

        await apiSend(ctx.deps, "POST", "/api/documents", {
          id: docId,
          title: s.digest.docTitle(topic),
          folderId,
          ...(scope ? { projectId: scope } : {}),
          createdAt: now,
          updatedAt: now,
          body,
          generatedBy: ctx.deps.llmConfig.model,
          generatedAt: now,
        });
        return { docId, folderId };
      },
    },
  ],
  buildOutput: (ctx: RunCtx): TopicDigestOutput => {
    const { topic } = ctx.input as { topic: string };
    const hits = (ctx.results.search as EnrichedHit[]) ?? [];
    const stats = ctx.results.stats as TopicDigestStats;
    const entries = (ctx.results.deepRead as DeepReadEntry[]) ?? [];
    const { docId, folderId } = ctx.results.persist as { docId: string; folderId: string };
    return {
      docId,
      folderId,
      topic,
      sourceCount: hits.length,
      deepReadCount: entries.length,
      stats,
      citations: hits.slice(0, CITATION_COUNT).map((hit) => ({ type: hit.type, id: hit.id, title: hit.title })),
    };
  },
};
