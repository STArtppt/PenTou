/**
 * markdown-gfm.ts — 全站 remark-gfm 统一配置。
 *
 * 默认 `singleTilde: true` 会把中文区间写法 `0~1` / `0.8~0.85` 误解析为删除线
 * （两个单波浪之间的整段变成 `<del>`）。GFM 规范删除线是双波浪 `~~text~~`。
 * 关闭 singleTilde 后：区间原样显示，真删除线仍可用。
 */
import remarkGfm from "remark-gfm";
import type { Options } from "remark-gfm";
import type { PluggableList } from "unified";

export const remarkGfmOptions: Options = { singleTilde: false };

/** 给 `unified().use(remarkGfm, …)` 用；与 React 渲染共用同一份选项。 */
export { remarkGfm };

/** ReactMarkdown 的 `remarkPlugins` 入口。 */
export const remarkPlugins: PluggableList = [[remarkGfm, remarkGfmOptions]];
