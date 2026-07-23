export const MIGRATION_SCHEMA_VERSION = 1;

export type MigrationDirection = "push" | "pull";
export type ConflictResolution = "overwrite" | "skip";

export interface MigrationManifest {
  schemaVersion: number;
  pentouVersion: string;
  generatedAt: string;
  entries: ManifestEntry[];
}

export interface ManifestEntry {
  path: string;
  hash: string;
  size: number;
  mtime: number;
}

export interface ConflictEntry {
  path: string;
  sourceHash: string;
  targetHash: string;
  sourceMtime: number;
  targetMtime: number;
  sourceSize: number;
  targetSize: number;
}

export interface MigrationPlan {
  adds: string[];
  conflicts: ConflictEntry[];
  skips: number;
  targetOnly: number;
  sourceEntries: ManifestEntry[];
  targetEntries: ManifestEntry[];
}

export interface MigrationFailure {
  path: string;
  reason: string;
}

export interface MigrationProgress {
  stage: "idle" | "testing" | "planning" | "transferring" | "merging-folders" | "finalizing" | "done" | "error";
  transferred: number;
  total: number;
  skipped: number;
  failures: MigrationFailure[];
  message?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface MigrationRunResult extends MigrationProgress {
  ok: boolean;
  durationMs: number;
}

export interface MigrationPeerRequest {
  remoteUrl: string;
  password?: string;
  direction: MigrationDirection;
  allowInsecure?: boolean;
}

export interface MigrationRunRequest extends MigrationPeerRequest {
  conflicts?: Array<{ path: string; resolution: ConflictResolution }>;
}

export interface FolderBundle {
  folders: unknown[];
  documentFolders: unknown[];
}

