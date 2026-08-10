import { describe, expect, it } from "vitest";
import { parseSharedLinkData } from "../../vite-plugins/obscura";

describe("share-link import unavailable pages", () => {
  it("extracts Qianwen share messages from the native API payload", async () => {
    const payload = {
      __QIANWEN_API_PAYLOAD__: {
        title: "同步IO和异步IO分别是什么意思",
        session: {
          record_list: [
            {
              created_at: 1763544465570,
              request_messages: [{ content: "同步IO和异步IO分别是什么意思" }],
              response_messages: [
                { mime_type: "signal/post", status: "complete" },
                { content: "同步 I/O 会等待操作完成，异步 I/O 会通过事件或回调通知完成。" },
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

    expect(conversation.platform).toBe("Qianwen");
    expect(conversation.title).toBe("同步IO和异步IO分别是什么意思");
    expect(conversation.messages).toMatchObject([
      { role: "user", content: "同步IO和异步IO分别是什么意思" },
      { role: "ai", content: "同步 I/O 会等待操作完成，异步 I/O 会通过事件或回调通知完成。" },
    ]);
  });

  it("extracts Metaso share messages from branched messages", async () => {
    const payload = {
      __METASO_API_PAYLOAD__: {
        title: "新对话",
        activePathMessages: [
          {
            role: "USER",
            depth: 0,
            createTime: "2026-05-27T09:04:59.937",
            content: { text: "lazygit" },
          },
          {
            role: "ASSISTANT",
            depth: 1,
            createTime: "2026-05-27T09:04:59.939",
            content: {
              stages: [
                { texts: [{ type: "reasoning_content", text: "搜索到15条结果。" }] },
                { texts: [{ type: "text", text: "根据搜索结果，我来为您介绍 lazygit。" }] },
              ],
            },
          },
        ],
      },
    };

    const [conversation] = await parseSharedLinkData(
      "https://metaso.cn/s/live",
      JSON.stringify(payload),
    );

    expect(conversation.platform).toBe("Metaso");
    expect(conversation.title).toBe("lazygit");
    expect(conversation.messages).toMatchObject([
      { role: "user", content: "lazygit" },
      { role: "ai", content: "根据搜索结果，我来为您介绍 lazygit。" },
    ]);
  });

  it("extracts Gemini share messages from batchexecute payload", async () => {
    const payload = {
      __GEMINI_API_PAYLOAD__: [
        [
          null,
          [
            [
              ["c_1", "r_1"],
              null,
              [["你是AGI时代各种业务领域的最佳实践挖掘大师"], 2],
              [[["rc_1", ["太棒了，我已经准备好一起挖掘最佳实践。"]]]],
              [1773998143, 508633000],
            ],
            [
              ["c_1", "r_2"],
              ["c_1", "r_1", "rc_1"],
              [["帮我找找围绕obsidian打造的智能体"], 2],
              [[["rc_2", ["可以从文件系统流、MCP 协议流和 Git 同步流三个方向设计。"]]]],
              [1773998268, 282891000],
            ],
          ],
          [true, "AGI 业务实践挖掘工作流"],
          "270df6c1295f",
        ],
        null,
        false,
      ],
    };

    const [conversation] = await parseSharedLinkData(
      "https://gemini.google.com/share/270df6c1295f",
      JSON.stringify(payload),
    );

    expect(conversation.platform).toBe("Gemini");
    expect(conversation.title).toBe("AGI 业务实践挖掘工作流");
    expect(conversation.messages).toMatchObject([
      { role: "user", content: "你是AGI时代各种业务领域的最佳实践挖掘大师" },
      { role: "ai", content: "太棒了，我已经准备好一起挖掘最佳实践。" },
      { role: "user", content: "帮我找找围绕obsidian打造的智能体" },
      { role: "ai", content: "可以从文件系统流、MCP 协议流和 Git 同步流三个方向设计。" },
    ]);
  });

  it("extracts Doubao share messages from streamed router data", async () => {
    const routerArgs = JSON.stringify([
      "thread_(token)/page",
      "shareInfo",
      {
        data: {
          share_info: { share_name: "用 Mermaid 还原图示" },
          message_snapshot: {
            message_list: [
              {
                index: 2,
                user_type: 2,
                create_time: 1773308701,
                content_block: [
                  {
                    content_v2: JSON.stringify({
                      text_block: { text: "```mermaid\nflowchart TD\n  A --> B\n```" },
                    }),
                  },
                ],
              },
              {
                index: 1,
                user_type: 1,
                create_time: 1773308699,
                content_block: [
                  {
                    content_v2: JSON.stringify({
                      text_block: { text: "请帮我用mermaid还原这个图示" },
                    }),
                  },
                ],
              },
            ],
          },
        },
      },
    ]);
    const html = `
      <html>
        <body>
          <script data-fn-name="r" data-fn-args='${routerArgs}'></script>
        </body>
      </html>
    `;

    const [conversation] = await parseSharedLinkData("https://www.doubao.com/thread/live", html);

    expect(conversation.platform).toBe("Doubao");
    expect(conversation.title).toBe("用 Mermaid 还原图示");
    expect(conversation.messages).toMatchObject([
      { role: "user", content: "请帮我用mermaid还原这个图示" },
      { role: "ai", content: "```mermaid\nflowchart TD\n  A --> B\n```" },
    ]);
  });

  it("extracts Doubao share messages from the mergeLoaderData shell (2026-08 shape)", async () => {
    // 新壳：载荷被串成 JSON 字符串塞进 routerDataFnArgs，且 index / create_time 都是字符串，
    // 分享载荷只有 index_in_conv 没有 index。
    const shareInfo = JSON.stringify({
      isMobileShareId: true,
      data: {
        share_info: { share_name: "潜水员戴夫iOS版食材改名" },
        message_snapshot: {
          message_list: [
            {
              index_in_conv: "1",
              user_type: 1,
              create_time: "1786095405",
              content_block: [{ content: JSON.stringify({ text_block: { text: "店铺等级对应每晚客人最多是多少" } }) }],
            },
            {
              index_in_conv: "2",
              user_type: 2,
              create_time: "1786095408",
              content_block: [{ content: JSON.stringify({ text_block: { text: "钻石 45 人。" } }) }],
            },
          ],
        },
      },
    });
    const routerArgs = JSON.stringify([
      "thread_(token)/page",
      [{ key: "shareInfo", routerDataFnName: "p", routerDataFnArgs: [shareInfo] }],
    ]);
    const html = `
      <html>
        <body>
          <script data-fn-name="mergeLoaderData" data-fn-args='${routerArgs}'></script>
        </body>
      </html>
    `;

    const [conversation] = await parseSharedLinkData("https://www.doubao.com/thread/x5379fIAmQ9uedjAw", html);

    expect(conversation.platform).toBe("Doubao");
    expect(conversation.title).toBe("潜水员戴夫iOS版食材改名");
    expect(conversation.messages).toMatchObject([
      { role: "user", content: "店铺等级对应每晚客人最多是多少", timestamp: "2026-08-07T09:36:45.000Z" },
      { role: "ai", content: "钻石 45 人。", timestamp: "2026-08-07T09:36:48.000Z" },
    ]);
  });

  it("accepts qianwen.my.cn share URLs the same as qianwen.com (API payload path)", async () => {
    const payload = {
      __QIANWEN_API_PAYLOAD__: {
        title: "梅西",
        session: {
          record_list: [
            {
              created_at: 1763544465570,
              request_messages: [{ content: "求证" }],
              response_messages: [{ content: "是的。" }],
            },
          ],
        },
      },
    };

    const [conversation] = await parseSharedLinkData(
      "https://qianwen.my.cn/share/chat/be535e7d32c549dea8672a681e7fc7d1",
      JSON.stringify(payload),
    );

    expect(conversation.platform).toBe("Qianwen");
    expect(conversation.messages).toMatchObject([
      { role: "user", content: "求证" },
      { role: "ai", content: "是的。" },
    ]);
  });

  it("rejects expired Qianwen shares instead of importing the empty-state text", async () => {
    const html = `
      <html>
        <head><title>同步IO和异步IO分别是什么意思 - 千问</title></head>
        <body>
          <div data-slot="empty-description">分享内容已失效</div>
          <button>返回首页</button>
        </body>
      </html>
    `;

    await expect(parseSharedLinkData("https://www.qianwen.com/share/chat/dead", html))
      .rejects.toThrow("Qianwen share content is unavailable or expired");

    await expect(parseSharedLinkData("https://qianwen.my.cn/share/chat/dead", html))
      .rejects.toThrow("Qianwen share content is unavailable or expired");
  });

  it("rejects empty Doubao router data instead of importing scripts as a message", async () => {
    const html = `
      <html>
        <body>
          <script>
            _ROUTER_DATA = {"loaderData":{"thread_(token)/page":{"shareInfo":{}}},"errors":null};
          </script>
        </body>
      </html>
    `;

    await expect(parseSharedLinkData("https://www.doubao.com/thread/dead", html))
      .rejects.toThrow("Doubao share content is not readable in the current fetch session");
  });

  it("rejects Metaso not-found shares instead of importing the app shell", async () => {
    const html = `
      <html>
        <head><title>秘塔AI搜索</title></head>
        <body>
          <script>self.__next_f.push([1,"24:E{\\"digest\\":\\"NEXT_NOT_FOUND\\"}\\n"])</script>
          <p>您访问的页面找不到了</p>
        </body>
      </html>
    `;

    await expect(parseSharedLinkData("https://metaso.cn/s/dead", html))
      .rejects.toThrow("Metaso share content is unavailable");
  });

  it("rejects Gemini rendered shell instead of importing login text", async () => {
    const html = `
      <html>
        <head><title>Gemini</title></head>
        <body>
          <a>登录</a>
          <h1>AGI 业务实践挖掘工作流</h1>
          <p>Gemini 显示的信息（包括与人相关的信息）不一定准确，请注意核查。</p>
        </body>
      </html>
    `;

    await expect(parseSharedLinkData("https://gemini.google.com/share/dead", html))
      .rejects.toThrow("Gemini share content is not readable");
  });

  it("extracts Grok share messages from the native share_links API payload", async () => {
    const payload = {
      __GROK_API_PAYLOAD__: {
        conversation: {
          conversationId: "conv-1",
          title: "Hermes SuperGrok OAuth Setup Guide",
          createTime: "2026-07-13T06:15:51.927363Z",
        },
        responses: [
          {
            responseId: "r1",
            sender: "human",
            createTime: "2026-07-13T06:15:51.956Z",
            message: "如何在Hermes中使用我订阅的superGrok？",
          },
          {
            responseId: "r2",
            sender: "ASSISTANT",
            createTime: "2026-07-13T06:15:59.721Z",
            parentResponseId: "r1",
            message:
              '**通过 OAuth 登录即可。**<grok:render card_id="1" card_type="citation_card" type="render_inline_citation"><argument name="citation_id">1</argument></grok:render>\n\n运行 `hermes model`。',
            generatedImageUrls: ["https://cdn.example.com/img.png"],
          },
        ],
      },
    };

    const [conversation] = await parseSharedLinkData(
      "https://grok.com/share/c2hhcmQtNQ_405ea865-a4b9-4f4f-bf12-14bc737bb6f2",
      JSON.stringify(payload),
    );

    expect(conversation.platform).toBe("Grok");
    expect(conversation.title).toBe("Hermes SuperGrok OAuth Setup Guide");
    expect(conversation.messages).toMatchObject([
      { role: "user", content: "如何在Hermes中使用我订阅的superGrok？" },
      {
        role: "ai",
        content: "**通过 OAuth 登录即可。**\n\n运行 `hermes model`。\n\n![生成图片 1](https://cdn.example.com/img.png)",
      },
    ]);
    // Citation markup must not leak into stored content.
    expect(conversation.messages[1].content).not.toContain("grok:render");
    expect(conversation.messages[1].content).not.toContain("citation_id");
  });

  it("rejects empty Grok share payloads instead of importing the SPA shell as code", async () => {
    await expect(
      parseSharedLinkData(
        "https://grok.com/share/dead",
        JSON.stringify({ __GROK_API_PAYLOAD__: { responses: [], conversation: {} } }),
      ),
    ).rejects.toThrow("Grok share content is unavailable");
  });

  it("rejects Grok rendered SPA shell instead of dumping scripts as a message", async () => {
    const html = `
      <html>
        <head><title>Shared Grok Conversation</title></head>
        <body>
          <script type="application/json" id="server-client-data-experimentation">{"status":"ready","serverConfig":{}}</script>
          <script>self.__next_f.push([1,"3c:[\\"$\\",\\"$L68\\",null,{\\"shareLinkId\\":\\"dead\\"}]\\n"])</script>
          <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM"></iframe></noscript>
        </body>
      </html>
    `;

    await expect(parseSharedLinkData("https://grok.com/share/dead", html))
      .rejects.toThrow("Grok share content is not readable");
  });
});
