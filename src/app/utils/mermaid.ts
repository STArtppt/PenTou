import type { Mermaid, MermaidConfig, RenderResult } from "mermaid";

export type MermaidTheme = "default" | "dark";

let mermaidPromise: Promise<Mermaid> | null = null;
let loadFailed = false;
let currentTheme: MermaidTheme = "default";

function configForTheme(theme: MermaidTheme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme,
  };
}

export function setMermaidTheme(theme: MermaidTheme) {
  currentTheme = theme;
}

export function getMermaidTheme() {
  return currentTheme;
}

export function loadMermaid(): Promise<Mermaid> {
  if (loadFailed) {
    return Promise.reject(new Error("Mermaid module failed to load"));
  }

  if (!mermaidPromise) {
    mermaidPromise = import("mermaid")
      .then((mod) => {
        const api = mod.default;
        api.initialize(configForTheme(currentTheme));
        return api;
      })
      .catch((error) => {
        loadFailed = true;
        mermaidPromise = null;
        throw error;
      });
  }

  return mermaidPromise;
}

export async function renderMermaid(id: string, source: string, theme: MermaidTheme): Promise<RenderResult> {
  setMermaidTheme(theme);
  const api = await loadMermaid();
  api.initialize(configForTheme(theme));
  await api.parse(source);
  return api.render(id, source);
}

export function resetMermaidForTests() {
  mermaidPromise = null;
  loadFailed = false;
  currentTheme = "default";
}
