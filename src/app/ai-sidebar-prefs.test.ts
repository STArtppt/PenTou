import { describe, expect, it } from "vitest";
import {
  parseAiSidebarOpen,
  parseAiSidebarSide,
  parseShortcutTipDismissed,
  readAiSidebarOpen,
  readAiSidebarSide,
  writeAiSidebarOpen,
  writeAiSidebarSide,
} from "./ai-sidebar-prefs";

function memStorage(init: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(init));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    key: (i: number) => [...map.keys()][i] ?? null,
  };
}

describe("ai-sidebar-prefs parse/read", () => {
  it("parses side with default right", () => {
    expect(parseAiSidebarSide("left")).toBe("left");
    expect(parseAiSidebarSide("right")).toBe("right");
    expect(parseAiSidebarSide(null)).toBe("right");
    expect(parseAiSidebarSide("nope")).toBe("right");
  });

  it("parses open with default collapsed", () => {
    expect(parseAiSidebarOpen("1")).toBe(true);
    expect(parseAiSidebarOpen("0")).toBe(false);
    expect(parseAiSidebarOpen(null)).toBe(false);
    expect(parseAiSidebarOpen("true")).toBe(false);
  });

  it("parses shortcut tip dismissed", () => {
    expect(parseShortcutTipDismissed("1")).toBe(true);
    expect(parseShortcutTipDismissed("0")).toBe(false);
    expect(parseShortcutTipDismissed(null)).toBe(false);
  });

  it("reads and writes side/open via storage", () => {
    const s = memStorage();
    expect(readAiSidebarSide(s)).toBe("right");
    expect(readAiSidebarOpen(s)).toBe(false);
    writeAiSidebarSide("left", s);
    writeAiSidebarOpen(true, s);
    expect(readAiSidebarSide(s)).toBe("left");
    expect(readAiSidebarOpen(s)).toBe(true);
  });
});
