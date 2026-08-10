import type { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "Pentou Collector",
  description: "Collect logged-in AI conversations into local Pentou.",
  version: "0.2.0",
  icons: {
    "128": "icon-128.png",
  },
  action: {
    default_title: "Collect to Pentou",
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  // No "tabs": sendMessage/create work via activeTab + host_permissions (CWS Purple Potassium).
  permissions: ["activeTab", "alarms", "notifications", "scripting", "storage"],
  host_permissions: [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://chat.deepseek.com/*",
    "https://www.doubao.com/*",
    "https://www.qianwen.com/*",
    // chat2-api.qianwen.com 故意不进 host_permissions：MV3 起 content script 的
    // fetch 走页面 origin + CORS，host 权限不再为其绕过；站点自身已跨子域放行
    // www.qianwen.com。若 5.3b 手验 CORS 失败再补，且 content_scripts.matches 永不加它。
    "https://chat.qwen.ai/*",
    "https://gemini.google.com/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ],
  content_scripts: [
    {
      matches: [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://chat.deepseek.com/*",
        "https://www.doubao.com/*",
        "https://www.qianwen.com/*",
        "https://chat.qwen.ai/*",
        "https://gemini.google.com/*"
      ],
      js: ["src/content/index.ts"],
      run_at: "document_idle"
    }
  ]
};

export default manifest;
