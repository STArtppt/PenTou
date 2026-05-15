import React, { useEffect, useState } from "react";
import { FileText, EyeOff, List } from "lucide-react";
import clsx from "clsx";
import { useAppContext } from "../data";
import { useTranslation } from "../i18n";
import { extractHeadings } from "../doc-utils";
import { DocViewer } from "./DocViewer";
import { DocEditor } from "./DocEditor";
import { VersionPanel } from "./VersionPanel";

export function DocBody() {
  const {
    activeDocId,
    documents,
    annotationsByDoc,
    versionsByDoc,
    loadAnnotations,
    editMode,
    previewingVersionId,
    setPreviewingVersionId,
  } = useAppContext();
  const { t } = useTranslation();

  const activeDoc = documents.find((d) => d.id === activeDocId);
  const [previewBody, setPreviewBody] = useState<string | null>(null);

  // Load annotations when doc changes
  useEffect(() => {
    if (activeDocId && !annotationsByDoc[activeDocId]) {
      loadAnnotations(activeDocId);
    }
  }, [activeDocId]);

  // Fetch version body when previewing
  useEffect(() => {
    if (!previewingVersionId || !activeDocId) {
      setPreviewBody(null);
      return;
    }
    fetch(`/api/documents/${activeDocId}/versions/${previewingVersionId}`)
      .then((r) => r.json())
      .then((data) => setPreviewBody(data.body ?? null))
      .catch(() => setPreviewBody(null));
  }, [previewingVersionId, activeDocId]);

  if (!activeDoc) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-[#1A1A1A] text-zinc-400 min-w-0">
        <FileText size={48} className="mb-4 opacity-30" />
        <h2 className="text-xl font-semibold mb-2 text-zinc-600 dark:text-zinc-300">{t("doc.empty")}</h2>
        <p className="text-sm">{t("doc.selectDoc")}</p>
      </div>
    );
  }

  const displayBody = previewingVersionId ? (previewBody ?? activeDoc.body) : activeDoc.body;
  const docAnnotations = annotationsByDoc[activeDoc.id] ?? [];
  const headings = extractHeadings(displayBody);
  const previewVersionNum = previewingVersionId
    ? (versionsByDoc[activeDoc.id] ?? []).find((v) => v.id === previewingVersionId)?.version ?? "?"
    : null;

  return (
    <div className="flex-1 flex bg-zinc-50 dark:bg-[#151515] relative overflow-hidden min-w-0">
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {previewingVersionId && (
          <div className="shrink-0 flex items-center gap-2 px-6 py-2 bg-blue-50 dark:bg-blue-500/10 border-b border-blue-200 dark:border-blue-500/20 text-xs text-blue-700 dark:text-blue-300">
            <span className="flex-1">
              {t("doc.previewBanner", { n: previewVersionNum ?? "..." })}
            </span>
            <button
              onClick={() => setPreviewingVersionId(null)}
              className="flex items-center gap-1 hover:underline font-medium"
            >
              <EyeOff size={12} /> {t("doc.stopPreview")}
            </button>
          </div>
        )}

        {editMode === "edit" ? (
          <DocEditor
            docId={activeDoc.id}
            body={activeDoc.body}
            onClose={() => {}}
          />
        ) : (
          <DocViewer
            docId={activeDoc.id}
            body={displayBody}
            annotations={docAnnotations}
            annotateMode={editMode === "annotate" && !previewingVersionId}
          />
        )}
      </div>



      <VersionPanel />
    </div>
  );
}

