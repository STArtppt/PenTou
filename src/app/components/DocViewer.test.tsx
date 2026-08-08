// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocViewer } from "./DocViewer";
import type { Annotation } from "../data";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo = vi.fn((..._args: unknown[]) => {}) as typeof Element.prototype.scrollTo;

const mocks = vi.hoisted(() => ({
  appContext: {
    language: "zh",
    upsertAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    searchJump: null,
    setSearchJump: vi.fn(),
    toggleDocumentTask: vi.fn(),
    openInAppLink: vi.fn(() => true),
  } as any,
  toastError: vi.fn(),
}));

vi.mock("../data", () => ({
  useAppContext: () => mocks.appContext,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock("./ImageLightbox", () => ({
  ImageGalleryProvider: ({ children }: { children: React.ReactNode }) => children,
  MarkdownImage: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt} />,
  imageUrlTransform: (url: string) => url,
}));

vi.mock("./MermaidBlock", () => ({
  MermaidBlock: ({ source }: { source: string }) => <pre>{source}</pre>,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderDoc(
  body: string,
  annotations: Annotation[] = [],
  opts: { annotateMode?: boolean; bodyReadOnly?: boolean } = {},
) {
  act(() => {
    root.render(
      <DocViewer
        docId="doc_test"
        body={body}
        annotations={annotations}
        annotateMode={opts.annotateMode ?? false}
        bodyReadOnly={opts.bodyReadOnly ?? false}
      />,
    );
  });
}

// minerU 对含合并单元格的表格会降级输出内嵌 HTML <table>（GFM 管道表无法表达 colspan）
const HTML_TABLE_BODY = [
  "# 转换文档",
  "",
  '<table><tr><td colspan="2">CECW 技术体系 v12.8</td></tr><tr><td colspan="2">中能拾贝(CECW)技术委员会</td></tr></table>',
  "",
  "正文段落。",
].join("\n");

describe("DocViewer 内嵌 HTML 渲染", () => {
  it("渲染 minerU 输出的 HTML 表格为真实 <table>，而非源码文本", () => {
    renderDoc(HTML_TABLE_BODY);
    const markdownBody = container.querySelector(".markdown-body")!;

    const table = markdownBody.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.textContent).toContain("CECW 技术体系 v12.8");

    const td = markdownBody.querySelector("td");
    expect(td).not.toBeNull();
    expect(td!.getAttribute("colspan")).toBe("2");

    // 不应把 HTML 源码当纯文本显示
    expect(markdownBody.textContent).not.toContain("<table>");
  });

  it("过滤危险 HTML：script 不执行、事件属性被剥离", () => {
    renderDoc('前文\n\n<script>window.__pwned = true;</script>\n\n<img src="x.png" onerror="window.__pwned2 = true;" />\n\n后文');
    const markdownBody = container.querySelector(".markdown-body")!;

    expect(markdownBody.querySelector("script")).toBeNull();
    expect(markdownBody.textContent).not.toContain("window.__pwned");
    expect((window as any).__pwned).toBeUndefined();
    const img = markdownBody.querySelector("img");
    if (img) expect(img.getAttribute("onerror")).toBeNull();
  });

  it("GFM 管道表格仍正常渲染（不回归）", () => {
    renderDoc("| A | B |\n| --- | --- |\n| 1 | 2 |");
    const markdownBody = container.querySelector(".markdown-body")!;

    const table = markdownBody.querySelector("table");
    expect(table).not.toBeNull();
    expect(markdownBody.querySelectorAll("th").length).toBe(2);
    expect(table!.textContent).toContain("1");
  });

  it("标注高亮在 HTML 表格内文本上仍生效（不回归）", () => {
    const anno: Annotation = {
      id: "anno_1",
      docId: "doc_test",
      anchor: "CECW 技术体系",
      range: { start: 0, end: 8 },
      type: "highlight",
      color: "#fde68a",
      createdAt: "2026-07-13T00:00:00.000Z",
    } as Annotation;
    renderDoc(HTML_TABLE_BODY, [anno]);
    const markdownBody = container.querySelector(".markdown-body")!;

    const mark = markdownBody.querySelector('mark[data-anno-id="anno_1"]');
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("CECW 技术体系");
  });
});

// 计划文档的形状：嵌套一条，用来验证「按原文行号定位」而不是「数第几个 checkbox」
const TASK_BODY = [
  "# 整理计划",          // 1
  "",                    // 2
  "## 待办",             // 3
  "",                    // 4
  "- [x] 甲",            // 5
  "- [ ] 乙",            // 6
  "  - [x] 乙的子项",     // 7
].join("\n");

function checkboxes(): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input[type="checkbox"]'));
}

describe("DocViewer 任务复选框（spec interactive-task-checkbox）", () => {
  beforeEach(() => {
    mocks.appContext.toggleDocumentTask.mockClear();
    mocks.appContext.openInAppLink.mockClear();
    mocks.toastError.mockClear();
  });

  it("预览界面直接渲染出可交互的复选框，且勾选状态取自正文", () => {
    renderDoc(TASK_BODY);
    const boxes = checkboxes();
    expect(boxes).toHaveLength(3);
    expect(boxes.map((b) => b.checked)).toEqual([true, false, true]);
    expect(boxes.every((b) => b.disabled)).toBe(false);
  });

  it("点击只改该行：回调拿到的是原文行号", () => {
    renderDoc(TASK_BODY);
    act(() => {
      checkboxes()[1].click();
    });
    expect(mocks.appContext.toggleDocumentTask).toHaveBeenCalledTimes(1);
    expect(mocks.appContext.toggleDocumentTask).toHaveBeenCalledWith("doc_test", 6);
  });

  it("嵌套列表里的那条定位到它自己的行", () => {
    renderDoc(TASK_BODY);
    act(() => {
      checkboxes()[2].click();
    });
    expect(mocks.appContext.toggleDocumentTask).toHaveBeenCalledWith("doc_test", 7);
  });

  it("点击复选框不触发批注浮层", () => {
    renderDoc(TASK_BODY);
    act(() => {
      checkboxes()[0].click();
    });
    expect(container.querySelector("#annotation-popup")).toBeNull();
    expect(mocks.appContext.upsertAnnotation).not.toHaveBeenCalled();
  });

  it("批注模式下复选框不可点，文档不被修改", () => {
    renderDoc(TASK_BODY, [], { annotateMode: true });
    const boxes = checkboxes();
    expect(boxes.every((b) => b.disabled)).toBe(true);
    act(() => {
      boxes[1].click();
    });
    expect(mocks.appContext.toggleDocumentTask).not.toHaveBeenCalled();
  });

  it("预览历史版本时复选框不可点（勾了会把旧版本写回去）", () => {
    renderDoc(TASK_BODY, [], { bodyReadOnly: true });
    expect(checkboxes().every((b) => b.disabled)).toBe(true);
  });
});

describe("DocViewer 应用内链接（spec in-app-links）", () => {
  beforeEach(() => {
    mocks.appContext.openInAppLink.mockClear();
    mocks.toastError.mockClear();
  });

  it("pentou:// 链接被保留渲染，不被 sanitize / urlTransform 清空", () => {
    renderDoc("见 [选型讨论](pentou://conversation/conv_abc)。");
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("pentou://conversation/conv_abc");
    expect(a.getAttribute("target")).toBeNull(); // 不开新标签页
  });

  it("点击应用内链接走应用内跳转", () => {
    mocks.appContext.openInAppLink.mockReturnValue(true);
    renderDoc("见 [选型讨论](pentou://conversation/conv_abc)。");
    act(() => {
      container.querySelector("a")!.click();
    });
    expect(mocks.appContext.openInAppLink).toHaveBeenCalledWith({ kind: "conversation", id: "conv_abc" });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("目标不存在时提示，且正文原样保留", () => {
    mocks.appContext.openInAppLink.mockReturnValue(false);
    renderDoc("见 [已删除的](pentou://conversation/conv_gone)。");
    act(() => {
      container.querySelector("a")!.click();
    });
    expect(mocks.toastError).toHaveBeenCalled();
    expect(container.querySelector("a")!.getAttribute("href")).toBe("pentou://conversation/conv_gone");
  });

  it("非法标识不抛错，仍走提示分支", () => {
    mocks.appContext.openInAppLink.mockReturnValue(false);
    renderDoc("见 [坏链接](pentou://folder/df_1)。");
    act(() => {
      container.querySelector("a")!.click();
    });
    expect(mocks.appContext.openInAppLink).toHaveBeenCalledWith(null);
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it("普通外链仍在新标签页打开（不回归）", () => {
    renderDoc("见 [官网](https://example.com)。");
    const a = container.querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });
});
