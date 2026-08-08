/**
 * LLMSettings v2 types, migration, and active-config derivation
 * (feature llm-provider-config).
 *
 * System prompts for product skills live with the skills themselves
 * (`DEFAULT_PROMPT_*` in llm.ts) — not as user-editable LLM settings.
 */

import {
  type BuiltinProviderId,
  type ProviderKind,
  BUILTIN_PROVIDERS,
  applyProviderSwitch,
  defaultModel,
  genProviderId,
  getPreset,
  identifyProviderByEndpoint,
  isKnownModel,
  providerLabel,
} from "./llm-providers";

/** Runtime shape consumed by llm.ts call sites (provider connection only). */
export interface LLMConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface ProviderConfig {
  id: string;
  provider: ProviderKind;
  customName?: string;
  endpoint: string;
  apiKey: string;
  model: string;
  useCustomModel?: boolean;
}

export interface LLMSettings {
  version: 2;
  providers: ProviderConfig[];
  activeProviderId: string;
}

export function createDefaultProvider(provider: BuiltinProviderId = "deepseek"): ProviderConfig {
  const preset = getPreset(provider);
  return {
    id: genProviderId(),
    provider,
    endpoint: preset.baseUrl,
    apiKey: "",
    model: defaultModel(provider),
    useCustomModel: false,
  };
}

export function createDefaultLLMSettings(): LLMSettings {
  const slot0 = createDefaultProvider("deepseek");
  return {
    version: 2,
    providers: [slot0],
    activeProviderId: slot0.id,
  };
}

/** v1 single-config → v2 (spec §4.3). Legacy system-prompt fields are dropped. */
export function migrateV1ToV2(old: Partial<LLMConfig> & Record<string, unknown>): LLMSettings {
  const endpoint =
    typeof old.endpoint === "string" ? old.endpoint : getPreset("deepseek").baseUrl;
  const apiKey = typeof old.apiKey === "string" ? old.apiKey : "";
  const model = typeof old.model === "string" ? old.model : defaultModel("deepseek");
  const identified = identifyProviderByEndpoint(endpoint);

  const slot0: ProviderConfig = {
    id: genProviderId(),
    provider: identified ?? "custom",
    // Leave name empty — UI shows localized "自定义" / "Custom" via customFallback
    customName: identified ? undefined : "",
    endpoint,
    apiKey,
    model,
    useCustomModel: identified ? !isKnownModel(identified, model) : undefined,
  };

  return {
    version: 2,
    providers: [slot0],
    activeProviderId: slot0.id,
  };
}

export function parseLLMSettings(raw: unknown): LLMSettings {
  if (!raw || typeof raw !== "object") return createDefaultLLMSettings();
  const obj = raw as Record<string, unknown>;

  if (obj.version === 2 && Array.isArray(obj.providers) && obj.providers.length > 0) {
    const providers = obj.providers as ProviderConfig[];
    const active =
      typeof obj.activeProviderId === "string" &&
      providers.some((p) => p.id === obj.activeProviderId)
        ? (obj.activeProviderId as string)
        : providers[0].id;
    // Ignore legacy systemPrompt* keys if present in stored JSON.
    return {
      version: 2,
      providers,
      activeProviderId: active,
    };
  }

  // v1 shape
  return migrateV1ToV2(obj as Partial<LLMConfig>);
}

export function loadLLMSettingsFromLocalStorage(): LLMSettings {
  try {
    const raw = localStorage.getItem("pentou-llm-config");
    if (raw) return parseLLMSettings(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return createDefaultLLMSettings();
}

export function getActiveLLMConfig(settings: LLMSettings): LLMConfig {
  const active =
    settings.providers.find((p) => p.id === settings.activeProviderId) ??
    settings.providers[0];
  return {
    endpoint: active?.endpoint ?? "",
    apiKey: active?.apiKey ?? "",
    model: active?.model ?? "",
  };
}

/** Derive a runtime LLMConfig for the currently edited tab (test connection). */
export function providerToLLMConfig(p: ProviderConfig): LLMConfig {
  return {
    endpoint: p.endpoint,
    apiKey: p.apiKey,
    model: p.model,
  };
}

export function tabTitleForProvider(
  p: ProviderConfig,
  all: ProviderConfig[],
  options?: { customFallback?: string },
): string {
  const customFallback = options?.customFallback ?? "Custom";
  const base = providerLabel(p.provider, p.customName, customFallback);
  const same = all.filter(
    (x) =>
      x.provider === p.provider &&
      (p.provider !== "custom" ||
        (x.customName?.trim() || "") === (p.customName?.trim() || "")),
  );
  if (same.length <= 1) return base;
  const idx = same.findIndex((x) => x.id === p.id);
  return idx === 0 ? base : `${base} ${idx + 1}`;
}

export {
  applyProviderSwitch,
  providerLabel,
  getPreset,
  BUILTIN_PROVIDERS,
  genProviderId,
};
export type { BuiltinProviderId, ProviderKind };
