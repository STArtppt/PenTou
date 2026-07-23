import type { IngestAction } from "@shared/ingest-types";

export type { IngestAction };
export type PlatformSlug = "chatgpt" | "deepseek";
export type CaptureTrigger = "manual" | "auto";
/** postCapture 的失败分类：只有 network（Pentou 不可达）允许进离线队列。 */
export type CaptureFailureCode = "unauthorized" | "network" | "http" | "item-error";

export interface PlatformConfig {
  enabled: boolean;
  auto: boolean;
}

export interface ExtensionConfig {
  server: string;
  token: string;
}

export interface QueuedCapture {
  platform: PlatformSlug;
  externalId: string;
  raw: string;
  capturedAt: string;
}

export interface ExtensionState {
  config: ExtensionConfig;
  platforms: Record<PlatformSlug, PlatformConfig>;
  queue: QueuedCapture[];
  /** token 被 Pentou 拒绝（401）后置位，暂停自动采集直至重新保存配置（spec 边界 4）。 */
  authBlocked: boolean;
}

export interface CapturePayload extends QueuedCapture {
  trigger: CaptureTrigger;
}

export interface CaptureResult {
  ok: boolean;
  queued?: boolean;
  actions?: Partial<Record<IngestAction, number>>;
  error?: string;
  code?: CaptureFailureCode;
  id?: string;
}

export type ContentRequest =
  | { type: "PENTOU_CAPTURE"; trigger: CaptureTrigger }
  | { type: "PENTOU_STATUS" };

export type ContentResponse =
  | { ok: true; supported: true; platform: PlatformSlug; externalId: string; payload?: CapturePayload }
  | { ok: true; supported: false; platforms: PlatformSlug[] }
  | { ok: false; error: string; reason?: "not-logged-in" | "platform-api-changed" };

export type BackgroundRequest =
  | { type: "PENTOU_SUBMIT"; payload: CapturePayload }
  | { type: "PENTOU_GET_STATE" }
  | { type: "PENTOU_SAVE_STATE"; state: ExtensionState }
  | { type: "PENTOU_TEST_CONNECTION"; server: string; token: string };

export type BackgroundResponse =
  | CaptureResult
  | { ok: true; state: ExtensionState }
  | { ok: true; status: "connected" }
  | { ok: false; error: string; status?: "unauthorized" | "unreachable" };
