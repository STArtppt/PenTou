import React, { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  UploadCloud,
  CheckCircle2,
  Terminal,
  Loader2,
  FileJson,
  Code2,
  Laptop,
  Link,
  Globe,
  FileText,
  AlertCircle,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";
import clsx from "clsx";
import { copyText } from "../utils/clipboard";
import { useAppContext } from "../data";
import { parseFileContent } from "../parsers";
import { useTranslation } from "../i18n";

export function ImportDrawer() {
  const { isDrawerOpen, setDrawerOpen, addConversations, addDocuments, folders, activeView, setActiveView, setActiveDocId } = useAppContext();
  const { t } = useTranslation();
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
        await addConversations(data.conversations);
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

      // Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const text = await file.text();
          const parsedConvs = parseFileContent(file.name, text);
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
        }
      }

      if (convsToImport.length === 0) {
        throw new Error("No valid conversations found in the selected files.");
      }

      await addConversations(convsToImport);
      totalImported = convsToImport.length;
      
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

  return (
    <AnimatePresence>
      {isDrawerOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !isImporting && setDrawerOpen(false)}
            className="fixed inset-0 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm z-40"
          />

          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed left-0 top-0 bottom-0 w-full max-w-2xl bg-white dark:bg-[#151515] shadow-2xl z-50 flex flex-col border-r border-zinc-200 dark:border-white/10"
          >
            <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-white/10 shrink-0 bg-zinc-50/50 dark:bg-[#1A1A1A]/50">
              <div>
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                  <UploadCloud size={22} className="text-orange-500 dark:text-yellow-400" />
                  {title}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{subtitle}</p>
              </div>
              <button
                onClick={() => !isImporting && setDrawerOpen(false)}
                disabled={isImporting}
                className="p-2 rounded-md hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-500 transition-colors disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-12 custom-scrollbar">
              {isDocMode ? (
                <DocumentImportPanel setDrawerOpen={setDrawerOpen} addDocuments={addDocuments} setActiveDocId={setActiveDocId} setActiveView={setActiveView} t={t} />
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
                    isDragging ? "border-orange-500 dark:border-yellow-400 bg-orange-50 dark:bg-yellow-400/10 scale-[1.02]" :
                    "border-zinc-300 dark:border-white/20 bg-zinc-50 dark:bg-[#1A1A1A]/50 hover:bg-zinc-100 dark:hover:bg-white/5 cursor-pointer hover:border-zinc-400 dark:hover:border-white/30"
                  )}
                >
                  <input type="file" multiple accept=".json,.jsonl,.md,.txt" className="hidden" ref={fileInputRef} onChange={(e) => {
                    if (e.target.files) handleFiles(e.target.files);
                  }} />
                  
                  <div className={clsx(
                    "w-16 h-16 rounded-full flex items-center justify-center shadow-sm mb-4 transition-all duration-300",
                    isDragging ? "bg-orange-500 dark:bg-yellow-400 text-white dark:text-zinc-900 scale-110" : "bg-white dark:bg-[#2A2A2A] text-zinc-400 group-hover:text-orange-500 dark:group-hover:text-yellow-400"
                  )}>
                    {isImporting ? <Loader2 size={32} className="animate-spin" /> : <UploadCloud size={32} />}
                  </div>
                  
                  <p className="text-lg font-medium text-zinc-800 dark:text-zinc-200 mb-2">
                    {isImporting ? t("import.importing") : t("import.clickOrDrag")}
                  </p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center max-w-md">
                    {t("import.formats")} <br/> <strong>.json, .jsonl, .md, .txt</strong>
                  </p>
                </div>
                {error && <div className="text-sm font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-md mt-4 border border-red-100 dark:border-red-500/20">{error}</div>}
              </div>

              {/* URL Import Zone */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-3 px-1 uppercase tracking-wider">
                  {t("import.fromUrl")}
                </h3>
                <form onSubmit={handleUrlImport} className="flex gap-2">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                      <Link size={18} />
                    </div>
                    <input
                      type="url"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      placeholder={t("import.urlPlaceholder")}
                      disabled={isImporting}
                      className="w-full pl-10 pr-4 py-3 bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50 dark:focus:ring-yellow-400/50 text-zinc-900 dark:text-white placeholder:text-zinc-400 disabled:opacity-50 transition-all"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isImporting || !importUrl.trim()}
                    className="px-6 py-3 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-sm font-medium rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 whitespace-nowrap"
                  >
                    {isImporting ? <Loader2 size={18} className="animate-spin" /> : <Globe size={18} />}
                    {t("import.fetchBtn")}
                  </button>
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
                
                {/* Responsive Grid for Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* Card 1: Platform Exports */}
                  <div className="bg-white dark:bg-[#222] border border-zinc-200 dark:border-white/10 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded-lg">
                        <FileJson size={20} />
                      </div>
                      <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">{t("import.platformExports")}</h4>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mb-3">
                      {t("import.platformDesc")} <strong className="text-zinc-700 dark:text-zinc-300">ChatGPT</strong> {t("import.or")} <strong className="text-zinc-700 dark:text-zinc-300">DeepSeek</strong>.
                    </p>
                    <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5 list-disc pl-4 marker:text-zinc-300 dark:marker:text-zinc-600">
                      <li>{t("import.platformStep1")}</li>
                      <li>{t("import.platformStep2")} <code className="bg-zinc-100 dark:bg-white/10 px-1 rounded">conversations.json</code>.</li>
                      <li>{t("import.platformStep3")} <code className="bg-zinc-100 dark:bg-white/10 px-1 rounded">ai-chat-md-export</code> {t("import.andUpload")}</li>
                    </ul>
                  </div>

                  {/* Card: Shared Links (NEW) */}
                  <div className="bg-white dark:bg-[#222] border border-zinc-200 dark:border-white/10 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 rounded-lg">
                        <Globe size={20} />
                      </div>
                      <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">{t("import.sharedLinks")}</h4>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mb-3">
                      {t("import.sharedLinksDesc")}
                    </p>
                    <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5 list-disc pl-4 marker:text-zinc-300 dark:marker:text-zinc-600">
                      <li>{t("import.sharedLinksStep1")}</li>
                      <li>{t("import.sharedLinksStep2")}</li>
                    </ul>
                  </div>

                  {/* Card 2: IDE Logs */}
                  <div className="bg-white dark:bg-[#222] border border-zinc-200 dark:border-white/10 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-lg">
                        <Code2 size={20} />
                      </div>
                      <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">{t("import.ideLogs")}</h4>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mb-3">
                      {t("import.ideDesc")} <strong className="text-zinc-700 dark:text-zinc-300">WayLog</strong> for Cursor, Copilot, or RooCode.
                    </p>
                    <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5 list-disc pl-4 marker:text-zinc-300 dark:marker:text-zinc-600">
                      <li>{t("import.ideStep1")} <code className="bg-zinc-100 dark:bg-white/10 px-1 rounded">.waylog/history/</code> {t("import.directory")}</li>
                      <li>{t("import.ideStep2")} <code className="bg-zinc-100 dark:bg-white/10 px-1 rounded">.md</code> {t("import.filesAtOnce")}</li>
                      <li>{t("import.ideStep3")}</li>
                    </ul>
                  </div>

                  {/* Card 3: CLI Logs */}
                  <div className="bg-white dark:bg-[#222] border border-zinc-200 dark:border-white/10 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400 rounded-lg">
                        <Terminal size={20} />
                      </div>
                      <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">{t("import.cliLogs")}</h4>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mb-3">
                      {t("import.cliDesc")}
                    </p>
                    <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5 list-disc pl-4 marker:text-zinc-300 dark:marker:text-zinc-600">
                      <li>{t("import.cliStep1")} <code className="bg-zinc-100 dark:bg-white/10 px-1 rounded">waylog-cli</code> {t("import.cliStep2")}</li>
                      <li>{t("import.cliStep1")} <code className="bg-zinc-100 dark:bg-white/10 px-1 rounded">Claude Code</code> {t("import.cliStep3")}</li>
                    </ul>
                  </div>

                </div>
              </div>
              </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const SUPPORTED_DOC_EXTS = [".md", ".txt", ".pdf", ".docx", ".pptx", ".xlsx", ".csv", ".json", ".html", ".xml"];
const BASIC_EXTS = [".md", ".txt", ".json"];

function DocumentImportPanel({ setDrawerOpen, addDocuments, setActiveDocId, setActiveView, t }: any) {
  const [status, setStatus] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const r = await fetch("/api/markitdown/status");
      const data = await r.json();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { checkStatus(); }, []);

  const handleFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setResults([]);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) formData.append("files", files[i]);
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

  const copyHint = async (hint: string, idx: number) => {
    await copyText(hint);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const statusLabel = !status
    ? t("import.doc.notInstalled")
    : status.installed
    ? t("import.doc.installed")
    : status.error?.includes("Python") && status.error?.includes("3.10")
    ? t("import.doc.pythonOld")
    : status.installHints?.length > 0
    ? t("import.doc.notInstalled")
    : t("import.doc.partialDeps");

  const statusColor = status?.installed
    ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20"
    : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-400/20";

  const supportedExts = status?.installed ? SUPPORTED_DOC_EXTS : BASIC_EXTS;

  return (
    <div className="space-y-6">
      {/* Env check */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
            {t("import.doc.envCheck")}
          </h3>
          <button
            onClick={checkStatus}
            disabled={checking}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={checking ? "animate-spin" : ""} />
            {t("import.doc.recheck")}
          </button>
        </div>
        <div className={clsx("flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium", statusColor)}>
          {status?.installed ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span>markitdown — {statusLabel}</span>
          {status?.version && <span className="text-xs font-normal opacity-70 ml-1">({status.version})</span>}
        </div>
        {status && !status.installed && status.error && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">{status.error}</p>
        )}
      </div>

      {/* Fix guide */}
      {status && !status.installed && status.installHints?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider mb-2">
            {t("import.doc.fixGuide")}
          </h3>
          <div className="space-y-2">
            {status.installHints.map((hint: string, i: number) => (
              <div key={i} className="flex items-center gap-2 bg-zinc-900 dark:bg-[#111] rounded-lg px-3 py-2 font-mono text-xs text-zinc-300">
                <code className="flex-1 break-all">{hint}</code>
                <button
                  onClick={() => copyHint(hint, i)}
                  className="shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
                >
                  {copiedIdx === i ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload zone */}
      <div>
        <div
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={clsx(
            "border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center transition-all cursor-pointer",
            uploading
              ? "border-zinc-300 dark:border-white/20 bg-zinc-50 dark:bg-[#1A1A1A]/50 opacity-60"
              : "border-zinc-300 dark:border-white/20 bg-zinc-50 dark:bg-[#1A1A1A]/50 hover:border-orange-400 dark:hover:border-yellow-400 hover:bg-zinc-100 dark:hover:bg-white/5"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={supportedExts.join(",")}
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
                <span>{r.savedName ?? r.fileName ?? r.error ?? "Unknown"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Supported formats */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider mb-2">
          {status?.installed ? t("import.doc.supportedFull") : t("import.doc.supportedBasic")}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {supportedExts.map((ext) => (
            <span key={ext} className="px-2 py-0.5 rounded text-xs font-mono bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-400">
              {ext}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
