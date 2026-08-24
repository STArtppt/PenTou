import { Bot, Terminal } from "lucide-react";
import clsx from "clsx";
import chatgptUrl from "../assets/brand-icons/chatgpt.svg";
import deepseekUrl from "../assets/brand-icons/deepseek.svg";
import geminiUrl from "../assets/brand-icons/google-gemini.svg";
import antigravityUrl from "../assets/brand-icons/google-antigravity.svg";
import claudeUrl from "../assets/brand-icons/claude.svg";
import cursorUrl from "../assets/brand-icons/cursor.svg";
import githubCopilotUrl from "../assets/brand-icons/github-copilot.svg";
import openaiUrl from "../assets/brand-icons/openai.svg";
import hermesUrl from "../assets/brand-icons/hermes.svg";
import doubaoUrl from "../assets/brand-icons/bytedance-doubao.svg";
import metasoUrl from "../assets/brand-icons/metaso.svg";
import qwenUrl from "../assets/brand-icons/alibaba-qwen.svg";
import grokUrl from "../assets/brand-icons/grok.svg";
import opencodeUrl from "../assets/brand-icons/opencode.svg";
import piUrl from "../assets/brand-icons/pi.svg";

// 映射见 spec ai-brand-icons §4.3；Codex 属 OpenAI 产品复用其图标。
// platform 是开放字符串（导入数据可超出 Platform 枚举），
// Doubao/Metaso/Qwen/Grok 为实际数据中存在的枚举外平台。
// Qwen 为标准产品名，Qianwen 为存量数据兼容 alias（spec import-auto-classify §4.3）。
export const BRAND_ICON_URLS: Record<string, string> = {
  ChatGPT: chatgptUrl,
  DeepSeek: deepseekUrl,
  Gemini: geminiUrl,
  Antigravity: antigravityUrl,
  Claude: claudeUrl,
  Cursor: cursorUrl,
  Copilot: githubCopilotUrl,
  Codex: openaiUrl,
  Hermes: hermesUrl,
  Doubao: doubaoUrl,
  Metaso: metasoUrl,
  Qwen: qwenUrl,
  Qianwen: qwenUrl,
  Grok: grokUrl,
  OpenCode: opencodeUrl,
  Pi: piUrl,
};

// 资产为 #FFFFFF 单色填充（assets/icons/normalized/），直接 <img> 在深色主题
// 白底头像上不可见，故用 CSS mask + currentColor 让图标继承容器前景色
export function BrandIcon({
  platform,
  size,
  className,
}: {
  platform: string;
  size: number;
  className?: string;
}) {
  if (platform === "CLI") return <Terminal size={size} className={className} />;
  const url = BRAND_ICON_URLS[platform];
  if (!url) return <Bot size={size} className={className} />;
  return (
    <span
      aria-hidden
      data-brand-icon={platform}
      className={clsx("inline-block shrink-0 bg-current", className)}
      style={{
        width: size,
        height: size,
        // 双引号必需：Vite 内联的 data URI 含单引号，裸 url() 会成为非法 CSS 被丢弃
        WebkitMaskImage: `url("${url}")`,
        maskImage: `url("${url}")`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
