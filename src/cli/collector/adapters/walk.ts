import fs from "node:fs/promises";
import path from "node:path";

export interface WalkOptions {
  onSkippedDir?: (dir: string, error: Error) => void;
  /** 返回 false 则整棵子树不进入（docs adapter 用于跳过 node_modules / dist 等构建产物）。 */
  acceptDir?: (entryName: string) => boolean;
}

export async function walkFiles(
  dir: string,
  accept: (entryName: string) => boolean,
  onSkippedDirOrOptions?: ((dir: string, error: Error) => void) | WalkOptions,
): Promise<string[]> {
  const options: WalkOptions = typeof onSkippedDirOrOptions === "function"
    ? { onSkippedDir: onSkippedDirOrOptions }
    : onSkippedDirOrOptions ?? {};
  const files: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === "ENOENT") return files;
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      options.onSkippedDir?.(dir, error);
      return files;
    }
    throw error;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (options.acceptDir && !options.acceptDir(entry.name)) continue;
      files.push(...await walkFiles(full, accept, options));
    } else if (entry.isFile() && accept(entry.name)) {
      files.push(full);
    }
  }
  return files;
}
