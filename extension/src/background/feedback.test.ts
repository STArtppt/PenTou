import { describe, expect, it } from "vitest";
import { actionText, successFeedback, successMessage, SUCCESS_BADGE_COLOR } from "./feedback";

describe("actionText", () => {
  it("maps ingest actions to badge text, created winning over merged/skipped", () => {
    expect(actionText({ created: 1 })).toBe("NEW");
    expect(actionText({ merged: 1 })).toBe("UPD");
    expect(actionText({ skipped: 1 })).toBe("SKIP");
    expect(actionText({ created: 1, merged: 1, skipped: 1 })).toBe("NEW");
    expect(actionText({})).toBe("OK");
    expect(actionText(undefined)).toBe("OK");
  });
});

describe("successMessage", () => {
  it("describes each outcome, only offering the Pentou link when something changed", () => {
    expect(successMessage({ created: 1 })).toContain("new conversation");
    expect(successMessage({ merged: 1 })).toContain("updated");
    expect(successMessage({ skipped: 1 })).toBe("Already up to date - nothing changed.");
    expect(successMessage(undefined)).toBe("Capture accepted.");
  });
});

describe("successFeedback", () => {
  // 用户报告：手动采集成功时通知被 macOS 屏蔽 → 界面上毫无反馈，与"没生效"无法区分
  it("sets the badge for manual captures too, so a blocked notification is not the only signal", () => {
    const fb = successFeedback({ created: 1 }, "manual");
    expect(fb.badge).toBe("NEW");
    expect(fb.badgeColor).toBe(SUCCESS_BADGE_COLOR);
    expect(fb.notify).toBe(true);
  });

  it("keeps auto captures silent: badge only, no notification", () => {
    const fb = successFeedback({ skipped: 1 }, "auto");
    expect(fb.badge).toBe("SKIP");
    expect(fb.notify).toBe(false);
  });

  it("produces the same badge for both triggers", () => {
    for (const actions of [{ created: 1 }, { merged: 1 }, { skipped: 1 }, undefined]) {
      expect(successFeedback(actions, "manual").badge).toBe(successFeedback(actions, "auto").badge);
    }
  });
});
