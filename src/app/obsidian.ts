import type { Document, ObsidianConfig } from "./data";
import { copyText } from "./utils/clipboard";

export const OBSIDIAN_URI_SAFE_LIMIT = 8000;

export function buildObsidianUri(doc: Document, cfg: ObsidianConfig): string {
  return (
    `obsidian://new?vault=${encodeURIComponent(cfg.vaultName)}` +
    `&name=${encodeURIComponent(doc.title)}` +
    `&content=${encodeURIComponent(doc.body)}`
  );
}

export async function exportToObsidian(
  doc: Document,
  cfg: ObsidianConfig,
): Promise<{ mode: "uri" | "clipboard"; charCount?: number }> {
  if (!cfg.vaultName) {
    throw new Error("Vault name not configured");
  }

  const uri = buildObsidianUri(doc, cfg);

  if (uri.length > OBSIDIAN_URI_SAFE_LIMIT) {
    const ok = await copyText(doc.body);
    if (!ok) throw new Error("Copy to clipboard failed");
    return { mode: "clipboard", charCount: doc.body.length };
  }

  window.open(uri, "_self");
  return { mode: "uri" };
}
