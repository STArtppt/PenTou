/**
 * ai-chips.ts — AI 侧边栏的意图 chip（spec ai-intent-chips）。
 *
 * chip 是**UI affordance**，不是意图分类：展示它、切换视图、算它可不可用，全程零 LLM 调用。
 * 点击即确定性派发到对应技能 —— tool calling 本身就是意图层，再加一层前置分类器只会
 * +1 轮延迟、+1 处会错，而且可能与下游模型的判断打架。
 *
 * chip 统一的是**入口**，不是**流程**：每个 chip 走与其风险相称的确认形态（见 `confirmation`）。
 */

export type ChipId =
  | "conversation-to-doc"
  | "topic-digest"
  | "doc-folder-organize"
  | "annotation-driven-rewrite"
  | "run-plan";

/** 确认形态。批量且改动既有数据的才配计划文档；单件、产物即预览的不该被拖成三步。 */
export type ChipConfirmation = "plan-doc" | "artifact-preview" | "rewrite-dialog" | "execute-plan";

export interface IntentChip {
  id: ChipId;
  /** i18n key。 */
  labelKey: string;
  confirmation: ChipConfirmation;
  /** 需要用户先补一个参数（如主题）时给出输入框 placeholder 的 i18n key。 */
  promptKey?: string;
  disabled: boolean;
  /** 不可用的原因 i18n key —— 呈现为不可用并说明原因，而不是点了才失败。 */
  disabledReasonKey?: string;
}

export interface ChipState {
  activeView: "chat" | "doc";
  hasConversation: boolean;
  hasDocument: boolean;
  /** 当前文档是否有带评论的批注。 */
  hasCommentAnnotations: boolean;
  /** 当前文档是否是一份可执行的行动计划（带 `aiPlan` 结构化绑定）。 */
  isPlanDoc: boolean;
  hasLLM: boolean;
}

/**
 * 按当前视图算出 chip 列表。纯函数、无副作用、不触发任何请求 ——
 * 「展示 chip 不产生 LLM 调用」这条不变量靠的就是这里没有任何异步。
 */
export function chipsForView(state: ChipState): IntentChip[] {
  const chip = (
    id: ChipId,
    labelKey: string,
    confirmation: ChipConfirmation,
    blocked: string | null,
    promptKey?: string,
  ): IntentChip => {
    // 执行计划不需要模型 —— 计划已经写死了要做什么，执行阶段不该再问模型
    const noLLM = !state.hasLLM && confirmation !== "execute-plan";
    return {
      id,
      labelKey,
      confirmation,
      promptKey,
      disabled: noLLM || !!blocked,
      disabledReasonKey: noLLM ? "aiSidebar.chipNeedsModel" : blocked ?? undefined,
    };
  };

  if (state.activeView === "chat") {
    return [
      chip(
        "conversation-to-doc",
        "aiSidebar.chipConvertToDoc",
        "artifact-preview",
        state.hasConversation ? null : "aiSidebar.chipNeedsConversation",
      ),
      chip("topic-digest", "aiSidebar.chipTopicDigest", "artifact-preview", null, "aiSidebar.chipTopicPrompt"),
    ];
  }

  return [
    // 计划文档本身在场时，执行入口排第一 —— 用户刚勾完复选框，下一步就是执行
    ...(state.isPlanDoc
      ? [chip("run-plan", "aiSidebar.chipRunPlan", "execute-plan", null)]
      : []),
    chip("doc-folder-organize", "aiSidebar.chipOrganizeFolders", "plan-doc", null),
    chip(
      "annotation-driven-rewrite",
      "aiSidebar.chipRewriteByAnnotations",
      "rewrite-dialog",
      !state.hasDocument
        ? "aiSidebar.chipNeedsDocument"
        : !state.hasCommentAnnotations
          ? "aiSidebar.chipNeedsAnnotations"
          : null,
    ),
  ];
}
