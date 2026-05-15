import React, { useState } from "react";
import { useAppContext } from "../data";
import { useTranslation } from "../i18n";

interface Props {
  docId: string;
  body: string;
  onClose: () => void;
}

export function DocEditor({ docId, body, onClose }: Props) {
  const { saveDocumentBody, setEditMode } = useAppContext();
  const { t } = useTranslation();
  const [draft, setDraft] = useState(body);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (draft !== body) {
        await saveDocumentBody(docId, draft);
      }
      setEditMode("off");
      onClose();
    } catch (e: any) {
      alert(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditMode("off");
    onClose();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-end gap-2 px-6 py-2.5 border-b border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#151515]">
        <button
          onClick={handleCancel}
          disabled={saving}
          className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-md transition-colors disabled:opacity-50"
        >
          {t("toolbar.cancel")}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-xs font-medium bg-orange-500 dark:bg-yellow-400 text-white dark:text-zinc-900 hover:bg-orange-600 dark:hover:bg-yellow-500 rounded-md transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : t("toolbar.save")}
        </button>
      </div>
      <textarea
        className="flex-1 px-10 py-8 font-mono text-sm bg-white dark:bg-[#1A1A1A] text-zinc-800 dark:text-zinc-200 outline-none resize-none leading-7 custom-scrollbar"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        spellCheck={false}
      />
    </div>
  );
}
