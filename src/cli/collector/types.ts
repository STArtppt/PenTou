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
  /** 默认 "raw"；"conversation" 仅超限降级本地解析产出（spec collector-oversize-ingest §4.4） */
  format: "raw" | "conversation";
  data: string | Record<string, unknown>;
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
  /** 空会话（载荷合法但 0 条消息）：非失败，计入 skipped 并正常推进快照 */
  skippedReason?: string;
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
  /** 超限降级中被瘦身上报的会话数（有信息损失但成功落库，spec collector-oversize-ingest US-02） */
  truncated: number;
  counts: CollectorCounts;
  errors: CollectorFileError[];
}
