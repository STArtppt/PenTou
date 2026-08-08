import type { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "Pentou Collector",
  description: "Collect logged-in AI conversations into local Pentou.",
  version: "0.1.1",
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
    "http://localhost/*",
    "http://127.0.0.1/*"
  ],
  content_scripts: [
    {
      matches: [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://chat.deepseek.com/*"
      ],
      js: ["src/content/index.ts"],
      run_at: "document_idle"
    }
  ]
};

export default manifest;
