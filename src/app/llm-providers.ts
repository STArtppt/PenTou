/**
 * Built-in LLM provider presets + migration helpers (llm-provider-config).
 * Static lists only — no online model fetch.
 */

export type BuiltinProviderId =
  | "deepseek"
  | "openai"
  | "moonshot"
  | "minimax"
  | "siliconflow"
  | "volcengine";

export type ProviderKind = BuiltinProviderId | "custom";

export interface ProviderPreset {
  id: BuiltinProviderId;
  /** i18n-independent display name (EN); UI may map via i18n */
  label: string;
  baseUrl: string;
  models: string[];
}

export const BUILTIN_PROVIDERS: ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
  },
  {
    id: "moonshot",
    label: "Moonshot AI",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    models: ["MiniMax-Text-01"],
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-7B-Instruct"],
  },
  {
    id: "volcengine",
    label: "Volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: [],
  },
];

export function getPreset(id: BuiltinProviderId): ProviderPreset {
  const p = BUILTIN_PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

/**
 * Display name for a provider kind. Pass `customFallback` from i18n
 * (e.g. t("settings.llm.providerCustom")) so empty custom tabs are localized.
 */
export function providerLabel(
  kind: ProviderKind,
  customName?: string,
  customFallback = "Custom",
): string {
  if (kind === "custom") {
    const n = customName?.trim();
    // Empty or legacy English default stored as name → use i18n fallback
    if (!n || n === "Custom") return customFallback;
    return n;
  }
  return getPreset(kind).label;
}

/** Normalize URL for comparison (strip trailing slash). */
export function normalizeEndpoint(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Identify built-in provider by endpoint base URL.
 * Returns null if no match (treat as custom).
 */
export function identifyProviderByEndpoint(endpoint: string): BuiltinProviderId | null {
  const n = normalizeEndpoint(endpoint);
  if (!n) return null;
  for (const p of BUILTIN_PROVIDERS) {
    const base = normalizeEndpoint(p.baseUrl);
    if (n === base || n.startsWith(base + "/")) return p.id;
  }
  return null;
}

export function isKnownModel(provider: BuiltinProviderId, model: string): boolean {
  const models = getPreset(provider).models;
  if (!models.length) return false;
  return models.includes(model);
}

export function defaultModel(provider: BuiltinProviderId): string {
  return getPreset(provider).models[0] ?? "";
}

/**
 * Decision C: when switching built-in provider on a tab, overwrite empty or
 * still-default fields only; never clear apiKey; reset useCustomModel.
 */
export function applyProviderSwitch(
  prev: {
    provider: ProviderKind;
    endpoint: string;
    model: string;
    apiKey: string;
    useCustomModel?: boolean;
    customName?: string;
  },
  nextProvider: ProviderKind,
): {
  provider: ProviderKind;
  endpoint: string;
  model: string;
  apiKey: string;
  useCustomModel?: boolean;
  customName?: string;
} {
  if (nextProvider === "custom") {
    return {
      provider: "custom",
      endpoint: prev.endpoint,
      model: prev.model,
      apiKey: prev.apiKey,
      useCustomModel: undefined,
      customName: prev.customName ?? "",
    };
  }

  const next = getPreset(nextProvider);
  const oldDefaultUrl =
    prev.provider === "custom" ? "" : getPreset(prev.provider as BuiltinProviderId).baseUrl;
  const oldDefaultModel =
    prev.provider === "custom"
      ? ""
      : defaultModel(prev.provider as BuiltinProviderId);

  const endpointEmptyOrDefault =
    !prev.endpoint.trim() ||
    normalizeEndpoint(prev.endpoint) === normalizeEndpoint(oldDefaultUrl);
  const modelEmptyOrDefault =
    !prev.model.trim() ||
    prev.model === oldDefaultModel ||
    (prev.provider !== "custom" &&
      isKnownModel(prev.provider as BuiltinProviderId, prev.model));

  return {
    provider: nextProvider,
    endpoint: endpointEmptyOrDefault ? next.baseUrl : prev.endpoint,
    model: modelEmptyOrDefault ? defaultModel(nextProvider) : prev.model,
    apiKey: prev.apiKey,
    useCustomModel: false,
    customName: undefined,
  };
}

export function genProviderId(): string {
  return `prov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
