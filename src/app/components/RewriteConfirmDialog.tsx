import React, { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <Dialog
      open
      disablePointerDismissal={loading}
      onOpenChange={(next) => {
        if (!next && !loading) onClose();
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={16} className="text-muted-foreground" />
              {t("rewrite.title", { n: annotations.length })}
            </DialogTitle>
            <DialogDescription>{t("rewrite.desc")}</DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-3">
            <button
              type="button"
              onClick={() => setShowPrompt(!showPrompt)}
              className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
            >
              {t("rewrite.showPrompt", { n: prompt.length })}
            </button>
            {showPrompt && (
              <pre className="custom-scrollbar max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">
                {prompt}
              </pre>
            )}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" />
                <span>
                  {streamedChars > 0
                    ? `${streamedChars} chars received...`
                    : "Connecting to LLM..."}
                </span>
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="sm" disabled={loading} />}>
              {t("rewrite.cancel")}
            </DialogClose>
            <Button type="button" variant="primary" size="sm" onClick={handleConfirm} disabled={loading}>
              {loading && <Loader2 size={14} className="animate-spin" />}
              {t("rewrite.confirm")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
