/**
 * ingest-types.ts — `/api/ingest` 的契约类型（spec browser-extension §4.2）。
 *
 * 采集端与服务端共用同一份源码：extension 经 tsconfig path `@shared/*`
 * 单向引用本目录（extension → src/shared/，反向禁止，见 spec 决策 1）。
 * 响应结构以 api-router.ts 的 ingest 处理为准。
 */

export type IngestAction = "created" | "merged" | "skipped";

export interface IngestItem {
  platform: string;
  externalId?: string;
  format: "raw" | "conversation";
  data: unknown;
  filename?: string;
}

export interface IngestRequest {
  source: string;
  items: IngestItem[];
}

export interface IngestItemResult {
  itemIndex: number;
  conversations: Array<{ action: IngestAction; id: string; title: string }>;
  error?: string;
  redactions?: number;
}

export interface IngestResponse {
  ok: boolean;
  results: IngestItemResult[];
}
