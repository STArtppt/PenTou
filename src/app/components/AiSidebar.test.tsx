// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSidebar } from "./AiSidebar";
import { createEmptyAiChatSession, type AiChatSession } from "../ai-chats";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo = vi.fn();

const mocks = vi.hoisted(() => ({
  appContext: {} as any,
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../data", () => ({
  useAppContext: () => mocks.appContext,
}));

vi.mock("sonner", () => ({
  toast: mocks.toast,
}));

vi.mock("./ImageLightbox", () => ({
  MarkdownImage: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt} />,
  imageUrlTransform: (url: string) => url,
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
    mocks.appContext = {
      aiSidebarOpen: true,
      setAiSidebarOpen: vi.fn(),
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
      language: "en",
    };
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the history popover without crashing", async () => {
    const { container, unmount } = await renderSidebar();
    const historyButton = container.querySelector<HTMLButtonElement>('button[title="Chat history"]');

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
});
