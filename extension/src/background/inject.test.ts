import { describe, expect, it, vi } from "vitest";
import { contentScriptFiles, sendToContentScript } from "./inject";
import type { ContentRequest, ContentResponse } from "../shared/types";

const REQUEST: ContentRequest = { type: "PENTOU_CAPTURE", trigger: "manual" };
const OK: ContentResponse = { ok: true, supported: true, platform: "deepseek", externalId: "s1" };

describe("contentScriptFiles", () => {
  it("reads the injected file list from the manifest (not a hardcoded hash name)", () => {
    const runtime = {
      getManifest: () => ({ content_scripts: [{ js: ["assets/index.ts-loader-abc123.js"] }] }),
    } as unknown as typeof chrome.runtime;
    expect(contentScriptFiles(runtime)).toEqual(["assets/index.ts-loader-abc123.js"]);
  });

  it("returns an empty list when the manifest declares no content scripts", () => {
    const runtime = { getManifest: () => ({}) } as unknown as typeof chrome.runtime;
    expect(contentScriptFiles(runtime)).toEqual([]);
  });
});

describe("sendToContentScript", () => {
  it("returns the response without injecting when the content script is alive", async () => {
    const executeScript = vi.fn();
    const res = await sendToContentScript(1, REQUEST, {
      sendMessage: async () => OK,
      executeScript,
      files: ["cs.js"],
    });
    expect(res).toEqual(OK);
    expect(executeScript).not.toHaveBeenCalled();
  });

  // 插件重载会让已打开标签页里的 content script 失效，这是 N/A 误报的来源
  it("injects and retries when the first delivery fails", async () => {
    const executeScript = vi.fn(async () => undefined);
    const sendMessage = vi
      .fn<[number, ContentRequest], Promise<ContentResponse>>()
      .mockRejectedValueOnce(new Error("Could not establish connection"))
      .mockResolvedValueOnce(OK);

    const res = await sendToContentScript(7, REQUEST, { sendMessage, executeScript, files: ["cs.js"] });

    expect(res).toEqual(OK);
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ["cs.js"] });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("gives up when injection is not permitted (genuinely unsupported page)", async () => {
    const res = await sendToContentScript(1, REQUEST, {
      sendMessage: async () => {
        throw new Error("no receiver");
      },
      executeScript: async () => {
        throw new Error("Cannot access contents of the page");
      },
      files: ["cs.js"],
    });
    expect(res).toBeUndefined();
  });

  it("gives up when the retry after injection still fails", async () => {
    const res = await sendToContentScript(1, REQUEST, {
      sendMessage: async () => {
        throw new Error("no receiver");
      },
      executeScript: async () => undefined,
      files: ["cs.js"],
    });
    expect(res).toBeUndefined();
  });
});
