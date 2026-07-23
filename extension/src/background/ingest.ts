import type { IngestRequest, IngestResponse } from "@shared/ingest-types";
import type { CapturePayload, CaptureResult, ExtensionConfig, IngestAction, QueuedCapture } from "../shared/types";
import { normalizeServer } from "../shared/state";

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };
}

function summarizeActions(response: IngestResponse): CaptureResult {
  const firstError = response.results.find((r) => r.error)?.error;
  if (firstError) {
    // 服务端逐 item 报错 = 解析失败（平台接口可能已变更），属永久性错误，不入队
    return { ok: false, code: "item-error", error: firstError };
  }

  const actions: Partial<Record<IngestAction, number>> = {};
  let firstId: string | undefined;
  for (const result of response.results) {
    for (const conv of result.conversations) {
      actions[conv.action] = (actions[conv.action] ?? 0) + 1;
      firstId ??= conv.id;
    }
  }
  return { ok: true, actions, id: firstId };
}

function requestBody(item: QueuedCapture): IngestRequest {
  return {
    source: "extension",
    items: [{
      platform: item.platform,
      externalId: item.externalId,
      format: "raw",
      data: item.raw,
    }],
  };
}

export async function postCapture(config: ExtensionConfig, item: CapturePayload | QueuedCapture): Promise<CaptureResult> {
  const server = normalizeServer(config.server);
  let res: Response;
  try {
    res = await fetch(`${server}/api/ingest`, {
      method: "POST",
      headers: authHeaders(config.token),
      body: JSON.stringify(requestBody(item)),
    });
  } catch {
    return { ok: false, code: "network", error: "Pentou is unreachable." };
  }

  if (res.status === 401) {
    return { ok: false, code: "unauthorized", error: "Ingest token was rejected. Open options and update the token." };
  }
  if (!res.ok) return { ok: false, code: "http", error: `Pentou returned HTTP ${res.status}` };
  return summarizeActions(await res.json() as IngestResponse);
}

export async function testConnection(server: string, token: string): Promise<"connected" | "unauthorized" | "unreachable"> {
  try {
    const res = await fetch(`${normalizeServer(server)}/api/ingest/ping`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (res.status === 401) return "unauthorized";
    return res.ok ? "connected" : "unreachable";
  } catch {
    return "unreachable";
  }
}
