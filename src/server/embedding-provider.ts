/**
 * embedding-provider.ts — 在线 OpenAI 兼容 /embeddings 适配（spec hybrid-search §4.7 D-P2-2）。
 *
 * 仅在线 provider（jina.ai / OpenAI / 多数兼容端点），零本地模型、零新增原生依赖。
 * embed() 把文本批量转成向量；超时 / 非 2xx / 形状异常一律抛出，供 searchService 走降级（§4.7 状态机 error）。
 *
 * Key 安全（§4.7 安全契约）：本模块不打印任何日志；错误体里剔除 apiKey；调用方负责不把 cfg.apiKey 落日志。
 */

export interface EmbeddingConfig {
  enabled: boolean;
  endpoint: string;   // 形如 https://api.openai.com/v1（不含 /embeddings）
  model: string;
  apiKey: string;     // 仅服务端持有，绝不回显（§4.7）
  dim?: number;       // 首响应自适应并持久化；用于维度一致性校验
}

const REQUEST_TIMEOUT_MS = 30_000;

export class EmbeddingError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/** 去掉 endpoint 末尾的 / 和重复的 /embeddings，拼出 /embeddings 完整地址。 */
function embeddingsUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return base.endsWith("/embeddings") ? base : `${base}/embeddings`;
}

/**
 * 批量嵌入。返回与 texts 等长、按入参顺序对齐的向量数组。
 * 抛错场景（供降级）：超时 / 非 2xx（带 status）/ 响应缺 data / 维度不一致。
 */
export async function embed(cfg: EmbeddingConfig, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(embeddingsUrl(cfg.endpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, input: texts }),
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new EmbeddingError(aborted ? "embedding request timed out" : "embedding request failed", 0);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // 不读取/回传 body 里可能夹带的敏感信息，仅记状态码。
    throw new EmbeddingError(`embedding endpoint returned ${res.status}`, res.status);
  }

  const json = (await res.json()) as { data?: Array<{ index?: number; embedding?: number[] }> };
  const data = json.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new EmbeddingError("embedding response missing or mismatched data", 0);
  }

  // provider 不保证返回顺序：有 index 则按 index 排，否则按返回序。
  const ordered = data.every((d) => typeof d.index === "number")
    ? [...data].sort((a, b) => (a.index! - b.index!))
    : data;

  const vectors = ordered.map((d) => d.embedding);
  if (vectors.some((v) => !Array.isArray(v) || v.length === 0)) {
    throw new EmbeddingError("embedding response contains empty vector", 0);
  }
  const dim = vectors[0]!.length;
  if (vectors.some((v) => v!.length !== dim)) {
    throw new EmbeddingError("embedding response has inconsistent dimensions", 0);
  }
  return vectors as number[][];
}
