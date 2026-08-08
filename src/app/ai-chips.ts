/**
 * ai-chips.ts — AI 侧边栏的意图 chip（spec ai-intent-chips）。
 *
 * chip 是**UI affordance**，不是意图分类：展示它、切换视图、算它可不可用，全程零 LLM 调用。
 * 点击进入选中态，回车/发送才确定性派发 —— tool calling 本身就是意图层，再加一层前置分类器只会
 * +1 轮延迟、+1 处会错，而且可能与下游模型的判断打架。
 *
 * chip 统一的是**入口与触发方式**，不是**流程**：每个 chip 走与其风险相称的确认形态（见 `confirmation`）。
 */

import type { TranslationKey } from "./i18n";

export type ChipId =
  | "conversation-to-doc"
  | "topic-digest"
  | "doc-folder-organize"
  | "annotation-driven-rewrite";

/**
 * 确认形态。批量且改动既有数据的才配计划文档；单件、产物即预览的不该被拖成三步。
 *
 * 注意这里**没有**「执行计划」—— 执行入口在计划状态条上，不在 chip 组里（spec plan-run-status D6）：
 * 计划文档本身就是批准形态，再要求「点 chip 进选中态 → 回车派发」是多余的一跳。
 */
export type ChipConfirmation = "plan-doc" | "artifact-preview" | "rewrite-dialog";

export interface IntentChip {
  id: ChipId;
  /** 可见文案 i18n key（中文四字 / 英文短标签）。 */
  labelKey: TranslationKey;
  /** 完整语义，用于 title / aria-label。 */
  a11yLabelKey: TranslationKey;
  confirmation: ChipConfirmation;
  /** 选中态输入框 placeholder 引导语。 */
  armedPromptKey: TranslationKey;
  /** true 时回车必须有非空输入（主题等）。 */
  requiresInput: boolean;
  disabled: boolean;
  /** 不可用的原因 i18n key —— 呈现为不可用并说明原因，而不是点了才失败。 */
  disabledReasonKey?: TranslationKey;
}

export interface ChipState {
  activeView: "chat" | "doc";
  hasConversation: boolean;
  hasDocument: boolean;
  /** 当前文档是否有带评论的批注。 */
  hasCommentAnnotations: boolean;
  hasLLM: boolean;
}

/**
 * 按当前视图算出 chip 列表。纯函数、无副作用、不触发任何请求 ——
 * 「展示 chip 不产生 LLM 调用」这条不变量靠的就是这里没有任何异步。
 */
export function chipsForView(state: ChipState): IntentChip[] {
  const chip = (
    id: ChipId,
    labelKey: TranslationKey,
    a11yLabelKey: TranslationKey,
    confirmation: ChipConfirmation,
    armedPromptKey: TranslationKey,
    requiresInput: boolean,
    blocked: TranslationKey | null,
  ): IntentChip => {
    const noLLM = !state.hasLLM;
    return {
      id,
      labelKey,
      a11yLabelKey,
      confirmation,
      armedPromptKey,
      requiresInput,
      disabled: noLLM || !!blocked,
      disabledReasonKey: noLLM ? "aiSidebar.chipNeedsModel" : blocked ?? undefined,
    };
  };

  if (state.activeView === "chat") {
    return [
      chip(
        "conversation-to-doc",
        "aiSidebar.chipConvertToDoc",
        "aiSidebar.chipConvertToDocA11y",
        "artifact-preview",
        "aiSidebar.chipConvertToDocArmed",
        false,
        state.hasConversation ? null : "aiSidebar.chipNeedsConversation",
      ),
      chip(
        "topic-digest",
        "aiSidebar.chipTopicDigest",
        "aiSidebar.chipTopicDigestA11y",
        "artifact-preview",
        "aiSidebar.chipTopicPrompt",
        true,
        null,
      ),
    ];
  }

  return [
    chip(
      "doc-folder-organize",
      "aiSidebar.chipOrganizeFolders",
      "aiSidebar.chipOrganizeFoldersA11y",
      "plan-doc",
      "aiSidebar.chipOrganizeFoldersArmed",
      false,
      null,
    ),
    chip(
      "annotation-driven-rewrite",
      "aiSidebar.chipRewriteByAnnotations",
      "aiSidebar.chipRewriteByAnnotationsA11y",
      "rewrite-dialog",
      "aiSidebar.chipRewriteByAnnotationsArmed",
      false,
      !state.hasDocument
        ? "aiSidebar.chipNeedsDocument"
        : !state.hasCommentAnnotations
          ? "aiSidebar.chipNeedsAnnotations"
          : null,
    ),
  ];
}
