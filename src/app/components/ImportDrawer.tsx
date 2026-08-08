import React, { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { Drawer, DrawerBackdrop, DrawerPopup, DrawerPortal } from "@/components/ui/drawer";
import {
  X,
  UploadCloud,
  CheckCircle2,
  Terminal,
  Loader2,
  FileJson,
  Link,
  Globe,
  FileText,
  AlertCircle,
  KeyRound,
  Trash2,
  ExternalLink,
  Puzzle,
} from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/IconTooltip";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAppContext, ImportSummary } from "../data";
import { parseFileContent, parseChatGPTExport } from "../parsers";
import { useTranslation, type TFunction } from "../i18n";
import { useScrollActivity } from "../hooks/useScrollActivity";
import { useIsMobile } from "../hooks/useIsMobile";
import { BottomSheet } from "./BottomSheet";

/** CLI 采集器已接入的桌面来源（不含需显式登记的 waylog） */
const CLI_COLLECTOR_PLATFORMS = [
  "Claude Code",
  "Codex",
  "Grok CLI",
  "Pi",
  "GitHub Copilot",
  "Copilot VS Code",
  "OpenCode",
  "Hermes",
  "Cursor",
] as const;

/** 浏览器插件 v1 支持平台 */
const BROWSER_EXT_PLATFORMS = ["ChatGPT", "DeepSeek"] as const;

/** Pentou Collector 在 Chrome 应用商店的详情页 */
const BROWSER_EXT_STORE_URL =
  "https://chromewebstore.google.com/detail/pentou-collector/kfepbkfbnminfhcenaookdnikccdfmip";

/** 公开分享链接当前已适配平台（与 vite-plugins/obscura.ts 拦截 / 解析分支对齐） */
const SHARE_LINK_PLATFORMS = [
  "ChatGPT",
  "DeepSeek",
  "Claude",
  "Gemini",
  "Grok",
  "Doubao",
  "Qianwen",
  "Metaso",
] as const;

function ScenarioCard({
  icon,
  iconClassName,
  title,
  children,
}: {
  icon: ReactNode;
  iconClassName: string;
  title: string;
  children: ReactNode;
}) {
  const { isScrolling, markScrollActive } = useScrollActivity();
  return (
    <div className="flex max-h-64 flex-col rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#222]">
      <div className="mb-3 flex shrink-0 items-center gap-3">
        <div className={clsx("rounded-lg p-2", iconClassName)}>{icon}</div>
        <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</h4>
      </div>
      <div
        className={clsx(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar subtle-scrollbar pr-1",
          isScrolling && "subtle-scrollbar-active",
        )}
        onScroll={markScrollActive}
      >
        {children}
      </div>
    </div>
  );
}

const ZIP_ASSET_TOKEN_PREFIX = "pentou-zip-asset://";
const ZIP_ASSET_TOKEN_RE = /!\[[^\]]*\]\(pentou-zip-asset:\/\/([^)\s]+)\)/g;

/**
 * ChatGPT 导出 ZIP 导入（spec media-assets US-04，决策 7：前端 fflate 解包）。
 * 1. 解包并解析 conversations.json；asset_pointer 先映射为 ZIP 内文件 token
 * 2. 仅上传被引用的图片（POST /api/assets 内容寻址去重），token 替换为 /api/assets/ URL
 * 3. 找不到文件 / 上传失败 → [图片缺失] 占位，对话其余内容正常入库（AC2）
 */
async function parseChatGPTZip(file: File, t: TFunction): Promise<any[]> {
  const { unzipSync } = await import("fflate");
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error(t("import.zipInvalid"));
  }

  const convKey = Object.keys(entries).find(
    (k) => k === "conversations.json" || k.endsWith("/conversations.json"),
  );
  if (!convKey) throw new Error(t("import.zipNoConversations"));

  let json: any;
  try {
    json = JSON.parse(new TextDecoder().decode(entries[convKey]));
  } catch {
    throw new Error(t("import.zipInvalid"));
  }

  // asset_pointer（file-service://file-XXX、sediment://file_XXX）→ ZIP 内文件名。
  // ChatGPT 导出文件名以指针 id 开头（含 - / _ 变体）；格式漂移集中在此函数兜底（spec §8 风险 3）。
  const fileEntryNames = Object.keys(entries).filter((name) => !name.endsWith("/"));
  const findEntryForPointer = (pointer: string): string | null => {
    const tail = pointer.split("://").pop() ?? "";
    const id = tail.split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
    if (!id) return null;
    const variants = [id, id.replace(/_/g, "-"), id.replace(/-/g, "_")];
    return (
      fileEntryNames.find((name) => {
        const base = name.split("/").pop()!.toLowerCase();
        return variants.some((v) => base.startsWith(v));
      }) ?? null
    );
  };

  const convs = parseChatGPTExport(json, {
    resolveAssetPointer: (pointer) => {
      const entry = findEntryForPointer(pointer);
      return entry ? `${ZIP_ASSET_TOKEN_PREFIX}${encodeURIComponent(entry)}` : null;
    },
  });

  // 上传被引用的图片，换取 /api/assets/ URL（同一文件只上传一次）
  const uploaded = new Map<string, string | null>();
  const uploadEntry = async (entryName: string): Promise<string | null> => {
    if (uploaded.has(entryName)) return uploaded.get(entryName)!;
    let url: string | null = null;
    try {
      const baseName = entryName.split("/").pop() || "image";
      const form = new FormData();
      form.append("file", new Blob([entries[entryName] as BlobPart]), baseName);
      const res = await fetch("/api/assets", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok && typeof data?.url === "string") url = data.url;
    } catch {
      /* 上传失败 → 占位 */
    }
    uploaded.set(entryName, url);
    return url;
  };

  for (const conv of convs) {
    for (const msg of conv.messages) {
      const matches = [...msg.content.matchAll(ZIP_ASSET_TOKEN_RE)];
      for (const m of matches) {
        const url = await uploadEntry(decodeURIComponent(m[1]));
        msg.content = msg.content.replace(
          m[0],
          url ? m[0].replace(`${ZIP_ASSET_TOKEN_PREFIX}${m[1]}`, url) : "[图片缺失]",
        );
      }
    }
  }

  return convs;
}

export function ImportDrawer() {
  const { isDrawerOpen, setDrawerOpen, addConversations, addDocuments, folders, activeView, setActiveView, setActiveDocId, setActiveConversationId, activeProjectId } = useAppContext();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { isScrolling: isDrawerScrolling, markScrollActive: markDrawerScrollActive } = useScrollActivity();

  // 首次滑入动画修复：App 用 `{drawerEverOpened && <ImportDrawer/>}` 门控，本组件
  // 首挂载时 isDrawerOpen 已为 true → 直接以打开态渲染，无过渡起始帧（闪现）。
  // 解法：本地 open 首帧为 false（关闭态先绘制一帧），下一帧再置真值 → 有可插值的 from。
  // 配合 DrawerPortal keepMounted（Popup 在那一关闭帧已挂载）。见 debug 2026-07-21。
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!isDrawerOpen) {
      setOpen(false);
      return;
    }
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, [isDrawerOpen]);

  // 导入完成后以非阻塞 toast 汇总「新建 / 并入 / 跳过」，并入项给出可点击定位入口（US-04）
  const showImportSummary = (summary: ImportSummary) => {
    const parts = [
      t("import.summary.created", { n: summary.created }),
      t("import.summary.merged", { n: summary.merged }),
      t("import.summary.skipped", { n: summary.skipped }),
    ];
    const firstMerged = summary.items.find((i) => i.action === "merged");
    toast.success(parts.join(" · "), {
      action: firstMerged
        ? {
            label: t("import.locate"),
            onClick: () => {
              setActiveView("chat");
              setActiveConversationId(firstMerged.id);
              setDrawerOpen(false);
            },
          }
        : undefined,
    });
    summary.items
      .filter((i) => i.action === "skipped")
      .forEach((i) => toast.info(t("import.summary.skippedToast", { title: i.title })));
  };
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleUrlImport = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!importUrl.trim()) return;
    
    setIsImporting(true);
    setError("");

    try {
      const res = await fetch("/api/import/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      const data = await res.json();
      
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to import from URL");
      }

      if (data.conversations && data.conversations.length > 0) {
        data.conversations.forEach((conv: any) => {
          const matchedFolder = folders.find(f => 
            f.name.toLowerCase() === conv.platform.toLowerCase() ||
            (f.platform && f.platform.toLowerCase() === conv.platform.toLowerCase())
          );
          if (matchedFolder) {
            conv.folderId = matchedFolder.id;
          }
        });
        const summary = await addConversations(data.conversations);
        showImportSummary(summary);
        setTimeout(() => setDrawerOpen(false), 500);
        setImportUrl("");
      } else {
        throw new Error("No conversations found at this URL");
      }
    } catch (err: any) {
      setError(err.message || "Failed to process URL");
    } finally {
      setIsImporting(false);
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsImporting(true);
    setError("");
    let totalImported = 0;

    try {
      let convsToImport = [];
      let fileError: Error | null = null;

      // Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          // ChatGPT 导出 ZIP（spec media-assets US-04）
          const parsedConvs = file.name.toLowerCase().endsWith(".zip")
            ? await parseChatGPTZip(file, t)
            : parseFileContent(file.name, await file.text());
          if (parsedConvs && parsedConvs.length > 0) {
            parsedConvs.forEach(conv => {
              const matchedFolder = folders.find(f => 
                f.name.toLowerCase() === conv.platform.toLowerCase() ||
                (f.platform && f.platform.toLowerCase() === conv.platform.toLowerCase())
              );
              if (matchedFolder) {
                conv.folderId = matchedFolder.id;
              }
            });
            convsToImport.push(...parsedConvs);
          }
        } catch (err: any) {
          console.warn(`Failed to parse file ${file.name}:`, err);
          if (!fileError) fileError = err;
        }
      }

      if (convsToImport.length === 0) {
        // 优先展示具体的文件级错误（如 ZIP 缺 conversations.json，US-04 AC3）
        throw fileError ?? new Error("No valid conversations found in the selected files.");
      }

      const summary = await addConversations(convsToImport);
      totalImported = convsToImport.length;
      showImportSummary(summary);

      // Close after a brief success delay
      setTimeout(() => {
        setDrawerOpen(false);
      }, 500);

    } catch (err: any) {
      setError(err.message || "Failed to process files");
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!isImporting && e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  }, [isImporting]);

  const isDocMode = activeView === "doc";
  const title = isDocMode ? t("import.titleDoc") : t("import.title");
  const subtitle = isDocMode ? t("import.subtitleDoc") : t("import.subtitle");

  // 移动端：底部抽屉（spec US-04）。对话页仅链接导入（隐藏 ZIP/文件上传与指引卡）；
  // 文档页保留文档上传 + MinerU 状态只读展示（隐藏 token 输入/保存/清除）。
  if (isMobile) {
    return (
      <BottomSheet
        open={isDrawerOpen}
        onClose={() => { if (!isImporting) setDrawerOpen(false); }}
        title={title}
        bodyClassName="px-4 pb-6"
      >
        <p className="pt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        {isDocMode ? (
          <div className="mt-4">
            <DocumentImportPanel
              mobile
              setDrawerOpen={setDrawerOpen}
              addDocuments={addDocuments}
              setActiveDocId={setActiveDocId}
              setActiveView={setActiveView}
              activeProjectId={activeProjectId}
              t={t}
            />
          </div>
        ) : (
          <form onSubmit={handleUrlImport} className="mt-4 space-y-3">
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center pl-3 text-muted-foreground">
                <Link size={16} />
              </div>
              <Input
                type="url"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder={t("import.urlPlaceholder")}
                disabled={isImporting}
                className="h-12 pl-9"
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={isImporting || !importUrl.trim()}
              className="h-12 w-full gap-2"
            >
              {isImporting ? <Loader2 className="animate-spin" /> : <Globe />}
              {t("import.fetchBtn")}
            </Button>
            <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">{t("import.urlNote")}</p>
            {error && (
              <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-500 dark:border-red-500/20 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}
          </form>
        )}
      </BottomSheet>
    );
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        if (isImporting) return; // 导入进行中禁止关闭（外点 / Escape 均拦截）
        setDrawerOpen(false);
      }}
    >
      {/* keepMounted：Popup 在关闭帧即挂载(左移出屏)，配合上面的延迟 open 让首次打开也有滑入起始帧 */}
      <DrawerPortal keepMounted>
        <DrawerBackdrop />
        <DrawerPopup side="left" className="max-w-2xl">
            <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-white/10 shrink-0 bg-zinc-50/50 dark:bg-[#1A1A1A]/50">
              <div>
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                  <UploadCloud size={22} className="text-muted-foreground" />
                  {title}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{subtitle}</p>
              </div>
              <IconTooltip label={t("toolbar.close")}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => !isImporting && setDrawerOpen(false)}
                  disabled={isImporting}
                  className="size-9 text-zinc-500"
                >
                  <X size={20} />
                </Button>
              </IconTooltip>
            </div>

            <div
              className={clsx(
                "flex-1 overflow-y-auto overscroll-contain p-6 space-y-8 pb-12 custom-scrollbar subtle-scrollbar",
                isDrawerScrolling && "subtle-scrollbar-active",
              )}
              onScroll={markDrawerScrollActive}
            >
              {isDocMode ? (
                <DocumentImportPanel setDrawerOpen={setDrawerOpen} addDocuments={addDocuments} setActiveDocId={setActiveDocId} setActiveView={setActiveView} activeProjectId={activeProjectId} t={t} />
              ) : (
              <>
              {/* Smart Upload Zone */}
              <div>
                <div 
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  onClick={() => !isImporting && fileInputRef.current?.click()}
                  className={clsx(
                    "border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center transition-all group mt-2 relative overflow-hidden",
                    isImporting ? "opacity-50 border-zinc-300 dark:border-white/20 bg-zinc-50 dark:bg-[#1A1A1A]/50" : 
                    isDragging ? "border-foreground bg-accent scale-[1.02]" :
                    "border-zinc-300 dark:border-white/20 bg-zinc-50 dark:bg-[#1A1A1A]/50 hover:bg-zinc-100 dark:hover:bg-white/5 cursor-pointer hover:border-zinc-400 dark:hover:border-white/30"
                  )}
                >
                  <input type="file" multiple accept=".json,.jsonl,.md,.txt,.zip" className="hidden" ref={fileInputRef} onChange={(e) => {
                    if (e.target.files) handleFiles(e.target.files);
                  }} />
                  
                  <div className={clsx(
                    "w-16 h-16 rounded-full flex items-center justify-center shadow-sm mb-4 transition-all duration-300",
                    isDragging ? "bg-primary text-primary-foreground scale-110" : "bg-white dark:bg-[#2A2A2A] text-zinc-400 group-hover:text-foreground"
                  )}>
                    {isImporting ? <Loader2 size={32} className="animate-spin" /> : <UploadCloud size={32} />}
                  </div>
                  
                  <p className="text-lg font-medium text-zinc-800 dark:text-zinc-200 mb-2">
                    {isImporting ? t("import.importing") : t("import.clickOrDrag")}
                  </p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center max-w-md">
                    {t("import.formats")} <br/> <strong>.json, .jsonl, .md, .txt, .zip</strong>
                  </p>
                </div>
                {error && <div className="text-sm font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-md mt-4 border border-red-100 dark:border-red-500/20">{error}</div>}
              </div>

              {/* URL Import Zone */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-3 px-1 uppercase tracking-wider">
                  {t("import.fromUrl")}
                </h3>
                <form onSubmit={handleUrlImport} className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center pl-3 text-muted-foreground">
                      <Link size={16} />
                    </div>
                    <Input
                      type="url"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      placeholder={t("import.urlPlaceholder")}
                      disabled={isImporting}
                      className="h-10 pl-9"
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={isImporting || !importUrl.trim()}
                  >
                    {isImporting ? <Loader2 className="animate-spin" /> : <Globe />}
                    {t("import.fetchBtn")}
                  </Button>
                </form>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 px-1">
                  {t("import.urlNote")}
                </p>
              </div>

              {/* Guide Cards */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-4 px-1 uppercase tracking-wider">
                  {t("import.supported")}
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ScenarioCard
                    icon={<FileJson size={20} />}
                    iconClassName="bg-muted text-muted-foreground"
                    title={t("import.platformExports")}
                  >
                    <p className="mb-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {t("import.platformDesc")}{" "}
                      <strong className="text-zinc-700 dark:text-zinc-300">ChatGPT</strong>{" "}
                      {t("import.or")}{" "}
                      <strong className="text-zinc-700 dark:text-zinc-300">DeepSeek</strong>.
                    </p>
                    <ul className="list-disc space-y-1.5 pl-4 text-xs text-zinc-600 marker:text-zinc-300 dark:text-zinc-400 dark:marker:text-zinc-600">
                      <li>{t("import.platformStep1")}</li>
                      <li>
                        {t("import.platformStep2")}{" "}
                        <code className="rounded bg-zinc-100 px-1 dark:bg-white/10">conversations.json</code>.
                      </li>
                      <li>
                        {t("import.platformStep3")}{" "}
                        <code className="rounded bg-zinc-100 px-1 dark:bg-white/10">ai-chat-md-export</code>{" "}
                        {t("import.andUpload")}
                      </li>
                    </ul>
                  </ScenarioCard>

                  <ScenarioCard
                    icon={<Globe size={20} />}
                    iconClassName="bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400"
                    title={t("import.sharedLinks")}
                  >
                    <p className="mb-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {t("import.sharedLinksDesc")}
                    </p>
                    <p className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {t("import.platformsLabel")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {SHARE_LINK_PLATFORMS.map((name) => (
                        <span
                          key={name}
                          className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  </ScenarioCard>

                  <ScenarioCard
                    icon={<Terminal size={20} />}
                    iconClassName="bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400"
                    title={t("import.cliCollector")}
                  >
                    <p className="mb-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {t("import.cliCollectorDesc")}
                    </p>
                    <p className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {t("import.platformsLabel")}
                    </p>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {CLI_COLLECTOR_PLATFORMS.map((name) => (
                        <span
                          key={name}
                          className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                    <ul className="list-disc space-y-1.5 pl-4 text-xs text-zinc-600 marker:text-zinc-300 dark:text-zinc-400 dark:marker:text-zinc-600">
                      <li>{t("import.cliCollectorStep1")}</li>
                      <li>
                        {t("import.cliCollectorStep2")}{" "}
                        <code className="rounded bg-zinc-100 px-1 dark:bg-white/10">npx -y @startist/pentou collect init</code>
                      </li>
                      <li>
                        {t("import.cliCollectorStep3")}{" "}
                        <code className="rounded bg-zinc-100 px-1 dark:bg-white/10">collect pull</code>
                        {" / "}
                        <code className="rounded bg-zinc-100 px-1 dark:bg-white/10">collect watch</code>
                      </li>
                    </ul>
                  </ScenarioCard>

                  <ScenarioCard
                    icon={<Puzzle size={20} />}
                    iconClassName="bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"
                    title={t("import.browserExt")}
                  >
                    <p className="mb-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {t("import.browserExtDesc")}
                    </p>
                    <p className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {t("import.platformsLabel")}
                    </p>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {BROWSER_EXT_PLATFORMS.map((name) => (
                        <span
                          key={name}
                          className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                    <ul className="list-disc space-y-1.5 pl-4 text-xs text-zinc-600 marker:text-zinc-300 dark:text-zinc-400 dark:marker:text-zinc-600">
                      <li>
                        {t("import.browserExtStep1")}{" "}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto gap-1 p-0 text-xs font-medium text-foreground underline underline-offset-2 hover:bg-transparent"
                          nativeButton={false}
                          render={<a href={BROWSER_EXT_STORE_URL} target="_blank" rel="noreferrer" />}
                        >
                          {t("import.browserExtStoreLink")}
                          <ExternalLink size={11} />
                        </Button>{" "}
                        {t("import.browserExtStep1Tail")}
                      </li>
                      <li>{t("import.browserExtStep2")}</li>
                      <li>{t("import.browserExtStep3")}</li>
                    </ul>
                  </ScenarioCard>
                </div>
              </div>
              </>
              )}
            </div>
        </DrawerPopup>
      </DrawerPortal>
    </Drawer>
  );
}

const SUPPORTED_DOC_EXTS = [
  ".md", ".txt", ".json", ".csv", ".xml",
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".html",
  ".png", ".jpg", ".jpeg", ".jp2", ".webp", ".gif", ".bmp",
];

function DocumentImportPanel({ setDrawerOpen, addDocuments, setActiveDocId, setActiveView, activeProjectId, t, mobile }: any) {
  const [status, setStatus] = useState<any>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const checkStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/mineru/status");
      const data = await r.json();
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => { checkStatus(); }, []);

  const saveToken = async () => {
    setSavingToken(true);
    try {
      const r = await fetch("/api/mineru/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiToken: tokenInput }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to save MinerU token");
      setStatus(data);
      setTokenInput("");
      toast.success(t("import.doc.tokenSaved"));
    } catch (e: any) {
      toast.error(e.message || String(e));
    } finally {
      setSavingToken(false);
    }
  };

  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const doClearToken = async () => {
    setSavingToken(true);
    try {
      const r = await fetch("/api/mineru/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to clear MinerU token");
      setStatus(data);
      setTokenInput("");
      toast.success(t("import.doc.tokenCleared"));
    } catch (e: any) {
      toast.error(e.message || String(e));
    } finally {
      setSavingToken(false);
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setResults([]);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) formData.append("files", files[i]);
      // 在当前项目目录导入时自动归属该项目（默认目录不传，落盘无 projectId）
      if (activeProjectId) formData.append("projectId", activeProjectId);
      const r = await fetch("/api/import/document", { method: "POST", body: formData });
      const data = await r.json();
      setResults(data.results ?? []);
      const successDocs = (data.results ?? []).filter((x: any) => x.success && x.document);
      if (successDocs.length > 0) {
        await addDocuments(successDocs.map((x: any) => x.document));
        setActiveView("doc");
        setActiveDocId(successDocs[0].document.id);
        setTimeout(() => setDrawerOpen(false), 800);
      }
    } catch (e: any) {
      setResults([{ success: false, error: String(e) }]);
    } finally {
      setUploading(false);
    }
  };

  const configured = !!status?.configured;
  const tokenPlaceholder = configured ? "••••••" : t("import.doc.tokenPlaceholder");

  const statusColor = configured
    ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20"
    : "text-destructive bg-destructive/10 border-destructive/20";

  return (
    <div className="space-y-6">
      {/* MinerU token */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
            {t("import.doc.mineruConfig")}
          </h3>
        </div>
        <div className={clsx("flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium", statusColor)}>
          {configured ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span>{configured ? t("import.doc.mineruConfigured") : t("import.doc.mineruMissing")}</span>
        </div>
        {/* 移动端只读：不提供 token 输入/保存/清除；未配置时提示到桌面端配置（spec US-04 AC3）。 */}
        {mobile ? (
          !configured && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t("import.doc.mineruDesktopOnly")}</p>
          )
        ) : (
        <div className="mt-3 space-y-3">
          {!configured && (
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <li>
                {t("import.doc.guideRegister")}{" "}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto gap-1 p-0 text-xs font-medium text-foreground underline underline-offset-2 hover:bg-transparent"
                  nativeButton={false}
                  render={<a href="https://mineru.net" target="_blank" rel="noreferrer" />}
                >
                  mineru.net
                  <ExternalLink size={11} />
                </Button>
              </li>
              <li>{t("import.doc.guideApply")}</li>
              <li>{t("import.doc.guidePaste")}</li>
            </ol>
          )}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                type="password"
                placeholder={tokenPlaceholder}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#1A1A1A] text-sm text-zinc-800 dark:text-zinc-100 outline-none focus:border-ring"
              />
            </div>
            <Button type="button" variant="primary" size="sm" onClick={saveToken} disabled={savingToken}>
              {savingToken ? t("import.doc.saving") : t("import.doc.saveToken")}
            </Button>
            {configured && (
              <IconTooltip label={t("import.doc.clearToken")}>
                <Button
                  type="button"
                  variant="danger"
                  size="icon"
                  onClick={() => setClearConfirmOpen(true)}
                  disabled={savingToken}
                >
                  <Trash2 size={16} />
                </Button>
              </IconTooltip>
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("import.doc.privacyNote")}</p>
          <ConfirmDialog
            open={clearConfirmOpen}
            onOpenChange={setClearConfirmOpen}
            title={t("import.doc.clearToken")}
            description={t("import.doc.clearConfirm")}
            confirmLabel={t("import.doc.clearToken")}
            cancelLabel={t("toolbar.cancel")}
            confirmVariant="danger"
            onConfirm={() => { void doClearToken(); }}
          />
        </div>
        )}
      </div>

      {/* Upload zone */}
      <div>
        <div
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={clsx(
            "border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center transition-all cursor-pointer",
            uploading
              ? "border-zinc-300 dark:border-white/20 bg-zinc-50 dark:bg-[#1A1A1A]/50 opacity-60"
              : "border-zinc-300 dark:border-white/20 bg-zinc-50 dark:bg-[#1A1A1A]/50 hover:border-foreground/40 hover:bg-zinc-100 dark:hover:bg-white/5"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={SUPPORTED_DOC_EXTS.join(",")}
            className="hidden"
            onChange={(e) => { if (e.target.files) handleFiles(e.target.files); }}
          />
          <div className="w-14 h-14 rounded-full bg-white dark:bg-[#2A2A2A] flex items-center justify-center text-zinc-400 mb-4">
            {uploading ? <Loader2 size={28} className="animate-spin" /> : <FileText size={28} />}
          </div>
          <p className="text-base font-medium text-zinc-700 dark:text-zinc-300">
            {uploading ? t("import.doc.uploading") : t("import.doc.uploadBtn")}
          </p>
          <p className="text-xs text-zinc-400 mt-1">{t("import.clickOrDrag")}</p>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {results.map((r: any, i: number) => (
              <div key={i} className={clsx("flex items-center gap-2 text-xs px-3 py-2 rounded-lg border", r.success ? "border-green-200 dark:border-green-500/20 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-500/10" : "border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10")}>
                {r.success ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                <span className="flex-1 truncate">{r.document?.title ?? r.originalName ?? r.savedName ?? r.fileName ?? r.error ?? "Unknown"}</span>
                {r.success && r.action && r.action !== "created" && (
                  <span className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-white/60 dark:bg-white/10 font-medium">
                    {t(`import.summary.${r.action}`, { n: 1 })}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Supported formats */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider mb-2">
          {t("import.doc.supportedFormats")}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {SUPPORTED_DOC_EXTS.map((ext) => (
            <span key={ext} className="px-2 py-0.5 rounded text-xs font-mono bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-400">
              {ext}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
