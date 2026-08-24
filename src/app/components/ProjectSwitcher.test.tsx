// @vitest-environment jsdom
/**
 * ProjectSwitcher.test.tsx —— 文档视图的项目选择器（spec document-projects
 * §项目切换选择器 / §项目描述可编辑 / §项目重命名与身份稳定性 / §项目删除）。
 */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentProject } from "../data";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo = vi.fn((..._args: unknown[]) => {}) as typeof Element.prototype.scrollTo;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

const PROJECTS: DocumentProject[] = [
  { id: "dp_pentou", name: "笔头文档", description: "/Users/x/proj/pentou/docs", sourceKey: "pentou", createdAt: "" },
  { id: "dp_bare", name: "无描述项目", description: "", sourceKey: "bare", createdAt: "" },
];

const mocks = vi.hoisted(() => ({
  appContext: {} as any,
}));

vi.mock("../data", async () => {
  const actual = await vi.importActual<typeof import("../data")>("../data");
  return { ...actual, useAppContext: () => mocks.appContext };
});

vi.mock("../i18n", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const table: Record<string, string> = {
        "sidebar.defaultProject": "默认目录",
        "sidebar.defaultProjectDescription": "对话转或手动传的综合目录",
        "sidebar.projectSwitcher": "切换项目",
        "sidebar.projectActions": "项目操作",
        "sidebar.newProject": "新建项目",
        "sidebar.newProjectHint": "项目是文件夹之上的一层分组",
        "sidebar.newProjectFailed": "新建失败，可能已存在同名项目。",
        "sidebar.create": "创建",
        "sidebar.editProject": "编辑项目",
        "sidebar.editProjectHint": "名称和描述都只是展示用",
        "sidebar.deleteProject": "删除项目",
        "sidebar.deleteProjectPrompt": `确定要删除项目「${vars?.name ?? ""}」吗？其下文件夹将被删除，文档与对话会移至默认目录的未分类`,
        "sidebar.backfillNotice": `已按来源项目整理 ${vars?.n ?? 0} 条对话`,
        "sidebar.projectName": "项目名称",
        "sidebar.projectDescription": "极简描述",
        "sidebar.cancel": "取消",
        "sidebar.save": "保存",
        "sidebar.confirm": "确定",
        "sidebar.delete": "删除",
      };
      return table[key] ?? key;
    },
  }),
}));

// 重型子系统与本用例无关，桩掉以免 jsdom 里跑 dnd / 动画
vi.mock("react-dnd", () => ({
  useDrag: () => [{ isDragging: false }, () => {}],
  useDrop: () => [{ isOver: false }, () => {}],
}));

let container: HTMLDivElement;
let root: Root;
let ProjectSwitcher: typeof import("./Sidebar")["ProjectSwitcher"];

beforeEach(async () => {
  ({ ProjectSwitcher } = await import("./Sidebar"));
  mocks.appContext = {
    activeView: "doc",
    documentProjects: PROJECTS,
    activeProjectId: null,
    setActiveProjectId: vi.fn(),
    activeConversationProjectId: null,
    setActiveConversationProjectId: vi.fn(),
    createDocumentProject: vi.fn().mockResolvedValue(PROJECTS[0]),
    updateDocumentProject: vi.fn(),
    deleteDocumentProject: vi.fn(),
    documentFolders: [],
    documents: [],
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render() {
  act(() => { root.render(<ProjectSwitcher />); });
}

function texts(selector: string, scope: ParentNode = document): string[] {
  return [...scope.querySelectorAll(selector)].map((el) => el.textContent?.trim() ?? "");
}

function click(el: Element | null | undefined) {
  expect(el, "element to click must exist").toBeTruthy();
  act(() => { (el as HTMLElement).click(); });
}

/** Select 自带一个 aria-hidden 的隐藏 input，只取可见的那些（弹窗里的文本框）。 */
function visibleInputs(): HTMLInputElement[] {
  const inputs = [...document.querySelectorAll("input")].filter((el) => !el.hasAttribute("aria-hidden"));
  expect(inputs.length, "modal inputs must be rendered").toBeGreaterThan(0);
  return inputs as HTMLInputElement[];
}

function setValue(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function findByText(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((el) => el.textContent?.includes(text));
}

describe("ProjectSwitcher options", () => {
  it("shows the readable name and description in the closed trigger, not the raw id", () => {
    render();
    const lines = container.querySelector('[data-slot="select-value-lines"]');
    expect(lines).toBeTruthy();
    expect(lines?.textContent).toContain("默认目录");
    expect(lines?.textContent).toContain("对话转或手动传的综合目录");
    // 内部 id 绝不出现在界面上
    expect(container.textContent).not.toContain("dp_default");
    expect(container.querySelector<HTMLInputElement>("input[aria-hidden]")?.value).toBe("dp_default");
  });

  it("mirrors the two-line variant in the trigger for a real project", () => {
    mocks.appContext.activeProjectId = "dp_pentou";
    render();
    const lines = container.querySelector('[data-slot="select-value-lines"]');
    expect(lines?.getAttribute("data-variant")).toBe("described");
    expect(lines?.textContent).toContain("笔头文档");
    expect(lines?.textContent).toContain("/Users/x/proj/pentou/docs");
    expect(container.textContent).not.toContain("dp_pentou");
  });

  it("collapses the trigger to one line when the project has no description", () => {
    mocks.appContext.activeProjectId = "dp_bare";
    render();
    const lines = container.querySelector('[data-slot="select-value-lines"]');
    expect(lines?.getAttribute("data-variant")).toBeNull();
    expect(lines?.textContent).toBe("无描述项目");
  });

  it("renders two-line options and degrades to one line when the description is empty", () => {
    render();
    click(container.querySelector('[data-slot="select-trigger"]'));

    const items = [...document.querySelectorAll('[data-slot="select-item"]')];
    expect(items.map((el) => el.querySelector('[data-slot="select-item-description"]')?.textContent ?? null))
      .toEqual([
        "对话转或手动传的综合目录", // 默认目录：固定文案
        "/Users/x/proj/pentou/docs",
        null,                       // 描述为空 → 只渲染主行，无占位符文字
      ]);
    // 描述为空的选项被标记为单行变体
    expect(items.map((el) => el.getAttribute("data-variant")))
      .toEqual(["described", "described", null]);
    expect(texts('[data-slot="select-item"] > span:first-of-type').length).toBeGreaterThan(0);
  });
});

describe("default folder is not editable", () => {
  it("keeps the actions button but disables edit / delete while the default folder is selected", () => {
    render();
    // 更多按钮常驻：它同时是新建项目的入口，默认目录下不能整块消失
    click(container.querySelector('button[aria-label="项目操作"]'));
    expect(findByText("新建项目")?.disabled).toBe(false);
    expect(findByText("编辑项目")?.disabled).toBe(true);
    expect(findByText("删除项目")?.disabled).toBe(true);
  });

  it("creates a project from the default folder and hands the name to the data layer", async () => {
    render();
    click(container.querySelector('button[aria-label="项目操作"]'));
    click(findByText("新建项目"));

    const [nameInput, descInput] = visibleInputs();
    setValue(nameInput, "  新项目  ");
    setValue(descInput, "随手记");
    click(findByText("创建"));
    await act(async () => { await Promise.resolve(); });

    expect(mocks.appContext.createDocumentProject)
      .toHaveBeenCalledWith({ name: "新项目", description: "随手记" });
    expect(mocks.appContext.setActiveProjectId).toHaveBeenCalledWith("dp_pentou");
    expect(mocks.appContext.setActiveConversationProjectId).not.toHaveBeenCalled();
    // 成功后弹窗关闭
    expect([...document.querySelectorAll("input")].filter((el) => !el.hasAttribute("aria-hidden"))).toHaveLength(0);
  });

  it("keeps the dialog open with an error when the name is already taken", async () => {
    mocks.appContext.createDocumentProject = vi.fn().mockRejectedValue(new Error("API failed: 409"));
    render();
    click(container.querySelector('button[aria-label="项目操作"]'));
    click(findByText("新建项目"));

    setValue(visibleInputs()[0], "笔头文档");
    click(findByText("创建"));
    await act(async () => { await Promise.resolve(); });

    expect(document.body.textContent).toContain("新建失败");
    expect(visibleInputs().length).toBeGreaterThan(0);
  });

  it("refuses to submit an empty project name", () => {
    render();
    click(container.querySelector('button[aria-label="项目操作"]'));
    click(findByText("新建项目"));

    expect(findByText("创建")?.disabled).toBe(true);
    expect(mocks.appContext.createDocumentProject).not.toHaveBeenCalled();
  });
});

describe("project actions", () => {
  beforeEach(() => {
    mocks.appContext.activeProjectId = "dp_pentou";
  });

  it("offers three entries and enables edit / delete for a real project", () => {
    render();
    click(container.querySelector('button[aria-label="项目操作"]'));
    const menu = [...document.querySelectorAll("button")]
      .filter((b) => ["新建项目", "编辑项目", "删除项目"].includes(b.textContent?.trim() ?? ""));
    expect(menu.map((b) => b.textContent?.trim())).toEqual(["新建项目", "编辑项目", "删除项目"]);
    expect(menu.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false, false]);
  });

  it("edits name and description together in one dialog", () => {
    render();
    click(container.querySelector('button[aria-label="项目操作"]'));
    click(findByText("编辑项目"));

    const [nameInput, descInput] = visibleInputs();
    expect(nameInput.value).toBe("笔头文档");
    expect(descInput.value).toBe("/Users/x/proj/pentou/docs");
    setValue(nameInput, "新名字");
    setValue(descInput, "新描述");
    click(findByText("保存"));

    expect(mocks.appContext.updateDocumentProject)
      .toHaveBeenCalledWith("dp_pentou", { name: "新名字", description: "新描述" });
  });

  it("allows clearing the description but keeps the previous name when it is blanked", () => {
    render();
    click(container.querySelector('button[aria-label="项目操作"]'));
    click(findByText("编辑项目"));

    const [nameInput, descInput] = visibleInputs();
    setValue(nameInput, "   ");
    setValue(descInput, "");
    click(findByText("保存"));

    expect(mocks.appContext.updateDocumentProject)
      .toHaveBeenCalledWith("dp_pentou", { name: "笔头文档", description: "" });
  });

  it("spells out the consequences before deleting", () => {
    render();
    click(container.querySelector('button[aria-label="项目操作"]'));
    click(findByText("删除项目"));

    const prompt = document.body.textContent ?? "";
    expect(prompt).toContain("文件夹将被删除");
    expect(prompt).toContain("文档与对话会移至默认目录的未分类");
  });
});

describe("conversation view remembers its own project", () => {
  it("selects the conversation-view project without touching the document view", () => {
    mocks.appContext.activeView = "chat";
    mocks.appContext.activeConversationProjectId = "dp_pentou";
    mocks.appContext.activeProjectId = null;
    render();
    const lines = container.querySelector('[data-slot="select-value-lines"]');
    expect(lines?.textContent).toContain("笔头文档");
  });

  it("creates a project from the conversation view and only switches that view", async () => {
    mocks.appContext.activeView = "chat";
    render();
    click(container.querySelector('button[aria-label="项目操作"]'));
    click(findByText("新建项目"));
    setValue(visibleInputs()[0], "实验");
    click(findByText("创建"));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.appContext.setActiveConversationProjectId).toHaveBeenCalledWith("dp_pentou");
    expect(mocks.appContext.setActiveProjectId).not.toHaveBeenCalled();
  });
});
