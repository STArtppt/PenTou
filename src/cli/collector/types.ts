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
    // 文件型（spec collector-source-expansion §4.3）
    codex: { enabled: boolean; root?: string };
    "grok-cli": { enabled: boolean; root?: string };
    "copilot-vscode": { enabled: boolean; root?: string };
    // SQLite 查询型
    opencode: { enabled: boolean; db?: string };
    copilot: { enabled: boolean; db?: string };
    hermes: { enabled: boolean; db?: string };
    cursor: { enabled: boolean; db?: string };
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
  /**
   * "query" = SQLite 查询型：discover 返回 sqlite://<db>#<sessionId> 虚拟键，
   * 快照由 snapshot() 提供；缺省 "files"（spec collector-source-expansion §4.3）。
   */
  kind?: "files" | "query";
  discover(): Promise<SessionFile[]>;
  watchRoots(): string[];
  toItem(fileOrKey: string): Promise<IngestItem | null>;
  /** 查询型必备：虚拟键 → 快照（mtimeMs=会话更新时间，size=消息数） */
  snapshot?(fileOrKey: string): Promise<FileSnapshot | null>;
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
