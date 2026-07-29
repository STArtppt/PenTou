import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { defaultConfig, defaultOpencodeDb } from "./config";

const ORIGINAL_XDG_DATA_HOME = process.env.XDG_DATA_HOME;

function setXdgDataHome(value: string | undefined): void {
  if (value === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = value;
}

afterEach(() => {
  setXdgDataHome(ORIGINAL_XDG_DATA_HOME);
});

describe("defaultOpencodeDb", () => {
  it("falls back to ~/.local/share when XDG_DATA_HOME is unset", () => {
    setXdgDataHome(undefined);
    expect(defaultOpencodeDb()).toBe(path.join(os.homedir(), ".local", "share", "opencode", "opencode.db"));
  });

  it("honors XDG_DATA_HOME, matching opencode's own Global.Path.data", () => {
    setXdgDataHome(path.join(os.tmpdir(), "xdg-data"));
    expect(defaultOpencodeDb()).toBe(path.join(os.tmpdir(), "xdg-data", "opencode", "opencode.db"));
  });

  it("treats an empty XDG_DATA_HOME as unset, like xdg-basedir's `||`", () => {
    setXdgDataHome("");
    expect(defaultOpencodeDb()).toBe(path.join(os.homedir(), ".local", "share", "opencode", "opencode.db"));
  });

  it("feeds the resolved path into the default config", () => {
    setXdgDataHome(path.join(os.tmpdir(), "xdg-data"));
    expect(defaultConfig().adapters.opencode.db).toBe(
      path.join(os.tmpdir(), "xdg-data", "opencode", "opencode.db"),
    );
  });
});
