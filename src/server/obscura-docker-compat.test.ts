import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveObscuraAssetName } from "../../vite-plugins/obscura";

const repoRoot = path.resolve(import.meta.dirname, "../..");

describe("obscura docker / platform compatibility", () => {
  it("maps linux amd64 and arm64 to glibc release assets", () => {
    expect(resolveObscuraAssetName("linux", "x64")).toBe("obscura-x86_64-linux.tar.gz");
    expect(resolveObscuraAssetName("linux", "amd64")).toBe("obscura-x86_64-linux.tar.gz");
    expect(resolveObscuraAssetName("linux", "arm64")).toBe("obscura-aarch64-linux.tar.gz");
    expect(resolveObscuraAssetName("linux", "aarch64")).toBe("obscura-aarch64-linux.tar.gz");
  });

  it("download-obscura.cjs includes linux-arm64 asset (not a hard null)", () => {
    const src = fs.readFileSync(path.join(repoRoot, "scripts/download-obscura.cjs"), "utf8");
    expect(src).toContain("obscura-aarch64-linux.tar.gz");
    expect(src).not.toMatch(/no linux-arm64 binary upstream/);
  });

  it("Dockerfile runtime is glibc-based (not Alpine/musl)", () => {
    const dockerfile = fs.readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
    // Both stages must share a glibc family so native deps + obscura work.
    expect(dockerfile).toMatch(/FROM node:22-bookworm-slim AS builder/);
    expect(dockerfile).toMatch(/FROM node:22-bookworm-slim AS runtime/);
    expect(dockerfile).not.toMatch(/FROM node:.*-alpine/);
    // Document why: ENOENT when PT_INTERP missing on musl.
    expect(dockerfile.toLowerCase()).toMatch(/glibc|musl|alpine/);
  });
});
