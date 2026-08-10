import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChatGptApi } from "./chatgpt-api";
import { normalizeDeepSeekApi } from "./deepseek-api";
import { normalizeDoubaoApi } from "./doubao-api";
import { normalizeQwenApi } from "./qwen-api";
import { normalizeQwenIntlApi } from "./qwen-intl-api";
import { normalizeGeminiApi } from "./gemini-api";
import { mapDoubaoMessageList } from "../share-parsers/doubao";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fixture = (name: string) => fs.readFileSync(path.join(fixturesDir, name), "utf-8");

describe("ChatGPT API normalizer", () => {
  it("takes the active mapping branch and skips hidden/system messages", () => {
    const raw = JSON.stringify({
      id: "chatcmpl-1",
      title: "Branchy",
      create_time: 1783560000,
      mapping: {
        root: { id: "root", parent: null, children: ["u1"], message: null },
        u1: {
          id: "u1",
          parent: "root",
          children: ["a_old", "a_new"],
          message: {
            author: { role: "user" },
            create_time: 1783560001,
            content: { parts: ["hello"] },
          },
        },
        a_old: {
          id: "a_old",
          parent: "u1",
          children: [],
          message: {
            author: { role: "assistant" },
            create_time: 1783560002,
            content: { parts: ["old answer"] },
          },
        },
        a_new: {
          id: "a_new",
          parent: "u1",
          children: [],
          message: {
            author: { role: "assistant" },
            create_time: 1783560003,
            content: { parts: ["new answer"] },
          },
        },
      },
    });

    const [conv] = normalizeChatGptApi(raw);
    expect(conv.title).toBe("Branchy");
    expect(conv.platform).toBe("ChatGPT");
    expect(conv.messages.map((m) => m.content)).toEqual(["hello", "new answer"]);
  });

  // 回归：真实采集中 ChatGPT 对个别 assistant 消息返回了远早于会话创建时间的 create_time
  // （debugging/2026-07-20-chatgpt-extension-stale-message-timestamp.md）
  it("marks dateFromSource so a stale message create_time cannot drag the date back", () => {
    const raw = JSON.stringify({
      id: "6a5dc6cd-0f48-83e8-8d52-1b773a573718",
      title: "梅西评价分析",
      create_time: 1784530637.811463, // 2026-07-20T06:57:17.811Z
      update_time: 1784532318.488657,
      mapping: {
        root: { id: "root", parent: null, children: ["u1"], message: null },
        u1: {
          id: "u1",
          parent: "root",
          children: ["a1"],
          message: { author: { role: "user" }, create_time: 1784530636.656, content: { parts: ["如何评价梅西"] } },
        },
        a1: {
          id: "a1",
          parent: "u1",
          children: [],
          // 平台返回的过期时间戳：2026-07-17T10:58:47.957Z，早于会话创建时间三天
          message: { author: { role: "assistant" }, create_time: 1784285927.957723, content: { parts: ["梅西是……"] } },
        },
      },
    });

    const [conv] = normalizeChatGptApi(raw);
    expect(conv.date).toBe("2026-07-20T06:57:17.811Z");
    expect(conv.dateFromSource).toBe(true);
    // 消息原始时间按 US-01 保真，不做改写
    expect(conv.messages[1].timestamp).toBe("2026-07-17T10:58:47.957Z");
  });

  it("throws a platform-specific error for unexpected payloads", () => {
    expect(() => normalizeChatGptApi("{}")).toThrow("chatgpt raw payload missing mapping");
  });
});

describe("DeepSeek API normalizer", () => {
  it("maps biz_data messages and THINK fragments", () => {
    const raw = JSON.stringify({
      data: {
        biz_data: {
          title: "DeepSeek topic",
          created_at: "2026-07-09T00:00:00.000Z",
          messages: [
            { role: "user", content: "question", created_at: "2026-07-09T00:00:01.000Z" },
            {
              role: "assistant",
              created_at: "2026-07-09T00:00:02.000Z",
              fragments: [
                { type: "THINK", content: "think line" },
                { type: "RESPONSE", content: "answer" },
              ],
            },
          ],
        },
      },
    });

    const [conv] = normalizeDeepSeekApi(raw);
    expect(conv.title).toBe("DeepSeek topic");
    expect(conv.platform).toBe("DeepSeek");
    expect(conv.messages[0]).toMatchObject({ role: "user", content: "question" });
    expect(conv.messages[1].content).toBe("answer");
    expect(conv.messages[1].content).not.toContain("Thinking Process");
    expect(conv.messages[1].reasoning?.thinking).toBe("think line");
  });

  // 登录态 GET /api/v0/chat/history_messages 的真实响应形态（2026-07-20 勘测确认字段名）
  it("maps the logged-in history_messages shape (chat_messages + chat_session)", () => {
    const raw = JSON.stringify({
      code: 0,
      msg: "",
      data: {
        biz_data: {
          chat_session: {
            id: "842f4bcb-dae7-4777-96a7-2e54703f9999",
            title: "梅西评价分析",
            inserted_at: "2026-07-20T06:57:17.811Z",
          },
          chat_messages: [
            {
              message_id: 1,
              parent_id: null,
              role: "USER",
              inserted_at: "2026-07-20T06:57:16.656Z",
              fragments: [{ type: "REQUEST", content: "如何评价梅西" }],
            },
            {
              message_id: 2,
              parent_id: 1,
              role: "ASSISTANT",
              inserted_at: "2026-07-20T06:57:20.000Z",
              fragments: [
                { type: "THINK", content: "先分点" },
                { type: "RESPONSE", content: "梅西是……" },
              ],
            },
          ],
          cache_control: {},
          cache_reset_at: 1784534306,
        },
      },
    });

    const [conv] = normalizeDeepSeekApi(raw);
    expect(conv.title).toBe("梅西评价分析");
    expect(conv.platform).toBe("DeepSeek");
    expect(conv.date).toBe("2026-07-20T06:57:17.811Z");
    expect(conv.dateFromSource).toBe(true);
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0]).toMatchObject({ role: "user", content: "如何评价梅西" });
    expect(conv.messages[0].timestamp).toBe("2026-07-20T06:57:16.656Z");
    expect(conv.messages[1].role).toBe("ai");
    expect(conv.messages[1].content).toBe("梅西是……");
    expect(conv.messages[1].content).not.toContain("Thinking Process");
    expect(conv.messages[1].reasoning?.thinking).toBe("先分点");
  });

  it("also accepts export-style mapping payloads", () => {
    const raw = JSON.stringify({
      id: "ds-1",
      title: "Mapping",
      inserted_at: "2026-07-09T00:00:00.000Z",
      mapping: {
        root: { parent: null, children: ["u1"] },
        u1: {
          parent: "root",
          children: [],
          message: { fragments: [{ type: "REQUEST", content: "hello" }] },
        },
      },
    });

    const [conv] = normalizeDeepSeekApi(raw);
    expect(conv.messages.map((m) => m.content)).toEqual(["hello"]);
  });

  it("throws a platform-specific error for unexpected payloads", () => {
    expect(() => normalizeDeepSeekApi("{}")).toThrow("deepseek raw payload missing mapping or biz_data.messages");
  });
});

describe("Doubao API normalizer", () => {
  it("normalizes login payload with roles, order, and generated images", () => {
    const [conv] = normalizeDoubaoApi(fixture("doubao-history.json"));
    expect(conv.platform).toBe("Doubao");
    expect(conv.messages.length).toBeGreaterThanOrEqual(2);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[1].role).toBe("ai");
    expect(conv.messages[0].content).toContain("单字母");
    expect(conv.messages[1].content).toMatch(/!\[生成图片/);
    // index_in_conv 倒序已反转：用户在前
    expect(conv.messages[0].timestamp <= conv.messages[1].timestamp).toBe(true);
  });

  it("throws platform-named error for empty content_block degraded 200 payload", () => {
    const degraded = JSON.stringify({
      downlink_body: {
        pull_singe_chain_downlink_body: {
          messages: [
            {
              user_type: 1,
              index_in_conv: "1",
              create_time: "1784258229",
              content_type: 1,
              content: "",
              content_block: [],
            },
            {
              user_type: 2,
              index_in_conv: "2",
              create_time: "1784258230",
              content_type: 9998,
              content: "",
              content_block: [],
            },
          ],
        },
      },
    });
    expect(() => normalizeDoubaoApi(degraded)).toThrow(/doubao/i);
    expect(() => normalizeDoubaoApi(degraded)).toThrow(/empty content_block|degraded/i);
  });

  it("throws platform-named error for unexpected structure", () => {
    expect(() => normalizeDoubaoApi("{}")).toThrow(/doubao/i);
  });

  it("produces equivalent Message sequences for share-style and login-style fixtures of the same dialogue", () => {
    // 合成同一语义对话的两条路径（结构不同，输出契约一致）
    const createTime = 1784258229;
    const shareList = [
      {
        index: 0,
        user_type: 1,
        create_time: createTime,
        content_block: [{ content: { text_block: { text: "请使用单字母 S 试试" } } }],
      },
      {
        index: 1,
        user_type: 2,
        create_time: createTime + 1,
        content_block: [
          { content: { text_block: { text: "我会做成单字母符号" } } },
          {
            content: {
              creation_block: {
                creations: [
                  { image: { image_ori: { url: "https://example.com/gen1.png" } } },
                ],
              },
            },
          },
        ],
      },
    ];
    const loginPayload = JSON.stringify({
      downlink_body: {
        pull_singe_chain_downlink_body: {
          messages: [
            {
              user_type: 2,
              index_in_conv: "2",
              create_time: String(createTime + 1),
              content_block: [
                { block_type: 10000, content: { text_block: { text: "我会做成单字母符号" } } },
                {
                  block_type: 2074,
                  content: {
                    creation_block: {
                      creations: [{ image: { image_ori: { url: "https://example.com/gen1.png" } } }],
                    },
                  },
                },
              ],
            },
            {
              user_type: 1,
              index_in_conv: "1",
              create_time: String(createTime),
              content_block: [{ block_type: 10000, content: { text_block: { text: "请使用单字母 S 试试" } } }],
            },
          ],
        },
      },
    });

    const shareMsgs = mapDoubaoMessageList(shareList);
    const [loginConv] = normalizeDoubaoApi(loginPayload);

    expect(shareMsgs.map((m) => m.role)).toEqual(loginConv.messages.map((m) => m.role));
    expect(shareMsgs.map((m) => m.content.replace(/\s+/g, " ").trim())).toEqual(
      loginConv.messages.map((m) => m.content.replace(/\s+/g, " ").trim()),
    );
    // 时间戳口径：秒级 → ISO
    expect(shareMsgs[0].timestamp).toBe(new Date(createTime * 1000).toISOString());
    expect(loginConv.messages[0].timestamp).toBe(new Date(createTime * 1000).toISOString());
  });

  it("maps block_type 10025 into reasoning.search (not content) and keeps 14 results", () => {
    const results = Array.from({ length: 14 }, (_, i) => ({
      text_card: {
        title: `资料 ${i + 1}`,
        url: `https://example.com/r${i + 1}`,
        sitename: "Example",
        summary: `摘要 ${i + 1}`,
      },
    }));
    const raw = JSON.stringify({
      downlink_body: {
        pull_singe_chain_downlink_body: {
          messages: [
            {
              user_type: 1,
              index_in_conv: "1",
              create_time: "1785000000",
              content_block: [{ block_type: 10000, content: { text_block: { text: "问一下" } } }],
            },
            {
              user_type: 2,
              index_in_conv: "2",
              create_time: "1785000001",
              thinking_content: "  先列检索词  ",
              content_block: [
                {
                  block_type: 10025,
                  content: {
                    search_query_result_block: {
                      summary: "搜索 2 个关键词，参考 14 篇资料",
                      queries: ["q1", "q2"],
                      results,
                    },
                  },
                },
                {
                  block_type: 10000,
                  content: { text_block: { text: "最终答案在此" } },
                },
              ],
            },
          ],
        },
      },
    });
    const [conv] = normalizeDoubaoApi(raw);
    const ai = conv.messages[1];
    expect(ai.content).toBe("最终答案在此");
    expect(ai.content).not.toContain("搜索");
    expect(ai.content).not.toContain("资料 1");
    expect(ai.reasoning?.search).toContain("**搜索词**");
    expect(ai.reasoning?.search).toContain("[资料 14]");
    expect(ai.reasoning?.search).not.toMatch(/摘要 14/);
    expect(ai.reasoning?.thinking).toBe("先列检索词");
  });

  it("dedupes identical 10025 blocks within one message", () => {
    const searchBlock = {
      block_type: 10025,
      content: {
        search_query_result_block: {
          summary: "same",
          queries: ["q"],
          results: [{ text_card: { title: "T", url: "https://ex.com", sitename: "S", summary: "s" } }],
        },
      },
    };
    const raw = JSON.stringify({
      downlink_body: {
        pull_singe_chain_downlink_body: {
          messages: [
            {
              user_type: 1,
              index_in_conv: "1",
              create_time: "1785000000",
              content_block: [{ block_type: 10000, content: { text_block: { text: "q" } } }],
            },
            {
              user_type: 2,
              index_in_conv: "2",
              create_time: "1785000001",
              content_block: [
                searchBlock,
                searchBlock,
                { block_type: 10000, content: { text_block: { text: "answer" } } },
              ],
            },
          ],
        },
      },
    });
    const [conv] = normalizeDoubaoApi(raw);
    const search = conv.messages[1].reasoning?.search ?? "";
    expect(search.match(/same/g)?.length).toBe(1);
  });

  it("share and login paths produce equivalent content + reasoning for search blocks", () => {
    // 样本语义对齐 doubao.com/thread/x5379fIAmQ9uedjAw（fixture: doubao-share-search.json）
    const share = JSON.parse(fixture("doubao-share-search.json"));
    const createTime = 1785000100;
    const searchPayload = {
      search_query_result_block: {
        summary: "搜索 1 个关键词，参考 2 篇资料",
        queries: ["潜水员戴夫 店铺等级"],
        results: [
          {
            text_card: {
              title: "店铺等级对照",
              url: "https://example.com/a",
              sitename: "TapTap",
              summary: "白银最多接待 20 位",
            },
          },
          {
            text_card: {
              title: "备菜数量",
              url: "https://example.com/b",
              sitename: "Bilibili",
              summary: "钻石 45 位",
            },
          },
        ],
      },
    };
    const loginPayload = JSON.stringify({
      downlink_body: {
        pull_singe_chain_downlink_body: {
          messages: [
            {
              user_type: 1,
              index_in_conv: "1",
              create_time: String(createTime),
              content_block: [
                { block_type: 10000, content: { text_block: { text: "每个店铺等级客人上限？" } } },
              ],
            },
            {
              user_type: 2,
              index_in_conv: "2",
              create_time: String(createTime + 1),
              thinking_content: "",
              content_block: [
                { block_type: 10025, content: searchPayload },
                { block_type: 10000, content: { text_block: { text: "白银 20，黄金 28，铂金 36，钻石 45。" } } },
              ],
            },
          ],
        },
      },
    });

    // 确保 fixture 与合成 login 语义一致（fixture 是分享态真源样本结构）
    expect(share.message_snapshot.message_list).toHaveLength(2);
    const shareMsgs = mapDoubaoMessageList(share.message_snapshot.message_list);
    const [loginConv] = normalizeDoubaoApi(loginPayload);

    expect(shareMsgs.map((m) => m.role)).toEqual(loginConv.messages.map((m) => m.role));
    expect(shareMsgs.map((m) => m.content)).toEqual(loginConv.messages.map((m) => m.content));
    expect(shareMsgs.map((m) => m.reasoning)).toEqual(loginConv.messages.map((m) => m.reasoning));
    expect(shareMsgs[1].reasoning?.search).toContain("**参考资料**");
    expect(shareMsgs[1].content).toBe("白银 20，黄金 28，铂金 36，钻石 45。");
  });
});

describe("Qwen API normalizers (CN + intl)", () => {
  it("normalizes CN login fixture and outputs platform Qwen", () => {
    const [conv] = normalizeQwenApi(fixture("qwen-cn-history-text.json"));
    expect(conv.platform).toBe("Qwen");
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[1].role).toBe("ai");
    expect(conv.messages[0].content).toContain("同步IO");
  });

  it("normalizes CN multi-turn in chronological order (login list is newest-first)", () => {
    const [multi] = normalizeQwenApi(fixture("qwen-cn-history-multiturn.json"));
    expect(multi.platform).toBe("Qwen");
    expect(multi.messages.length).toBeGreaterThanOrEqual(4);
    // fixture list 顺序：田朴珺(新) → 王石老婆 → 王石多大了(旧)；归一化后必须旧→新
    const userTexts = multi.messages.filter((m) => m.role === "user").map((m) => m.content);
    expect(userTexts[0]).toContain("王石多大了");
    expect(userTexts[userTexts.length - 1]).toContain("田朴珺");
    for (let i = 1; i < multi.messages.length; i++) {
      expect(Date.parse(multi.messages[i].timestamp)).toBeGreaterThanOrEqual(
        Date.parse(multi.messages[i - 1].timestamp),
      );
    }
  });

  it("extracts generated images from CN login multi_load (layout ref arrays + result_images)", () => {
    const [img] = normalizeQwenApi(fixture("qwen-cn-history-image.json"));
    expect(img.platform).toBe("Qwen");
    const ai = img.messages.find((m) => m.role === "ai");
    expect(ai).toBeTruthy();
    expect(ai!.content).toContain("![生成图片");
    expect(ai!.content).toMatch(/!\[生成图片 \d+\]\(https?:\/\//);
    // 占位符 [(ai_generate_image_list_1)] 应被替换，不应残留
    expect(ai!.content).not.toMatch(/\[\([a-z0-9_]+\)\]/i);
  });

  it("expands image_waterfall / image_inline from share-style multi_load", () => {
    const [conv] = normalizeQwenApi(fixture("qwen-cn-share-photo-waterfall.json"));
    expect(conv.platform).toBe("Qwen");
    const users = conv.messages.filter((m) => m.role === "user").map((m) => m.content);
    expect(users[0]).toContain("梅西的父亲");
    expect(users[1]).toContain("世界杯");
    const photoAi = conv.messages.find(
      (m) => m.role === "ai" && m.content.includes("感情流露"),
    );
    expect(photoAi).toBeTruthy();
    expect(photoAi!.content).toContain("![生成图片");
    expect(photoAi!.content).toMatch(/kkimgs\.yisou\.com|image_url|ims\?/);
    expect(photoAi!.content).not.toMatch(/\[\(image_waterfall_/);
    expect(photoAi!.content).not.toMatch(/\[\(multimodal_chat_think_/);
  });

  it("normalizes intl fixture: answer from content_list, platform Qwen", () => {
    const [conv] = normalizeQwenIntlApi(fixture("qwen-intl-history.json"));
    expect(conv.platform).toBe("Qwen");
    expect(conv.messages.length).toBeGreaterThanOrEqual(4);
    expect(conv.messages[0]).toMatchObject({ role: "user", content: "你好" });
    expect(conv.messages[1].role).toBe("ai");
    // 助手 content 字段恒为空串，正文来自 content_list phase=answer
    expect(conv.messages[1].content).toContain("你好");
    expect(conv.messages[1].content.length).toBeGreaterThan(10);
  });

  it("maps thinking_summary / reasoning_content into reasoning.thinking", () => {
    const raw = JSON.stringify({
      data: {
        title: "think demo",
        chat: {
          messages: [
            { role: "user", content: "q", timestamp: 1785920196 },
            {
              role: "assistant",
              content: "",
              reasoning_content: "step by step",
              content_list: [
                { phase: "thinking_summary", content: "summary line" },
                { phase: "answer", content: "final answer" },
              ],
              timestamp: 1785920197,
            },
          ],
        },
      },
    });
    const [conv] = normalizeQwenIntlApi(raw);
    expect(conv.platform).toBe("Qwen");
    expect(conv.messages[1].content).toBe("final answer");
    expect(conv.messages[1].content).not.toContain("Thinking Process");
    expect(conv.messages[1].reasoning?.thinking).toContain("summary line");
    expect(conv.messages[1].reasoning?.thinking).toContain("step by step");
  });

  it("throws platform-named errors for bad payloads", () => {
    expect(() => normalizeQwenApi("{}")).toThrow(/qwen/i);
    expect(() => normalizeQwenIntlApi("{}")).toThrow(/qwen-intl/i);
  });
});

describe("Gemini API normalizer", () => {
  it("normalizes batchexecute text fixture with correct order", () => {
    const [conv] = normalizeGeminiApi(fixture("gemini-batchexecute-text-raw.txt"));
    expect(conv.platform).toBe("Gemini");
    expect(conv.messages.length).toBeGreaterThanOrEqual(2);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[1].role).toBe("ai");
  });

  it("normalizes image batchexecute without dirty missing placeholders alone", () => {
    const [conv] = normalizeGeminiApi(fixture("gemini-batchexecute-raw.txt"));
    expect(conv.platform).toBe("Gemini");
    expect(conv.messages.length).toBeGreaterThanOrEqual(2);
    const ai = conv.messages.filter((m) => m.role === "ai");
    expect(ai.some((m) => m.content.includes("![生成图片") || m.content.includes("lh3.googleusercontent"))).toBe(true);
    // 若有真实图 markdown，不应只剩孤立「图片缺失」
    for (const m of ai) {
      if (m.content.includes("![生成图片")) {
        expect(m.content.trim()).not.toBe("[生成图片缺失]");
      }
    }
  });

  it("throws platform-named error for unexpected payloads", () => {
    expect(() => normalizeGeminiApi("not-a-batchexecute")).toThrow(/gemini/i);
  });
});
