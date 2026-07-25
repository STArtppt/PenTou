import { describe, expect, it } from "vitest";
import {
  applyProviderSwitch,
  getActiveLLMConfig,
  migrateV1ToV2,
  parseLLMSettings,
  tabTitleForProvider,
  type ProviderConfig,
} from "./llm-settings";

describe("llm-settings migration", () => {
  it("maps old OpenAI config to OpenAI slot (not DeepSeek)", () => {
    const v2 = migrateV1ToV2({
      endpoint: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      systemPromptConvertConv: "convert",
      systemPromptRewriteByAnnotations: "rewrite",
    });
    expect(v2.version).toBe(2);
    expect(v2.providers).toHaveLength(1);
    expect(v2.providers[0].provider).toBe("openai");
    expect(v2.providers[0].endpoint).toBe("https://api.openai.com/v1");
    expect(v2.providers[0].apiKey).toBe("sk-test");
    expect(v2.providers[0].model).toBe("gpt-4o-mini");
    expect(v2.systemPromptConvertConv).toBe("convert");
    expect(v2.systemPromptRewriteByAnnotations).toBe("rewrite");
    expect(v2.activeProviderId).toBe(v2.providers[0].id);
  });

  it("falls back to custom when endpoint unknown", () => {
    const v2 = migrateV1ToV2({
      endpoint: "https://example.com/v1",
      apiKey: "k",
      model: "m",
    });
    expect(v2.providers[0].provider).toBe("custom");
    expect(v2.providers[0].customName).toBe("");
    expect(v2.providers[0].endpoint).toBe("https://example.com/v1");
  });

  it("parses v2 payload as-is", () => {
    const raw = {
      version: 2,
      providers: [
        {
          id: "a",
          provider: "deepseek",
          endpoint: "https://api.deepseek.com/v1",
          apiKey: "",
          model: "deepseek-chat",
        },
      ],
      activeProviderId: "a",
      systemPromptConvertConv: "c",
      systemPromptRewriteByAnnotations: "r",
    };
    const s = parseLLMSettings(raw);
    expect(s.version).toBe(2);
    expect(s.providers[0].id).toBe("a");
  });
});

describe("getActiveLLMConfig", () => {
  it("assembles active provider + global prompts", () => {
    const settings = parseLLMSettings({
      version: 2,
      providers: [
        {
          id: "a",
          provider: "deepseek",
          endpoint: "https://api.deepseek.com/v1",
          apiKey: "k1",
          model: "deepseek-chat",
        },
        {
          id: "b",
          provider: "openai",
          endpoint: "https://api.openai.com/v1",
          apiKey: "k2",
          model: "gpt-4o",
        },
      ],
      activeProviderId: "b",
      systemPromptConvertConv: "C",
      systemPromptRewriteByAnnotations: "R",
    });
    const cfg = getActiveLLMConfig(settings);
    expect(cfg.endpoint).toBe("https://api.openai.com/v1");
    expect(cfg.apiKey).toBe("k2");
    expect(cfg.model).toBe("gpt-4o");
    expect(cfg.systemPromptConvertConv).toBe("C");
  });
});

describe("applyProviderSwitch", () => {
  it("overwrites empty/default fields, never clears apiKey", () => {
    const next = applyProviderSwitch(
      {
        provider: "openai",
        endpoint: "https://api.openai.com/v1",
        model: "gpt-4o",
        apiKey: "keep-me",
        useCustomModel: true,
      },
      "deepseek",
    );
    expect(next.provider).toBe("deepseek");
    expect(next.endpoint).toBe("https://api.deepseek.com/v1");
    expect(next.model).toBe("deepseek-v4-flash");
    expect(next.apiKey).toBe("keep-me");
    expect(next.useCustomModel).toBe(false);
  });

  it("keeps custom endpoint when user edited it", () => {
    const next = applyProviderSwitch(
      {
        provider: "openai",
        endpoint: "https://my-proxy.example/v1",
        model: "custom-model",
        apiKey: "k",
      },
      "deepseek",
    );
    expect(next.endpoint).toBe("https://my-proxy.example/v1");
    // model was not the default gpt-4o and not only-in-list if it's custom-model
    // custom-model is not in openai list → treated as user value and kept
    expect(next.model).toBe("custom-model");
  });
});

describe("tabTitleForProvider", () => {
  it("adds ordinal for duplicate providers", () => {
    const all: ProviderConfig[] = [
      {
        id: "1",
        provider: "openai",
        endpoint: "",
        apiKey: "",
        model: "",
      },
      {
        id: "2",
        provider: "openai",
        endpoint: "",
        apiKey: "",
        model: "",
      },
    ];
    expect(tabTitleForProvider(all[0], all)).toBe("OpenAI");
    expect(tabTitleForProvider(all[1], all)).toBe("OpenAI 2");
  });

  it("uses localized customFallback when customName empty", () => {
    const p: ProviderConfig = {
      id: "1",
      provider: "custom",
      customName: "",
      endpoint: "",
      apiKey: "",
      model: "",
    };
    expect(tabTitleForProvider(p, [p], { customFallback: "自定义" })).toBe("自定义");
  });
});
