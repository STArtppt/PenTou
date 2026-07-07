/**
 * searchJump.ts — 搜索结果点击后在目标内容内用命中片段二次定位（spec hybrid-search US-03）。
 * 服务端不承诺稳定 message id / DOM 锚点，故由前端用 snippetText 在已渲染元素中查找、
 * 滚动并临时高亮；定位不到由调用方降级到顶部（决策4）。
 */
export interface FlashCandidate {
  el: HTMLElement;
  text: string;
}

const FLASH_MS = 2200;

function normalize(s: string): string {
  return s.replace(/…/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** 在候选元素中查找包含 snippet 文本者，滚动到视图中央并临时高亮。返回是否定位成功。 */
export function locateAndFlash(candidates: FlashCandidate[], snippetText: string): boolean {
  const needle = normalize(snippetText);
  if (!needle) return false;

  // snippet 窗口可能跨段/被截断，全串匹配不到时退化用较短子串再试。
  const needles = needle.length > 16 ? [needle, needle.slice(0, 16), needle.slice(-16)] : [needle];
  for (const n of needles) {
    for (const c of candidates) {
      if (normalize(c.text).includes(n)) {
        c.el.scrollIntoView({ behavior: "smooth", block: "center" });
        c.el.classList.add("search-hit-flash");
        setTimeout(() => c.el.classList.remove("search-hit-flash"), FLASH_MS);
        return true;
      }
    }
  }
  return false;
}
