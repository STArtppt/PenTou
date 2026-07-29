import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { defaultConfig, defaultOpencodeDb, normalizeConfig } from "./config";

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

// ── docs adapter 配置（spec collector-docs-push §docs adapter 的配置与注册）──────

describe("docs adapter config", () => {
  it("defaults to disabled with no registered dirs — nothing is scanned unless asked", () => {
    expect(defaultConfig().adapters.docs).toEqual({ enabled: false, dirs: [] });
  });

  it("stays disabled for legacy configs that predate the docs section", () => {
    const cfg = normalizeConfig({
      server: "http://localhost:5173",
      token: "tok",
      adapters: { "claude-code": { enabled: true } },
    });
    expect(cfg.adapters.docs).toEqual({ enabled: false, dirs: [] });
  });

  it("expands ~ in registered dirs and keeps the explicit project key", () => {
    const cfg = normalizeConfig({
      server: "http://localhost:5173",
      token: "tok",
      adapters: { docs: { enabled: true, dirs: [{ path: "~/proj/pentou/docs", project: "pentou" }] } },
    });
    expect(cfg.adapters.docs.enabled).toBe(true);
    expect(cfg.adapters.docs.dirs).toEqual([
      { path: path.join(os.homedir(), "proj", "pentou", "docs"), project: "pentou" },
    ]);
  });

  it("accepts a bare string entry and drops malformed ones", () => {
    const cfg = normalizeConfig({
      server: "http://localhost:5173",
      token: "tok",
      adapters: { docs: { enabled: true, dirs: ["/tmp/docs", { path: "  " }, null, 42] } },
    });
    expect(cfg.adapters.docs.dirs).toEqual([{ path: path.resolve("/tmp/docs") }]);
  });
});
