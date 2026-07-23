// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocViewer } from "./DocViewer";
import type { Annotation } from "../data";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo = vi.fn();

const mocks = vi.hoisted(() => ({
  appContext: {
    language: "zh",
    upsertAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    searchJump: null,
    setSearchJump: vi.fn(),
  } as any,
}));

vi.mock("../data", () => ({
  useAppContext: () => mocks.appContext,
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

function renderDoc(body: string, annotations: Annotation[] = []) {
  act(() => {
    root.render(<DocViewer docId="doc_test" body={body} annotations={annotations} annotateMode={false} />);
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
