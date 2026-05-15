import React, { useState } from "react";
import { X, Sparkles, Loader2 } from "lucide-react";
import { useAppContext, Document, Annotation } from "../data";
import { buildRewritePrompt, rewriteByAnnotations, LLMError } from "../llm";
import { relocateAnnotations } from "../annotations";
import { useTranslation } from "../i18n";

interface Props {
  doc: Document;
  annotations: Annotation[];
  onClose: () => void;
  onSuccess: () => void;
}

export function RewriteConfirmDialog({ doc, annotations, onClose, onSuccess }: Props) {
  const { llmConfig, commitVersion, setAnnotationsForDoc, annotationsByDoc } = useAppContext();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [streamedChars, setStreamedChars] = useState(0);

  const allDocAnnotations = annotationsByDoc[doc.id] ?? [];
  const prompt = buildRewritePrompt(doc, annotations);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await commitVersion(doc.id, doc.body, "pre-llm-rewrite");

      let newBody = "";
      await rewriteByAnnotations(doc, annotations, llmConfig, (chunk) => {
        newBody += chunk;
        setStreamedChars(newBody.length);
      });

      await commitVersion(doc.id, newBody, "llm-rewrite", annotations.map((a) => a.id));

      const relocated = relocateAnnotations(allDocAnnotations, doc.body, newBody);
      await setAnnotationsForDoc(doc.id, relocated);

      onSuccess();
    } catch (e: any) {
      const msg = e instanceof LLMError
        ? `LLM Error ${e.context.status}: ${e.message}`
        : String(e);
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm"
        onClick={() => !loading && onClose()}
      />
      <div className="relative w-full max-w-lg bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-2xl rounded-xl p-6 z-10">
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute right-4 top-4 p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-50 transition-colors"
        >
          <X size={18} />
        </button>

        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-2 flex items-center gap-2">
          <Sparkles size={16} className="text-orange-500 dark:text-yellow-400" />
          {t("rewrite.title", { n: annotations.length })}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{t("rewrite.desc")}</p>

        <button
          onClick={() => setShowPrompt(!showPrompt)}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 mb-2 transition-colors underline-offset-2 underline"
        >
          {t("rewrite.showPrompt", { n: prompt.length })}
        </button>
        {showPrompt && (
          <pre className="text-xs bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg p-3 max-h-40 overflow-auto mb-4 whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300 custom-scrollbar">
            {prompt}
          </pre>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            <Loader2 size={12} className="animate-spin" />
            <span>{streamedChars > 0 ? `${streamedChars} chars received...` : "Connecting to LLM..."}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
          >
            {t("rewrite.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="px-4 py-1.5 text-sm font-medium bg-orange-500 dark:bg-yellow-400 text-white dark:text-zinc-900 hover:bg-orange-600 dark:hover:bg-yellow-500 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {t("rewrite.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
