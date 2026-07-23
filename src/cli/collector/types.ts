export interface FileSnapshot {
  mtimeMs: number;
  size: number;
}

export interface CollectorConfig {
  server: string;
  token: string;
  adapters: {
    "claude-code": { enabled: boolean; root?: string };
    waylog: { enabled: boolean; dirs: string[] };
  };
  exclude: string[];
  debounceMs: number;
  snapshots: Record<string, FileSnapshot>;
}

export interface SessionFile {
  path: string;
  platform: string;
}

export interface IngestItem {
  platform: string;
  externalId?: string;
  format: "raw";
  data: string;
  filename?: string;
}

export interface CollectorAdapter {
  platform: string;
  discover(): Promise<SessionFile[]>;
  watchRoots(): string[];
  toItem(file: string): Promise<IngestItem | null>;
}

export type IngestAction = "created" | "merged" | "skipped";

export interface IngestConversationResult {
  action: IngestAction;
  id: string;
  title?: string;
}

export interface IngestItemResult {
  itemIndex: number;
  conversations: IngestConversationResult[];
  error?: string;
}

export interface IngestResponse {
  ok: boolean;
  results: IngestItemResult[];
}

export interface CollectorCounts {
  created: number;
  merged: number;
  skipped: number;
  error: number;
}

export interface CollectorFileError {
  file: string;
  error: string;
}

export interface PullSummary {
  scanned: number;
  sent: number;
  skippedByExclude: number;
  counts: CollectorCounts;
  errors: CollectorFileError[];
}
