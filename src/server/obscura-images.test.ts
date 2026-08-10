/**
 * 分享链接结构化图片提取测试（spec media-assets §4.5 / US-03 AC5）。
 * Doubao attachment_block / creation_block；Qianwen multi_load（resource_infos /
 * layout_list / result_images）；Gemini lh3 生成图与正文内联 token 按序替换。
 */
import { describe, expect, it } from "vitest";
import { parseSharedLinkData } from "../../vite-plugins/obscura";

function doubaoHtml(messageList: any[]): string {
  const routerArgs = JSON.stringify([
    "thread_(token)/page",
    "shareInfo",
    { data: { share_info: { share_name: "图片对话" }, message_snapshot: { message_list: messageList } } },
  ]).replace(/'/g, "&#39;");
  return `<html><body><script data-fn-name="r" data-fn-args='${routerArgs}'></script></body></html>`;
}

describe("Doubao 结构化图片提取", () => {
  it("attachment_block 上传图与 creation_block 生成图转为 markdown 图片，文本顺序不乱", async () => {
    const html = doubaoHtml([
      {
        index: 1,
        user_type: 1,
        create_time: 1773308699,
        content_block: [
          { content_v2: JSON.stringify({ text_block: { text: "参考这张图画一只猫" } }) },
          {
            content_v2: JSON.stringify({
              attachment_block: {
                attachments: [
                  { image: { image_ori: { url: "https://p.doubao.com/ori/up1.png" }, image_thumb: { url: "https://p.doubao.com/thumb/up1.png" } } },
                ],
              },
            }),
          },
        ],
      },
      {
        index: 2,
        user_type: 2,
        create_time: 1773308701,
        content_block: [
          { content_v2: JSON.stringify({ text_block: { text: "画好了：" } }) },
          {
            content_v2: JSON.stringify({
              creation_block: {
                creations: [
                  {
                    image: {
                      image_raw_b: { url: "https://p.doubao.com/raw/gen1.png" },
                      image_preview: { url: "https://p.doubao.com/preview/gen1.png" },
                    },
                    gen_detail: { ref_images: [{ image_ori: { url: "https://p.doubao.com/ori/up1.png" } }] },
                  },
                ],
              },
            }),
          },
        ],
      },
    ]);

    const [conversation] = await parseSharedLinkData("https://www.doubao.com/thread/live", html);
    const [userMsg, aiMsg] = conversation.messages;

    // 附件图取 image_ori（优先于 thumb），紧随用户文本
    expect(userMsg.content).toBe("参考这张图画一只猫\n\n![附件图片](https://p.doubao.com/ori/up1.png)");
    // 生成图取 image_raw_b（最高优先级）；参考图与用户附件同源属预期冗余，照常输出
    expect(aiMsg.content).toContain("画好了：");
    expect(aiMsg.content).toContain("![生成图片 1](https://p.doubao.com/raw/gen1.png)");
    expect(aiMsg.content).toContain("![参考图](https://p.doubao.com/ori/up1.png)");
    expect(aiMsg.content.indexOf("画好了")).toBeLessThan(aiMsg.content.indexOf("![生成图片 1]"));
  });

  it("图片 URL 缺失时插入占位，不中断导入（解析期兜底）", async () => {
    const html = doubaoHtml([
      {
        index: 1,
        user_type: 2,
        create_time: 1773308701,
        content_block: [
          { content_v2: JSON.stringify({ creation_block: { creations: [{ image: {} }] } }) },
          { content_v2: JSON.stringify({ text_block: { text: "生成结果如下" } }) },
        ],
      },
    ]);

    const [conversation] = await parseSharedLinkData("https://www.doubao.com/thread/live", html);
    expect(conversation.messages[0].content).toContain("[生成图片缺失]");
    expect(conversation.messages[0].content).toContain("生成结果如下");
  });
});

describe("Qianwen 结构化图片提取", () => {
  it("result_images 优先取 download_url，紧随对应回复文本", async () => {
    const payload = {
      __QIANWEN_API_PAYLOAD__: {
        title: "画图",
        session: {
          record_list: [
            {
              created_at: 1763544465570,
              request_messages: [{ content: "画一只狗" }],
              response_messages: [
                {
                  content: "好的，这是为你生成的图片：",
                  meta_data: {
                    multi_load: [
                      {
                        extra_info: {
                          content: {
                            extra: {
                              result_images: [
                                {
                                  download_url: "https://img.qianwen.com/dl/dog.png",
                                  preview_url: "https://img.qianwen.com/pv/dog.png",
                                },
                              ],
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    };

    const [conversation] = await parseSharedLinkData(
      "https://www.qianwen.com/share/chat/live",
      JSON.stringify(payload),
    );
    const aiMsg = conversation.messages.find((m: any) => m.role === "ai");
    expect(aiMsg.content).toBe("好的，这是为你生成的图片：\n\n![生成图片 1](https://img.qianwen.com/dl/dog.png)");
  });

  it("layout_list 经 refer_id 指向 resource_infos 取 URL，避免重复抓 watermark 资源", async () => {
    const payload = {
      __QIANWEN_API_PAYLOAD__: {
        session: {
          record_list: [
            {
              created_at: 1763544465570,
              request_messages: [{ content: "再画一张" }],
              response_messages: [
                {
                  content: "",
                  meta_data: {
                    multi_load: [
                      {
                        type: "ai_generate_image_list",
                        content: {
                          resource_infos: [
                            { refer_id: "res_1", url: "https://img.qianwen.com/res/cat.png" },
                            { refer_id: "res_watermark", url: "https://img.qianwen.com/res/watermark.png" },
                          ],
                          layout_list: [{ image: { refer_id: "res_1" } }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    };

    const [conversation] = await parseSharedLinkData(
      "https://www.qianwen.com/share/chat/live",
      JSON.stringify(payload),
    );
    const aiMsg = conversation.messages.find((m: any) => m.role === "ai");
    expect(aiMsg.content).toBe("![生成图片 1](https://img.qianwen.com/res/cat.png)");
    expect(aiMsg.content).not.toContain("watermark");
  });

  it("layout_list.image 为 ref 字符串数组时（登录态真源形态）可解析", async () => {
    const payload = {
      __QIANWEN_API_PAYLOAD__: {
        session: {
          record_list: [
            {
              created_at: 1763544465570,
              request_messages: [{ content: "画" }],
              response_messages: [
                {
                  content: "完成\n\n[(ai_generate_image_list_1)]",
                  meta_data: {
                    multi_load: [
                      {
                        type: "ai_generate_image_list",
                        source_seq: "ai_generate_image_list_1",
                        content: {
                          resource_infos: [
                            { refer_id: "ref1", url: "https://img.qianwen.com/a.png" },
                            { refer_id: "ref2", url: "https://img.qianwen.com/wm.png" },
                          ],
                          layout_list: [
                            {
                              image: ["ref1"],
                              watermark_image: ["ref2"],
                              type: "generate_image",
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    };

    const [conversation] = await parseSharedLinkData(
      "https://www.qianwen.com/share/chat/live",
      JSON.stringify(payload),
    );
    const aiMsg = conversation.messages.find((m: any) => m.role === "ai");
    expect(aiMsg.content).toContain("![生成图片 1](https://img.qianwen.com/a.png)");
    expect(aiMsg.content).not.toContain("wm.png");
    expect(aiMsg.content).not.toContain("[(ai_generate_image_list_1)]");
  });

  it("image_waterfall 占位符展开为 markdown 图片", async () => {
    const payload = {
      __QIANWEN_API_PAYLOAD__: {
        session: {
          record_list: [
            {
              created_at: 1763544465570,
              request_messages: [{ content: "找图" }],
              response_messages: [
                {
                  content: "如图：\n[(image_waterfall_1)]",
                  meta_data: {
                    multi_load: [
                      {
                        type: "image_waterfall",
                        source_seq: "image_waterfall_1",
                        content: {
                          list: [
                            { image_url: "https://img.example.com/1.jpg", title: "a" },
                            { image_url: "https://img.example.com/2.jpg", title: "b" },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    };

    const [conversation] = await parseSharedLinkData(
      "https://qianwen.my.cn/share/chat/live",
      JSON.stringify(payload),
    );
    const aiMsg = conversation.messages.find((m: any) => m.role === "ai");
    expect(aiMsg.content).toContain("![生成图片 1](https://img.example.com/1.jpg)");
    expect(aiMsg.content).toContain("![生成图片 2](https://img.example.com/2.jpg)");
    expect(aiMsg.content).not.toContain("[(image_waterfall_1)]");
  });

  it("图片 URL 缺失时插入占位，文本照常导入", async () => {
    const payload = {
      __QIANWEN_API_PAYLOAD__: {
        session: {
          record_list: [
            {
              request_messages: [{ content: "画一张" }],
              response_messages: [
                {
                  content: "生成完成",
                  meta_data: {
                    multi_load: [
                      { extra_info: { content: { extra: { result_images: [{}] } } } },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    };

    const [conversation] = await parseSharedLinkData(
      "https://www.qianwen.com/share/chat/live",
      JSON.stringify(payload),
    );
    const aiMsg = conversation.messages.find((m: any) => m.role === "ai");
    expect(aiMsg.content).toBe("生成完成\n\n[生成图片缺失]");
  });
});

describe("Gemini 结构化图片提取", () => {
  function geminiPayload(responseNode: any) {
    return {
      __GEMINI_API_PAYLOAD__: [
        [
          null,
          [
            [
              ["c_1", "r_1"],
              null,
              [["帮我生成两张星空图"], 2],
              responseNode,
              [1773998143, 508633000],
            ],
          ],
          [true, "星空图生成"],
          "270df6c1295f",
        ],
        null,
        false,
      ],
    };
  }

  it("正文内联 image_generation_content token 按出现顺序映射到 lh3 生成图", async () => {
    const responseNode = [
      [
        [
          "rc_1",
          ["这是第一张：http://googleusercontent.com/image_generation_content/0 这是第二张：http://googleusercontent.com/image_generation_content/1"],
        ],
      ],
      ["https://lh3.googleusercontent.com/gen/star-a", "image/png"],
      ["https://lh3.googleusercontent.com/gen/star-b", "image/png"],
    ];

    const [conversation] = await parseSharedLinkData(
      "https://gemini.google.com/share/270df6c1295f",
      JSON.stringify(geminiPayload(responseNode)),
    );
    const aiMsg = conversation.messages.find((m: any) => m.role === "ai");
    expect(aiMsg.content).toContain("这是第一张：![生成图片 1](https://lh3.googleusercontent.com/gen/star-a)");
    expect(aiMsg.content).toContain("这是第二张：![生成图片 2](https://lh3.googleusercontent.com/gen/star-b)");
    // 正文无残留占位 token
    expect(aiMsg.content).not.toContain("image_generation_content");
  });

  it("真实 Gemini 的 opaque content id（非数组下标）按出现顺序映射，不误插[生成图片缺失]", async () => {
    // 实测 token 形如 image_generation_content/368，数字是内容 ID 而非 imageUrls 下标
    const responseNode = [
      [
        [
          "rc_1",
          ["http://googleusercontent.com/image_generation_content/368\n\n"],
        ],
      ],
      ["https://lh3.googleusercontent.com/gg/gen-opaque-a", "image/png"],
    ];

    const [conversation] = await parseSharedLinkData(
      "https://gemini.google.com/share/bbb60f3489ce",
      JSON.stringify(geminiPayload(responseNode)),
    );
    const aiMsg = conversation.messages.find((m: any) => m.role === "ai");
    expect(aiMsg.content).toBe("![生成图片 1](https://lh3.googleusercontent.com/gg/gen-opaque-a)");
    expect(aiMsg.content).not.toContain("[生成图片缺失]");
    expect(aiMsg.content).not.toContain("image_generation_content");
  });

  it("同一 opaque id 多次出现映射到同一图；多余 lh3 补在正文末尾", async () => {
    const responseNode = [
      [
        [
          "rc_1",
          [
            "A：http://googleusercontent.com/image_generation_content/368 B：http://googleusercontent.com/image_generation_content/368",
          ],
        ],
      ],
      ["https://lh3.googleusercontent.com/gg/primary", "image/png"],
      ["https://lh3.googleusercontent.com/gg/extra", "image/png"],
    ];

    const [conversation] = await parseSharedLinkData(
      "https://gemini.google.com/share/bbb60f3489ce",
      JSON.stringify(geminiPayload(responseNode)),
    );
    const aiMsg = conversation.messages.find((m: any) => m.role === "ai");
    expect(aiMsg.content).toContain(
      "A：![生成图片 1](https://lh3.googleusercontent.com/gg/primary) B：![生成图片 1](https://lh3.googleusercontent.com/gg/primary)",
    );
    expect(aiMsg.content).toContain("![生成图片 2](https://lh3.googleusercontent.com/gg/extra)");
    expect(aiMsg.content).not.toContain("[生成图片缺失]");
  });

  it("token 多于图片时插入占位；无 token 的孤立生成图补在正文末尾", async () => {
    const responseNode = [
      [
        [
          "rc_1",
          [
            "缺图：http://googleusercontent.com/image_generation_content/900 有图：http://googleusercontent.com/image_generation_content/901",
          ],
        ],
      ],
      // 只有一张图，对应出现顺序第 0 个 token（900）；901 应缺失
      ["https://lh3.googleusercontent.com/gen/only-one", "image/png"],
    ];

    const [conversation] = await parseSharedLinkData(
      "https://gemini.google.com/share/270df6c1295f",
      JSON.stringify(geminiPayload(responseNode)),
    );
    const aiMsg = conversation.messages.find((m: any) => m.role === "ai");
    expect(aiMsg.content).toContain(
      "缺图：![生成图片 1](https://lh3.googleusercontent.com/gen/only-one) 有图：[生成图片缺失]",
    );
    expect(aiMsg.content).not.toContain("image_generation_content");
  });

  it("无图片时纯文本回复行为不变", async () => {
    const responseNode = [[["rc_1", ["纯文本回答"]]]];
    const [conversation] = await parseSharedLinkData(
      "https://gemini.google.com/share/270df6c1295f",
      JSON.stringify(geminiPayload(responseNode)),
    );
    const aiMsg = conversation.messages.find((m: any) => m.role === "ai");
    expect(aiMsg.content).toBe("纯文本回答");
  });
});
