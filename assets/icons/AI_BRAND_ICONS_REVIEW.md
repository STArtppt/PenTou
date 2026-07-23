# AI Brand Icons Review

用于审查对话主体页 AI 助手头像/平台标识的候选 SVG 资产。

## 标准化产物

- 原始 SVG 保留在 `assets/icons/*.svg`，用于审查、替换和溯源。
- 源文件名统一使用小写英文 slug：`brand-name.svg`；脚本会自动修正常见别名，无法识别的非英文/非规范文件名会报错提示。
- 统一风格 SVG 生成到 `assets/icons/normalized/*.svg`。
- 默认输出：`200x200` canvas、`#FFFFFF` 单色填充、居中等比缩放、跳过未变更文件。
- 每次执行脚本都会同步刷新本文档的「当前已落地文件」列表。
- 如果源 SVG 内含 PNG/base64 raster，脚本会报错并跳过；请先补真矢量 SVG。

## 脚本用法

从项目根目录执行：

```bash
# 增量处理：只处理新增或比 normalized 产物更新的 SVG
python3 assets/icons/normalize_icons.py

# 强制重刷全部 normalized SVG
python3 assets/icons/normalize_icons.py --force

# 仅预览哪些文件/文档会被处理，不写入文件
python3 assets/icons/normalize_icons.py --check

# 生成其他纯色版本，例如黑色
python3 assets/icons/normalize_icons.py --color "#000000" --force

# 调整画布内边距，默认 16px
python3 assets/icons/normalize_icons.py --padding 20 --force
```

手动补充新品牌时，把真矢量 SVG 放到 `assets/icons/<brand-name>.svg`，文件名使用小写英文 slug；再执行 `python3 assets/icons/normalize_icons.py`。脚本会输出到 `assets/icons/normalized/<brand-name>.svg`，并同步刷新本文档的「当前已落地文件」列表；源文件不会被覆盖。

## 项目内已提及

| 品牌/平台 | 文件 | 状态 | 备注 |
| --- | --- | --- | --- |
| ChatGPT | `chatgpt.svg` | 已下载 | 使用 OpenAI 图标，项目导入/插件已支持 ChatGPT |
| OpenAI | `openai.svg` | 已下载 | OpenAI 兼容接口与 ChatGPT 相关 |
| Claude | `claude.svg` | 已下载 | 项目解析与 CLI collector 提及 |
| Anthropic | `anthropic.svg` | 已下载 | Claude 厂商标识 |
| DeepSeek | `deepseek.svg` | 已下载 | 项目导入/插件已支持 DeepSeek |
| Gemini | `google-gemini.svg` | 已下载 | 项目解析与文档提及 |
| Google | `google.svg` | 已下载 | Gemini 厂商标识 |
| Doubao / 豆包 | `bytedance-doubao.svg` | 已下载 | 使用 ByteDance 图标占位，项目媒体导入文档提及 |
| Qwen / 通义千问 | `alibaba-qwen.svg` | 已下载 | 使用 Alibaba Cloud 图标占位，项目媒体导入/mermaid 文档提及 |
| Kimi / Moonshot | `kimi.svg` | 已下载 | 已补真矢量 SVG |
| Cursor | `cursor.svg` | 已下载 | 项目解析与文档提及 |
| GitHub Copilot | `github-copilot.svg` | 已下载 | 项目解析与文档提及 |
| Codex | `openai.svg` | 复用 | Codex 属 OpenAI 产品，项目解析与文档提及 |

## 建议补充的常见品牌

| 品牌/平台 | 文件 | 状态 | 备注 |
| --- | --- | --- | --- |
| Microsoft Copilot | `microsoft-copilot.svg` | 已下载 | 当前复用 GitHub Copilot 图标，需审查是否替换成 Microsoft Copilot 官方图标 |
| Perplexity | `perplexity.svg` | 已下载 | 常见 AI 搜索/问答平台 |
| Metaso / 秘塔AI搜索 | `metaso.svg` | 已下载 | 已补真矢量 SVG |
| Meta AI / Llama | `meta.svg` | 已下载 | 使用 Meta 图标代表 Llama/Meta AI |
| Mistral AI | `mistral-ai.svg` | 已下载 | 常见开源/商用模型厂商 |
| xAI / Grok | `xai-grok.svg` | 已下载 | 使用 X 图标占位，需审查是否替换成 xAI/Grok 官方图标 |
| Cohere | `cohere.svg` | 已下载 | 已补真矢量 SVG |
| Hugging Face | `huggingface.svg` | 已下载 | 常见模型社区/推理平台 |
| Ollama | `ollama.svg` | 已下载 | 常见本地模型运行工具 |
| Baidu ERNIE / 文心一言 | `baidu-ernie.svg` | 已下载 | 使用 Baidu 图标占位 |
| Tencent Hunyuan / 混元 | `tencent-hunyuan.svg` | 已下载 | 使用 QQ/Tencent 系图标占位，需审查是否替换成混元官方图标 |
| MiniMax | `minimax.svg` | 已下载 | 常见国内模型厂商 |
| Zhipu AI / GLM / 智谱清言 | `zhipu-ai.svg` | 已下载 | 已补真矢量 SVG |
| Baichuan / 百川 | 待补 | 未下载 | 未找到稳定公开 SVG |
| 01.AI / Yi / 零一万物 | 待补 | 未下载 | 未找到稳定公开 SVG |
| StepFun / 阶跃星辰 | 待补 | 未下载 | 未找到稳定公开 SVG |
| iFLYTEK Spark / 讯飞星火 | `iflytek-spark.svg` | 已下载 | 已补真矢量 SVG |
| Stability AI | 待补 | 未下载 | 未找到可靠 SVG，Wikipedia 仅见 PNG wordmark |
| Midjourney | `midjourney.svg` | 已下载 | 常见生成图平台 |
| Runway | 待补 | 未下载 | Wikimedia 原始 SVG 当前返回 429，后续可重试或改走官方来源 |
| Suno | `suno.svg` | 已下载 | 常见 AI 音乐平台 |

## 当前已落地文件

- `Stability.svg`
- `alibaba-qwen.svg`
- `anthropic.svg`
- `baidu-ernie.svg`
- `bytedance-doubao.svg`
- `chatgpt.svg`
- `claude.svg`
- `cohere.svg`
- `cursor.svg`
- `deepseek.svg`
- `github-copilot.svg`
- `google-gemini.svg`
- `google.svg`
- `hermes.svg`
- `huggingface.svg`
- `iflytek-spark.svg`
- `kimi.svg`
- `meta.svg`
- `metaso.svg`
- `microsoft-copilot.svg`
- `midjourney.svg`
- `minimax.svg`
- `mistral-ai.svg`
- `ollama.svg`
- `openai.svg`
- `opencode.svg`
- `perplexity.svg`
- `runway.svg`
- `suno.svg`
- `tencent-hunyuan.svg`
- `xai-grok.svg`
- `zhipu-ai.svg`
