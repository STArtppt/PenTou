/**
 * LLMSettings v2 types, migration, and active-config derivation
 * (feature llm-provider-config).
 */

import {
  DEFAULT_PROMPT_CONVERT,
  DEFAULT_PROMPT_REWRITE,
} from "./llm";
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

/** Runtime shape consumed by llm.ts call sites (legacy-compatible). */
export interface LLMConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  systemPromptConvertConv: string;
  systemPromptRewriteByAnnotations: string;
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
  systemPromptConvertConv: string;
  systemPromptRewriteByAnnotations: string;
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
    systemPromptConvertConv: DEFAULT_PROMPT_CONVERT,
    systemPromptRewriteByAnnotations: DEFAULT_PROMPT_REWRITE,
  };
}

/** v1 single-config → v2 (spec §4.3). */
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
    systemPromptConvertConv:
      typeof old.systemPromptConvertConv === "string"
        ? old.systemPromptConvertConv
        : DEFAULT_PROMPT_CONVERT,
    systemPromptRewriteByAnnotations:
      typeof old.systemPromptRewriteByAnnotations === "string"
        ? old.systemPromptRewriteByAnnotations
        : DEFAULT_PROMPT_REWRITE,
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
    return {
      version: 2,
      providers,
      activeProviderId: active,
      systemPromptConvertConv:
        typeof obj.systemPromptConvertConv === "string"
          ? obj.systemPromptConvertConv
          : DEFAULT_PROMPT_CONVERT,
      systemPromptRewriteByAnnotations:
        typeof obj.systemPromptRewriteByAnnotations === "string"
          ? obj.systemPromptRewriteByAnnotations
          : DEFAULT_PROMPT_REWRITE,
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
    systemPromptConvertConv: settings.systemPromptConvertConv,
    systemPromptRewriteByAnnotations: settings.systemPromptRewriteByAnnotations,
  };
}

/** Derive a runtime LLMConfig for the currently edited tab (test connection). */
export function providerToLLMConfig(
  p: ProviderConfig,
  settings: Pick<LLMSettings, "systemPromptConvertConv" | "systemPromptRewriteByAnnotations">,
): LLMConfig {
  return {
    endpoint: p.endpoint,
    apiKey: p.apiKey,
    model: p.model,
    systemPromptConvertConv: settings.systemPromptConvertConv,
    systemPromptRewriteByAnnotations: settings.systemPromptRewriteByAnnotations,
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
