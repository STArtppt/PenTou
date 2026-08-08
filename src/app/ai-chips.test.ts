import { describe, expect, it } from "vitest";
import { chipsForView, type ChipState } from "./ai-chips";

const base: ChipState = {
  activeView: "chat",
  hasConversation: true,
  hasDocument: false,
  hasCommentAnnotations: false,
  isPlanDoc: false,
  hasLLM: true,
};

const idsOf = (state: Partial<ChipState>) => chipsForView({ ...base, ...state }).map((c) => c.id);

describe("按当前视图展示 chip（spec ai-intent-chips）", () => {
  it("会话视图展示「转成文档」与「整理某主题的会话」", () => {
    expect(idsOf({ activeView: "chat" })).toEqual(["conversation-to-doc", "topic-digest"]);
  });

  it("文档视图展示「整理文档目录」与「根据批注重写」", () => {
    expect(idsOf({ activeView: "doc", hasDocument: true })).toEqual([
      "doc-folder-organize",
      "annotation-driven-rewrite",
    ]);
  });

  it("是纯同步函数 —— 算 chip 不可能产生任何请求", () => {
    const result = chipsForView(base);
    expect(Array.isArray(result)).toBe(true);
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe("前置条件不满足时呈现为不可用并说明原因", () => {
  it("没选中会话时「转成文档」不可用", () => {
    const chip = chipsForView({ ...base, hasConversation: false })[0];
    expect(chip.disabled).toBe(true);
    expect(chip.disabledReasonKey).toBe("aiSidebar.chipNeedsConversation");
  });

  it("没有批注时「根据批注重写」不可用，理由明确", () => {
    const chip = chipsForView({ ...base, activeView: "doc", hasDocument: true })[1];
    expect(chip.disabled).toBe(true);
    expect(chip.disabledReasonKey).toBe("aiSidebar.chipNeedsAnnotations");
  });

  it("有带评论的批注时可用", () => {
    const chip = chipsForView({
      ...base,
      activeView: "doc",
      hasDocument: true,
      hasCommentAnnotations: true,
    })[1];
    expect(chip.disabled).toBe(false);
    expect(chip.disabledReasonKey).toBeUndefined();
  });

  it("没配模型时全部 chip 不可用，理由是「先配模型」", () => {
    for (const chip of chipsForView({ ...base, hasLLM: false })) {
      expect(chip.disabled).toBe(true);
      expect(chip.disabledReasonKey).toBe("aiSidebar.chipNeedsModel");
    }
  });

  it("「整理文档目录」不依赖当前是否打开了某篇文档", () => {
    const chip = chipsForView({ ...base, activeView: "doc", hasDocument: false })[0];
    expect(chip.disabled).toBe(false);
  });
});

describe("各 chip 走各自的确认形态（design D5）", () => {
  it("只有「整理文档目录」走计划文档", () => {
    const all = [...chipsForView(base), ...chipsForView({ ...base, activeView: "doc", hasDocument: true })];
    expect(all.filter((c) => c.confirmation === "plan-doc").map((c) => c.id)).toEqual(["doc-folder-organize"]);
  });

  it("转文档与主题汇总是产物即预览，不额外套计划", () => {
    for (const chip of chipsForView(base)) expect(chip.confirmation).toBe("artifact-preview");
  });

  it("批注重写复用既有确认框", () => {
    const chip = chipsForView({ ...base, activeView: "doc", hasDocument: true })[1];
    expect(chip.confirmation).toBe("rewrite-dialog");
  });

  it("只有主题汇总需要用户先补一个参数", () => {
    const all = [...chipsForView(base), ...chipsForView({ ...base, activeView: "doc", hasDocument: true })];
    expect(all.filter((c) => c.requiresInput).map((c) => c.id)).toEqual(["topic-digest"]);
  });

  it("每个 chip 都有选中态引导语与完整 a11y 文案 key", () => {
    const all = [
      ...chipsForView(base),
      ...chipsForView({ ...base, activeView: "doc", hasDocument: true, isPlanDoc: true }),
    ];
    for (const chip of all) {
      expect(chip.armedPromptKey).toBeTruthy();
      expect(chip.a11yLabelKey).toBeTruthy();
      expect(chip.a11yLabelKey).not.toBe(chip.labelKey);
    }
  });
});

describe("计划的执行入口（spec agent-write-policy 批准协议）", () => {
  it("打开一份计划文档时，执行入口排在文档视图 chip 首位", () => {
    expect(idsOf({ activeView: "doc", hasDocument: true, isPlanDoc: true })).toEqual([
      "run-plan",
      "doc-folder-organize",
      "annotation-driven-rewrite",
    ]);
  });

  it("普通文档不出现执行入口 —— 没有计划就没有可执行的东西", () => {
    expect(idsOf({ activeView: "doc", hasDocument: true })).not.toContain("run-plan");
  });

  it("会话视图不出现执行入口", () => {
    expect(idsOf({ activeView: "chat", isPlanDoc: true })).not.toContain("run-plan");
  });

  it("执行计划不需要模型 —— 没配模型时它依然可用", () => {
    const chips = chipsForView({ ...base, activeView: "doc", hasDocument: true, isPlanDoc: true, hasLLM: false });
    const runPlan = chips.find((c) => c.id === "run-plan")!;
    expect(runPlan.disabled).toBe(false);
    expect(chips.find((c) => c.id === "doc-folder-organize")!.disabled).toBe(true);
  });
});

