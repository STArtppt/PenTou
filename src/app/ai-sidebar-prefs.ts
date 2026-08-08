/** AI 侧栏桌面偏好（spec ai-sidebar-layout）：纯函数，便于单测与非法值回退。 */

export type AiSidebarSide = "left" | "right";

export const AI_SIDEBAR_SIDE_KEY = "pentou-ai-sidebar-side";
export const AI_SIDEBAR_OPEN_KEY = "pentou-ai-sidebar-open";
export const AI_SHORTCUT_TIP_DISMISSED_KEY = "pentou-ai-shortcut-tip-dismissed";

export function parseAiSidebarSide(raw: string | null | undefined): AiSidebarSide {
  return raw === "left" || raw === "right" ? raw : "right";
}

export function parseAiSidebarOpen(raw: string | null | undefined): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return false;
}

export function parseShortcutTipDismissed(raw: string | null | undefined): boolean {
  return raw === "1";
}

export function readAiSidebarSide(storage: Pick<Storage, "getItem"> = localStorage): AiSidebarSide {
  try {
    return parseAiSidebarSide(storage.getItem(AI_SIDEBAR_SIDE_KEY));
  } catch {
    return "right";
  }
}

export function writeAiSidebarSide(
  side: AiSidebarSide,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(AI_SIDEBAR_SIDE_KEY, side);
  } catch {
    /* private mode / quota */
  }
}

export function readAiSidebarOpen(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    return parseAiSidebarOpen(storage.getItem(AI_SIDEBAR_OPEN_KEY));
  } catch {
    return false;
  }
}

export function writeAiSidebarOpen(
  open: boolean,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(AI_SIDEBAR_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
}

export function readShortcutTipDismissed(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    return parseShortcutTipDismissed(storage.getItem(AI_SHORTCUT_TIP_DISMISSED_KEY));
  } catch {
    return false;
  }
}

export function writeShortcutTipDismissed(
  dismissed: boolean,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(AI_SHORTCUT_TIP_DISMISSED_KEY, dismissed ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
}
