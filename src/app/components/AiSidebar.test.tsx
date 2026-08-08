// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSidebar } from "./AiSidebar";
import { createEmptyAiChatSession, type AiChatSession } from "../ai-chats";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo = vi.fn((..._args: unknown[]) => {}) as typeof Element.prototype.scrollTo;

const mocks = vi.hoisted(() => ({
  appContext: {} as any,
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
  /** 记录每轮实际发给模型的 messages，并按队列回放模型响应（含工具调用）。 */
  llm: {
    seen: [] as any[][],
    queue: [] as { content: string; toolCalls: any[] }[],
  },
  /** 记录 runSkill 的派发，验证「点击即确定性派发」而不经模型判断意图。 */
  skills: {
    dispatched: [] as { skillId: string; input: any }[],
    result: {} as any,
    fail: "" as string,
  },
}));

// 技能派发已迁到 data.tsx startSkillRun；测试通过 mock startSkillRun 记录派发

vi.mock("../data", () => ({
  useAppContext: () => mocks.appContext,
}));

// 预检：失败时不建会话；测试用 skills.fail 模拟校验不过
vi.mock("../skills/run-plan", () => ({
  preflightPlanDoc: vi.fn(async () => {
    if (mocks.skills.fail) return { ok: false as const, error: mocks.skills.fail };
    return { ok: true as const, noop: false };
  }),
}));

vi.mock("sonner", () => ({
  toast: mocks.toast,
}));

vi.mock("./ImageLightbox", () => ({
  ImageGalleryProvider: ({ children }: { children: React.ReactNode }) => children,
  MarkdownImage: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt} />,
  imageUrlTransform: (url: string) => url,
}));

vi.mock("../llm", () => ({
  DEFAULT_PROMPT_AI_SIDEBAR: "sys",
  LLMError: class LLMError extends Error {},
  serializeConversation: (conv: any) => conv?.serialized ?? "conv",
  chatCompletion: async (_cfg: unknown, messages: any[], opts?: { onChunk?: (c: string) => void }) => {
    mocks.llm.seen.push(messages);
    const next = mocks.llm.queue.shift() ?? { content: "answer", toolCalls: [] };
    if (next.content) opts?.onChunk?.(next.content);
    return next;
  },
}));

function buildSession(id: string, title: string, updatedAt: string): AiChatSession {
  return {
    id,
    title,
    createdAt: updatedAt,
    updatedAt,
    messages: [
      {
        id: `${id}_m1`,
        role: "user",
        content: "What did we discuss?",
        status: "done",
      },
    ],
  };
}

function buildAssistantSession(): AiChatSession {
  return {
    id: "chat_with_answer",
    title: "Answer session",
    createdAt: "2026-06-18T02:30:00.000Z",
    updatedAt: "2026-06-18T02:30:00.000Z",
    messages: [
      {
        id: "u1",
        role: "user",
        content: "Summarize this",
        status: "done",
      },
      {
        id: "a1",
        role: "assistant",
        content: "# 总结\n\n第一段。\n\n第二段。\n\n1. 第一项\n2. 第二项",
        status: "done",
      },
    ],
  };
}

async function renderSidebar() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  await act(async () => {
    root = createRoot(container);
    root.render(<AiSidebar />);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("AiSidebar", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mocks.toast.error.mockClear();
    mocks.toast.info.mockClear();
    mocks.toast.success.mockClear();
    mocks.llm.seen = [];
    mocks.llm.queue = [];
    mocks.skills.dispatched = [];
    mocks.skills.result = { docId: "doc_new" };
    mocks.skills.fail = "";
    mocks.appContext = {
      aiSidebarOpen: true,
      setAiSidebarOpen: vi.fn(),
      aiSidebarSide: "right",
      setAiSidebarSide: vi.fn(),
      aiSessions: [
        buildSession("chat_1", "Earlier chat", "2026-06-18T02:30:00.000Z"),
      ],
      currentAiSession: createEmptyAiChatSession(),
      setCurrentAiSession: vi.fn(),
      saveAiSession: vi.fn().mockResolvedValue(undefined),
      createNewAiSession: vi.fn().mockResolvedValue(createEmptyAiChatSession()),
      selectAiSession: vi.fn().mockResolvedValue({ session: null, didJump: false }),
      deleteAiSession: vi.fn().mockResolvedValue(undefined),
      refreshAiSessions: vi.fn().mockResolvedValue(undefined),
      startSkillRun: vi.fn(async (chipId: string, input: any, seed: any) => {
        mocks.skills.dispatched.push({ skillId: chipId, input });
        // 复用当前会话 id，模拟「start 时已切到该会话」后 ref 已对齐（无真实 re-render）
        const session: AiChatSession = {
          id: mocks.appContext.currentAiSession.id,
          title: seed?.title ?? chipId,
          kind: "run",
          createdAt: "2026-06-18T02:30:00.000Z",
          updatedAt: "2026-06-18T02:30:00.000Z",
          messages: [
            { id: "u", role: "user", status: "done", content: seed?.userContent ?? "" },
            {
              id: "a",
              role: "assistant",
              status: mocks.skills.fail ? "error" : "done",
              content: mocks.skills.fail || "ok",
              error: mocks.skills.fail || undefined,
              runSkillId: chipId,
            },
          ],
        };
        mocks.appContext.currentAiSession = session;
        if (mocks.skills.fail) {
          return { session, started: true, output: undefined };
        }
        const output =
          chipId === "run-plan"
            ? { approved: 5, skipped: 3, createdFolders: [], assigned: [] }
            : mocks.skills.result;
        return { session, started: true, output };
      }),
      abortSkillRun: vi.fn().mockResolvedValue(undefined),
      runStatusOf: vi.fn().mockReturnValue(null),
      runRegistryVersion: 0,
      activeView: "chat",
      activeConversationId: "conv_1",
      activeDocId: null,
      conversations: [{ id: "conv_1", title: "Current chat", messages: [] }],
      documents: [],
      editMode: "off",
      llmConfig: { endpoint: "", apiKey: "", model: "" },
      setSettingsOpen: vi.fn(),
      addDocuments: vi.fn().mockResolvedValue(undefined),
      setActiveView: vi.fn(),
      setActiveDocId: vi.fn(),
      activeProjectId: null,
      annotationsByDoc: {},
      setRewriteDialogOpen: vi.fn(),
      rewriteDialogOpen: false,
      refreshDocuments: vi.fn().mockResolvedValue(undefined),
      language: "en",
    };
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the history popover without crashing", async () => {
    const { container, unmount } = await renderSidebar();
    const historyButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Chat history"] button, button[aria-label="Chat history"]',
    );

    expect(historyButton).not.toBeNull();

    await act(async () => {
      Simulate.click(historyButton!);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Earlier chat");
    expect(container.textContent).toContain("What did we discuss?");
    unmount();
  });

  it("keeps empty-state prompts close to the shortcut tip", async () => {
    const { container, unmount } = await renderSidebar();
    const firstPrompt = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("What did I discuss with AI?")
    );

    expect(firstPrompt).toBeDefined();
    expect(firstPrompt?.parentElement?.parentElement?.className).toContain("pb-2");
    expect(firstPrompt?.parentElement?.parentElement?.className).not.toContain("pb-8");
    expect(firstPrompt?.className).toContain("cursor-pointer");
    unmount();
  });

  it("does not revert retrieval status to searching after answering (regression)", async () => {
    // fetch mock：/api/search 返回一条命中
    const fetchStub = vi.fn(async () => ({
      ok: true,
      json: async () => ({ hits: [{ type: "conversation", id: "c1", title: "Ctx", snippetText: "snippet" }] }),
    }));
    vi.stubGlobal("fetch", fetchStub as unknown as typeof fetch);

    // setCurrentAiSession 真正回写到 mock context（支持对象与函数式更新）
    mocks.appContext.setCurrentAiSession = (arg: unknown) => {
      mocks.appContext.currentAiSession =
        typeof arg === "function" ? (arg as (s: AiChatSession) => AiChatSession)(mocks.appContext.currentAiSession) : arg;
    };
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    mocks.appContext.currentAiSession = createEmptyAiChatSession();

    const { container, unmount } = await renderSidebar();

    // 走空态快捷提问按钮，直接触发一次完整发送
    const quickPrompt = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("What did I discuss with AI?"),
    );
    expect(quickPrompt).toBeDefined();
    await act(async () => {
      Simulate.click(quickPrompt!);
      await new Promise((r) => setTimeout(r, 0));
    });

    const finalAssistant = mocks.appContext.currentAiSession.messages.find(
      (m: { role: string }) => m.role === "assistant",
    );
    expect(finalAssistant).toBeDefined();
    // 核心断言：作答后不能回退成 searching；应为 done 且保留 citations
    expect(finalAssistant.retrievalStatus).toBe("done");
    expect(finalAssistant.citations).toHaveLength(1);
    expect(finalAssistant.content).toBe("answer");

    vi.unstubAllGlobals();
    unmount();
  });

  it("renders assistant markdown with explicit spacing hierarchy", async () => {
    mocks.appContext.currentAiSession = buildAssistantSession();

    const { container, unmount } = await renderSidebar();
    const markdownRoot = container.querySelector(".ai-sidebar-markdown");
    const heading = container.querySelector("h1");
    const paragraphs = markdownRoot?.querySelectorAll("p") ?? [];
    const orderedList = markdownRoot?.querySelector("ol");

    expect(heading?.className).toContain("mt-5");
    expect(heading?.className).toContain("mb-2");
    expect(paragraphs[0]?.className).toContain("mb-3");
    expect(orderedList?.className).toContain("space-y-1.5");
    expect(markdownRoot).not.toBeNull();
    unmount();
  });

  // 中文输入法下敲英文单词，Enter 是「上屏候选」而不是「发送」。组合期的 keydown 必须整条放行，
  // 否则用户每确认一次拼音就误发一条消息（半截草稿还留在输入框里）。
  it("输入法组合期的 Enter 只上屏候选，不发送消息", async () => {
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    mocks.appContext.setCurrentAiSession = (arg: unknown) => {
      mocks.appContext.currentAiSession =
        typeof arg === "function" ? (arg as (s: AiChatSession) => AiChatSession)(mocks.appContext.currentAiSession) : arg;
    };
    const { container, unmount } = await renderSidebar();
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;

    await act(async () => {
      textarea.value = "hello";
      Simulate.change(textarea);
    });

    // 组合期：标准的 isComposing（Chrome/Firefox）与老规范哨兵 keyCode 229（Safari/部分安卓）都要挡住。
    await act(async () => {
      Simulate.keyDown(textarea, { key: "Enter", isComposing: true } as never);
      Simulate.keyDown(textarea, { key: "Enter", keyCode: 229 });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mocks.llm.seen).toHaveLength(0);
    expect(textarea.value).toBe("hello");

    // 组合结束后的同一个键才是发送。
    await act(async () => {
      Simulate.keyDown(textarea, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mocks.llm.seen).toHaveLength(1);

    unmount();
  });

  // ── 上下文按需加载（spec ask-ai-context）────────────────────────────────────

  const LONG_DOC_BODY = ["# 设计稿", "", "## 背景", "", "背景独有词：翡翠。".repeat(200), "", "## 取舍", "", "取舍独有词：琥珀。"].join("\n");

  function mountDocView() {
    mocks.appContext.setCurrentAiSession = (arg: unknown) => {
      mocks.appContext.currentAiSession =
        typeof arg === "function" ? (arg as (s: AiChatSession) => AiChatSession)(mocks.appContext.currentAiSession) : arg;
    };
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    mocks.appContext.currentAiSession = createEmptyAiChatSession();
    mocks.appContext.activeView = "doc";
    mocks.appContext.activeConversationId = null;
    mocks.appContext.activeDocId = "doc_1";
    mocks.appContext.documents = [{ id: "doc_1", title: "设计稿", body: LONG_DOC_BODY }];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ hits: [] }) })) as unknown as typeof fetch);
  }

  async function ask(container: HTMLElement, question: string) {
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      (textarea as HTMLTextAreaElement).value = question;
      Simulate.change(textarea);
    });
    await act(async () => {
      Simulate.keyDown(textarea, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  const systemOf = (round: number) => mocks.llm.seen[round]?.[0]?.content ?? "";

  it("无关提问不付整篇正文的代价，但仍能看到标题与大纲", async () => {
    mountDocView();
    const { container, unmount } = await renderSidebar();

    await ask(container, "现在几点了？");

    const system = systemOf(0);
    expect(system).not.toContain("翡翠");
    expect(system).toContain("文档《设计稿》");
    expect(system).toContain("- 背景");
    vi.unstubAllGlobals();
    unmount();
  });

  it("模型可按需取正文，并能只取某一节（不腰斩、不串节）", async () => {
    mountDocView();
    mocks.llm.queue = [
      { content: "", toolCalls: [{ id: "c1", name: "read_current_view", arguments: '{"section":"取舍"}' }] },
      { content: "取舍那节讲的是……", toolCalls: [] },
    ];
    const { container, unmount } = await renderSidebar();

    await ask(container, "第二节在讲什么");

    const toolReply = mocks.llm.seen[1].at(-1);
    expect(toolReply.role).toBe("tool");
    expect(toolReply.content).toContain("琥珀");
    expect(toolReply.content).not.toContain("翡翠");
    expect(mocks.appContext.currentAiSession.messages.at(-1).content).toBe("取舍那节讲的是……");
    vi.unstubAllGlobals();
    unmount();
  });

  it("明确指向当前视图的措辞在派发层直接预取正文，不赌模型会调工具", async () => {
    mountDocView();
    const { container, unmount } = await renderSidebar();

    await ask(container, "总结这篇文档");

    expect(systemOf(0)).toContain("翡翠");
    vi.unstubAllGlobals();
    unmount();
  });

  it("关闭上下文开关后本轮不 eager 注入，连轻量头也不给", async () => {
    mountDocView();
    const { container, unmount } = await renderSidebar();

    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => { Simulate.click(toggle); });
    expect(container.querySelector('button[role="switch"]')!.getAttribute("aria-checked")).toBe("false");

    await ask(container, "总结这篇文档");

    expect(systemOf(0)).not.toContain("翡翠");
    expect(systemOf(0)).not.toContain("设计稿");
    vi.unstubAllGlobals();
    unmount();
  });

  it("上下文控件如实反映携带对象；没有视图时不可点", async () => {
    mountDocView();
    const { container, unmount } = await renderSidebar();
    expect(container.textContent).toContain("设计稿");

    await act(async () => { Simulate.click(container.querySelector<HTMLButtonElement>('button[role="switch"]')!); });
    expect(container.querySelector<HTMLButtonElement>('button[role="switch"]')!.textContent).toContain("Context: none");

    vi.unstubAllGlobals();
    unmount();

    mocks.appContext.activeDocId = null;
    mocks.appContext.documents = [];
    const empty = await renderSidebar();
    expect(empty.container.querySelector<HTMLButtonElement>('button[role="switch"]')!.disabled).toBe(true);
    empty.unmount();
  });

  it("检索失败时降级为仅用轻量头作答，不报错中断", async () => {
    mountDocView();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch);
    const { container, unmount } = await renderSidebar();

    await ask(container, "这份文档大概在讲什么");

    const last = mocks.appContext.currentAiSession.messages.at(-1);
    expect(last.status).toBe("done");
    expect(last.content).toBe("answer");
    expect(systemOf(0)).toContain("文档《设计稿》");
    vi.unstubAllGlobals();
    unmount();
  });

  // ── 意图 chip（spec ai-intent-chips：选中 → 回车）─────────────────────────

  const chipButtons = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("button")).filter((b) =>
      /To doc|Digest topic|Tidy folders|Rewrite|Run plan/.test(b.textContent ?? ""),
    );

  /** 选中 chip 后回车执行（无参意图可空回车）。 */
  async function armAndEnter(container: HTMLElement, chipIndex: number, text?: string) {
    await act(async () => {
      Simulate.click(chipButtons(container)[chipIndex]);
    });
    const textarea = container.querySelector("textarea")!;
    if (text !== undefined) {
      await act(async () => {
        (textarea as HTMLTextAreaElement).value = text;
        Simulate.change(textarea);
      });
    }
    await act(async () => {
      Simulate.keyDown(textarea, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("会话视图展示两个 chip，且展示本身不产生任何 LLM 调用", async () => {
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    const { container, unmount } = await renderSidebar();

    expect(chipButtons(container).map((b) => b.textContent)).toEqual([
      "To doc",
      "Digest topic",
    ]);
    expect(mocks.llm.seen).toEqual([]);
    expect(mocks.skills.dispatched).toEqual([]);
    unmount();
  });

  it("文档视图展示另外两个 chip；无批注时重写 chip 不可用并说明原因", async () => {
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    mocks.appContext.activeView = "doc";
    mocks.appContext.activeDocId = "doc_1";
    mocks.appContext.documents = [{ id: "doc_1", title: "设计稿", body: "# 稿" }];
    const { container, unmount } = await renderSidebar();

    const chips = chipButtons(container);
    expect(chips.map((b) => b.textContent)).toEqual([
      "Tidy folders",
      "Rewrite",
    ]);
    expect(chips[1].disabled).toBe(true);
    expect(chips[1].getAttribute("title")).toBe("This document has no annotations with comments yet");
    expect(mocks.llm.seen).toEqual([]);
    unmount();
  });

  it("选中 chip 后回车才确定性派发，不先问模型意图", async () => {
    mocks.appContext.setCurrentAiSession = (arg: unknown) => {
      mocks.appContext.currentAiSession =
        typeof arg === "function" ? (arg as (s: AiChatSession) => AiChatSession)(mocks.appContext.currentAiSession) : arg;
    };
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    const { container, unmount } = await renderSidebar();

    await armAndEnter(container, 0);

    expect(mocks.skills.dispatched).toEqual([
      { skillId: "conversation-to-doc", input: { conversationId: "conv_1" } },
    ]);
    expect(mocks.llm.seen).toEqual([]); // 全程零 LLM 调用
    expect(mocks.appContext.setActiveDocId).toHaveBeenCalledWith("doc_new");
    expect(mocks.appContext.refreshDocuments).toHaveBeenCalled();
    unmount();
  });

  it("转文档 chip 选中后回车出结果，下游不多插一层计划确认", async () => {
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    const { container, unmount } = await renderSidebar();

    await act(async () => {
      Simulate.click(chipButtons(container)[0]);
    });
    expect(mocks.skills.dispatched).toEqual([]);
    // 已选中：直接回车执行（勿再点 chip，会取消选中）
    await act(async () => {
      Simulate.keyDown(container.querySelector("textarea")!, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mocks.skills.dispatched).toHaveLength(1);
    expect(mocks.appContext.setActiveView).toHaveBeenCalledWith("doc");
    expect(mocks.toast.success).toHaveBeenCalledWith("Document created");
    unmount();
  });

  it("主题汇总 chip 选中后清空输入、换引导语，回车以主题派发", async () => {
    mocks.appContext.setCurrentAiSession = (arg: unknown) => {
      mocks.appContext.currentAiSession =
        typeof arg === "function" ? (arg as (s: AiChatSession) => AiChatSession)(mocks.appContext.currentAiSession) : arg;
    };
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    const { container, unmount } = await renderSidebar();

    await act(async () => { Simulate.click(chipButtons(container)[1]); });
    expect(mocks.skills.dispatched).toEqual([]);
    expect(container.querySelector("textarea")!.getAttribute("placeholder")).toBe("What topic should I gather?");
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");

    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      (textarea as HTMLTextAreaElement).value = "检索方案";
      Simulate.change(textarea);
    });
    await act(async () => {
      Simulate.keyDown(textarea, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 0));
    });

    // 产出物正文语言跟随界面语言（技能拿不到 i18n hook，由派发方带上）
    expect(mocks.skills.dispatched).toEqual([
      { skillId: "topic-digest", input: { topic: "检索方案", lang: "en" } },
    ]);
    expect(mocks.llm.seen).toEqual([]); // 这次输入没有被当成一轮提问
    unmount();
  });

  it("「批注重写」选中后回车打开既有确认框，不派发技能也不生成计划文档", async () => {
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    mocks.appContext.activeView = "doc";
    mocks.appContext.activeDocId = "doc_1";
    mocks.appContext.documents = [{ id: "doc_1", title: "设计稿", body: "# 稿" }];
    mocks.appContext.annotationsByDoc = { doc_1: [{ id: "a1", comment: "改这里" }] };
    const { container, unmount } = await renderSidebar();

    await armAndEnter(container, 1);

    expect(mocks.appContext.setRewriteDialogOpen).toHaveBeenCalledWith(true);
    expect(mocks.skills.dispatched).toEqual([]);
    unmount();
  });

  it("整理目录 chip 选中回车后提示计划已生成，并跳到计划文档", async () => {
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    mocks.appContext.activeView = "doc";
    mocks.appContext.activeDocId = "doc_1";
    mocks.appContext.documents = [{ id: "doc_1", title: "设计稿", body: "# 稿" }];
    mocks.skills.result = { planDocId: "doc_plan" };
    const { container, unmount } = await renderSidebar();

    await armAndEnter(container, 0);

    expect(mocks.skills.dispatched[0].skillId).toBe("doc-folder-organize");
    expect(mocks.appContext.setActiveDocId).toHaveBeenCalledWith("doc_plan");
    expect(mocks.toast.success).toHaveBeenCalledWith("Plan ready — tick the items you want, then run it");
    unmount();
  });

  it("技能失败时如实报错，不静默吞掉", async () => {
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    mocks.skills.fail = "没有检索到与「x」相关的内容";
    const { container, unmount } = await renderSidebar();

    await armAndEnter(container, 0);

    expect(mocks.toast.error).toHaveBeenCalledWith("没有检索到与「x」相关的内容");
    unmount();
  });

  /** 执行入口在计划状态条上，点一下即执行 —— 不经 chip 选中态（spec plan-run-status D6）。 */
  const bannerButton = (container: HTMLElement) =>
    container.querySelector<HTMLButtonElement>('[data-slot="plan-run-banner"] button');

  it("打开计划文档时状态条给出「执行」，点击即按勾选执行且全程零 LLM", async () => {
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    mocks.appContext.activeView = "doc";
    mocks.appContext.activeDocId = "doc_plan";
    mocks.appContext.documents = [{ id: "doc_plan", title: "整理计划", body: "- [x] a", aiPlan: '{"items":[]}' }];
    const { container, unmount } = await renderSidebar();

    // chip 组里绝不能再出现执行入口
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.includes("Run plan"))).toBe(
      false,
    );

    const runButton = bannerButton(container)!;
    expect(runButton.textContent).toContain("Run");

    await act(async () => {
      Simulate.click(runButton);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mocks.skills.dispatched).toEqual([{ skillId: "run-plan", input: { planDocId: "doc_plan" } }]);
    expect(mocks.llm.seen).toEqual([]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Done: 5 applied, 3 left unticked");
    unmount();
  });

  it("执行计划预检失败：toast 报错、刷新文档状态、不建 AI 会话", async () => {
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    mocks.appContext.activeView = "doc";
    mocks.appContext.activeDocId = "doc_plan";
    mocks.appContext.documents = [{ id: "doc_plan", title: "整理计划", body: "", aiPlan: '{"items":[]}' }];
    mocks.skills.fail = "《A》在计划生成之后被改过，计划已过期。请让 AI 重新生成一份计划。";
    const { container, unmount } = await renderSidebar();

    await act(async () => {
      Simulate.click(bannerButton(container)!);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mocks.toast.error).toHaveBeenCalledWith(mocks.skills.fail);
    expect(mocks.appContext.refreshDocuments).toHaveBeenCalled();
    // 预检失败不得 startSkillRun —— 下方不应出现执行意图气泡 / 错误消息
    expect(mocks.skills.dispatched).toEqual([]);
    unmount();
  });

  it("已执行的计划：状态条给「查记录」而非「执行」", async () => {
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    mocks.appContext.activeView = "doc";
    mocks.appContext.activeDocId = "doc_plan";
    mocks.appContext.documents = [
      {
        id: "doc_plan",
        title: "整理计划",
        body: "- [x] a",
        aiPlan: '{"items":[]}',
        aiPlanRun: JSON.stringify({
          version: 1,
          status: "done",
          ranAt: "2026-08-05T10:00:00.000Z",
          approved: 2,
          skipped: 0,
          cleaned: 0,
          createdFolders: [],
          assigned: [],
          sessionId: "ai_1",
        }),
      },
    ];
    mocks.appContext.aiSessions = [{ id: "ai_1", title: "执行计划", messages: [], updatedAt: "2026-08-05" }];
    const { container, unmount } = await renderSidebar();

    const banner = container.querySelector('[data-slot="plan-run-banner"]')!;
    expect(banner.textContent).toContain("View run");
    // 执行入口在已执行的计划上必须消失 —— 这正是本变更要堵的误导报错入口
    expect(bannerButton(container)!.textContent).not.toContain("Run plan");
    expect(mocks.skills.dispatched).toEqual([]);
    unmount();
  });

  it("中断的计划：状态条给「详情」，且没有任何重试入口", async () => {
    mocks.appContext.llmConfig = { endpoint: "http://x", apiKey: "k", model: "m" };
    mocks.appContext.activeView = "doc";
    mocks.appContext.activeDocId = "doc_plan";
    mocks.appContext.documents = [
      {
        id: "doc_plan",
        title: "整理计划",
        body: "- [x] a",
        aiPlan: '{"items":[]}',
        aiPlanRun: JSON.stringify({
          version: 1,
          status: "partial",
          ranAt: "2026-08-05T10:00:00.000Z",
          approved: 3,
          skipped: 0,
          cleaned: 0,
          createdFolders: [],
          assigned: [{ docId: "doc_a", folderId: "df_1" }],
          error: "PUT /api/documents/doc_b failed: 500",
        }),
      },
    ];
    const { container, unmount } = await renderSidebar();

    const banner = container.querySelector('[data-slot="plan-run-banner"]')!;
    expect(banner.textContent).toContain("Details");
    for (const b of Array.from(banner.querySelectorAll("button"))) {
      expect(b.textContent).not.toMatch(/Retry|Run/);
    }
    unmount();
  });
});
