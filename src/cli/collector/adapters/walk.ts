import fs from "node:fs/promises";
import path from "node:path";

export async function walkFiles(
  dir: string,
  accept: (entryName: string) => boolean,
  onSkippedDir?: (dir: string, error: Error) => void,
): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === "ENOENT") return files;
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      onSkippedDir?.(dir, error);
      return files;
    }
    throw error;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(full, accept, onSkippedDir));
    } else if (entry.isFile() && accept(entry.name)) {
      files.push(full);
    }
  }
  return files;
}
