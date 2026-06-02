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
});
