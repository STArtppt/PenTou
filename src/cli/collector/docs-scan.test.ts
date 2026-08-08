/**
 * docs-scan.test.ts —— 文档扫描/推导的唯一实现（spec collector-docs-push
 * §扫描范围与排除规则 / §标题与 externalKey 推导 / §项目映射；
 * 以及 docs-path-title 路径拼串标题）。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  composeDocsPathTitle,
  deriveDocExternalId,
  deriveDocsPathTitle,
  deriveDocsPathTitleFromExternalId,
  discoverDocs,
  isSkippedDocsPath,
  resolveDocsEntry,
  toDocumentItem,
} from "./adapters/docs-scan";
import { createDocsAdapter } from "./adapters/docs";
import { createAdapters } from "./adapters/index";
import { defaultConfig } from "./config";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pentou-docs-scan-"));
}

function write(root: string, relative: string, content: string): string {
  const full = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
  return full;
}

describe("docs scan discovery", () => {
  it("collects only .md files and skips build-output directories", async () => {
    const root = tmpDir();
    write(root, "README.md", "# Readme");
    write(root, "guides/deploy.md", "# Deploy");
    write(root, "notes.txt", "ignore me");
    write(root, "spec.pdf", "ignore me");
    write(root, "node_modules/pkg/README.md", "# Dep");
    write(root, "dist/bundle.md", "# Build output");
    write(root, ".git/COMMIT_EDITMSG.md", "# Git");
    write(root, "coverage/report.md", "# Coverage");

    const files = await discoverDocs([{ path: root }]);
    expect(files.map((f) => path.relative(root, f.path).split(path.sep).join("/")).sort())
      .toEqual(["README.md", "guides/deploy.md"]);
    expect(files.every((f) => f.platform === "docs")).toBe(true);
  });

  it("accepts .MD regardless of case", async () => {
    const root = tmpDir();
    write(root, "Upper.MD", "# Upper");
    const files = await discoverDocs([{ path: root }]);
    expect(files).toHaveLength(1);
  });

  it("blocks skipped directories on the watch path too, not just during the walk", () => {
    const root = tmpDir();
    expect(isSkippedDocsPath(root, path.join(root, "node_modules", "pkg", "README.md"))).toBe(true);
    expect(isSkippedDocsPath(root, path.join(root, "guides", "a.md"))).toBe(false);
    // 登记目录之外的路径同样不上报
    expect(isSkippedDocsPath(root, path.join(path.dirname(root), "other", "a.md"))).toBe(true);
  });
});

describe("docs path-composed title", () => {
  it("uses parent dir + stem for nested skill files (preserves stem case)", () => {
    const root = path.join(path.sep, "Users", "x", "pentou");
    expect(deriveDocsPathTitle(
      path.join(root, "skills", "design-system-loop", "SKILL.md"),
      root,
      "pentou",
    )).toBe("design-system-loop-SKILL");
  });

  it("uses parent dir + stem for nested openspec tasks", () => {
    const root = path.join(path.sep, "tmp", "repo");
    expect(deriveDocsPathTitle(
      path.join(root, "openspec", "changes", "plan-run-status", "tasks.md"),
      root,
      "any",
    )).toBe("plan-run-status-tasks");
  });

  it("uses project key + stem for root-level files", () => {
    const root = path.join(path.sep, "tmp", "repo");
    expect(deriveDocsPathTitle(path.join(root, "README.md"), root, "pentou")).toBe("pentou-README");
  });

  it("ignores frontmatter title and level-1 headings", async () => {
    const root = tmpDir();
    write(root, "docs/guide.md", "---\ntitle: 部署手册\n---\n\n# Deploy\n\nbody");
    const item = await toDocumentItem(path.join(root, "docs", "guide.md"), { path: root, project: "pentou" });
    expect((item!.data as any).title).toBe("docs-guide");
  });

  it("depends on the registered root (narrow root lowers distinction)", async () => {
    const root = tmpDir();
    write(root, "docs/guide.md", "# G");
    const docsRoot = path.join(root, "docs");
    const asRepoRoot = await toDocumentItem(path.join(docsRoot, "guide.md"), { path: root, project: "proj" });
    const asDocsRoot = await toDocumentItem(path.join(docsRoot, "guide.md"), { path: docsRoot, project: "proj" });
    expect((asRepoRoot!.data as any).title).toBe("docs-guide");
    expect((asDocsRoot!.data as any).title).toBe("proj-guide");
  });

  it("normalizes Windows-style separators via path.relative", () => {
    // composeDocsPathTitle is the pure core; relative paths always arrive as /
    expect(composeDocsPathTitle("pentou", "skills/foo/SKILL.md")).toBe("foo-SKILL");
    expect(composeDocsPathTitle("pentou", "README.md")).toBe("pentou-README");
  });

  it("recomputes the same title from externalId (server-side pure function)", () => {
    expect(deriveDocsPathTitleFromExternalId("pentou/skills/foo/SKILL.md")).toBe("foo-SKILL");
    expect(deriveDocsPathTitleFromExternalId("pentou/README.md")).toBe("pentou-README");
    expect(deriveDocsPathTitleFromExternalId("pentou/openspec/changes/plan-run-status/tasks.md"))
      .toBe("plan-run-status-tasks");
    // non-path / non-md → null (caller keeps original title)
    expect(deriveDocsPathTitleFromExternalId("no-slash")).toBeNull();
    expect(deriveDocsPathTitleFromExternalId("workspace/page-id")).toBeNull();
    expect(deriveDocsPathTitleFromExternalId("")).toBeNull();
  });
});

describe("docs externalId derivation", () => {
  it("prefixes with the project key and normalizes separators to /", () => {
    const root = path.join(path.sep, "Users", "x", "proj", "pentou", "docs");
    const file = path.join(root, "guides", "a.md");
    expect(deriveDocExternalId("docs", root, file)).toBe("docs/guides/a.md");
  });

  it("produces the same key for a file at the registered root", () => {
    const root = path.join(path.sep, "tmp", "docs");
    expect(deriveDocExternalId("pentou", root, path.join(root, "README.md"))).toBe("pentou/README.md");
  });
});

describe("docs project mapping", () => {
  it("defaults the project key to the registered directory basename", () => {
    const root = tmpDir();
    const resolved = resolveDocsEntry({ path: root });
    expect(resolved.projectKey).toBe(path.basename(root));
    expect(resolved.root).toBe(path.resolve(root));
  });

  it("lets an explicit project override the directory name", () => {
    const root = tmpDir();
    expect(resolveDocsEntry({ path: root, project: "pentou" }).projectKey).toBe("pentou");
  });

  it("expands ~ to an absolute path", () => {
    expect(resolveDocsEntry({ path: "~/proj/pentou/docs" }).root)
      .toBe(path.join(os.homedir(), "proj", "pentou", "docs"));
  });

  it("carries only the project key — never a folder — at any nesting depth", async () => {
    const root = tmpDir();
    write(root, "README.md", "# R");
    write(root, "features/collector/spec.md", "# S");

    const shallow = await toDocumentItem(path.join(root, "README.md"), { path: root, project: "pentou" });
    const deep = await toDocumentItem(path.join(root, "features", "collector", "spec.md"), { path: root, project: "pentou" });

    for (const item of [shallow, deep]) {
      expect(item!.format).toBe("document");
      expect(item!.platform).toBe("docs");
      const data = item!.data as any;
      expect(data.project).toEqual({ key: "pentou", name: "pentou", rootPath: path.resolve(root) });
      expect(data.folder).toBeUndefined();
      expect(item).not.toHaveProperty("folder");
    }
    expect(shallow!.externalId).toBe("pentou/README.md");
    expect(deep!.externalId).toBe("pentou/features/collector/spec.md");
  });

  it("reports the registered directory's absolute path as rootPath", async () => {
    const root = tmpDir();
    write(root, "a.md", "# A");
    const item = await toDocumentItem(path.join(root, "a.md"), { path: root });
    expect((item!.data as any).project.rootPath).toBe(path.resolve(root));
  });

  it("returns null for non-md files and for paths inside skipped directories", async () => {
    const root = tmpDir();
    write(root, "a.txt", "text");
    write(root, "node_modules/pkg/README.md", "# Dep");
    expect(await toDocumentItem(path.join(root, "a.txt"), { path: root })).toBeNull();
    expect(await toDocumentItem(path.join(root, "node_modules", "pkg", "README.md"), { path: root })).toBeNull();
  });
});

describe("docs adapter", () => {
  it("discovers and converts through the shared scan module", async () => {
    const root = tmpDir();
    write(root, "guides/a.md", "---\ntitle: A\n---\n\nbody");
    const adapter = createDocsAdapter([{ path: root, project: "pentou" }]);

    expect(adapter.platform).toBe("docs");
    expect(adapter.watchRoots()).toEqual([path.resolve(root)]);

    const files = await adapter.discover();
    expect(files).toHaveLength(1);

    const item = await adapter.toItem(files[0].path);
    expect(item).toMatchObject({ platform: "docs", format: "document", externalId: "pentou/guides/a.md" });
    // frontmatter title "A" is ignored; path-composed title wins
    expect((item!.data as any).title).toBe("guides-a");
  });

  it("picks the most specific registered entry for nested registrations", async () => {
    const outer = tmpDir();
    const inner = path.join(outer, "docs");
    write(outer, "root.md", "# Root");
    write(outer, "docs/inner.md", "# Inner");
    const adapter = createDocsAdapter([
      { path: outer, project: "outer" },
      { path: inner, project: "inner" },
    ]);
    const rootItem = await adapter.toItem(path.join(outer, "root.md"));
    const innerItem = await adapter.toItem(path.join(inner, "inner.md"));
    expect(rootItem!.externalId).toBe("outer/root.md");
    expect(innerItem!.externalId).toBe("inner/inner.md");
  });

  it("ignores files outside every registered root", async () => {
    const root = tmpDir();
    const stranger = tmpDir();
    write(stranger, "a.md", "# A");
    const adapter = createDocsAdapter([{ path: root }]);
    expect(await adapter.toItem(path.join(stranger, "a.md"))).toBeNull();
  });
});

describe("docs adapter registration", () => {
  it("is not created when docs is disabled (nothing is scanned by default)", () => {
    const cfg = defaultConfig({ server: "http://x", token: "t" });
    expect(cfg.adapters.docs).toEqual({ enabled: false, dirs: [] });
    const adapters = createAdapters(cfg, () => {});
    expect(adapters.some((a) => a.platform === "docs")).toBe(false);
  });

  it("is created once docs is enabled with registered dirs", () => {
    const cfg = defaultConfig({
      server: "http://x",
      token: "t",
      adapters: { ...defaultConfig().adapters, docs: { enabled: true, dirs: [{ path: "/tmp/docs" }] } },
    });
    const adapters = createAdapters(cfg, () => {});
    expect(adapters.some((a) => a.platform === "docs")).toBe(true);
  });
});
