import React, { useState } from "react";
import { Button } from "@/components/ui/button";
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
        <Button type="button" variant="ghost" size="sm" onClick={handleCancel} disabled={saving}>
          {t("toolbar.cancel")}
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : t("toolbar.save")}
        </Button>
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
