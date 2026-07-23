import type { IngestItem, IngestResponse } from "./types.js";

export class IngestHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "IngestHttpError";
    this.status = status;
  }
}

export class IngestNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestNetworkError";
  }
}

export interface IngestClientOptions {
  server: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export class IngestClient {
  private server: string;
  private token: string;
  private fetchImpl: typeof fetch;

  constructor(options: IngestClientOptions) {
    this.server = options.server.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async ping(): Promise<void> {
    await this.request("/api/ingest/ping", { method: "GET" });
  }

  async ingest(items: IngestItem[]): Promise<IngestResponse> {
    if (items.length === 0) return { ok: true, results: [] };
    if (items.length > 50) throw new Error("ingest client accepts at most 50 items per request");
    return await this.request("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "cli", items }),
    });
  }

  async ingestBatches(items: IngestItem[]): Promise<IngestResponse[]> {
    const responses: IngestResponse[] = [];
    for (let i = 0; i < items.length; i += 50) {
      responses.push(await this.ingest(items.slice(i, i + 50)));
    }
    return responses;
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.server}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (error: any) {
      throw new IngestNetworkError(error?.message ?? String(error));
    }

    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`.trim();
      try {
        const body = await response.json();
        if (body?.error) message = `${response.status} ${body.error}`;
      } catch {
        // Keep status text.
      }
      throw new IngestHttpError(response.status, message);
    }

    if (response.status === 204) return undefined;
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }
}

export function isRetryableIngestError(error: unknown): boolean {
  if (error instanceof IngestNetworkError) return true;
  if (error instanceof IngestHttpError) return error.status >= 500 || error.status === 429;
  return false;
}

export function isAuthIngestError(error: unknown): boolean {
  return error instanceof IngestHttpError && error.status === 401;
}
