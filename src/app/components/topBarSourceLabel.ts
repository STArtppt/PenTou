/**
 * 顶栏来源徽章的动态标签。
 *
 * cli 采集（ingestSource = "cli:<form-slug>"）显示形态段（如 grok-cli / claude-code）；
 * 否则回退品牌名（platform）。旧值 "cli" / "extension" 及空段不猜来源，同样回退品牌名。
 *
 * 背景：collector-source-expansion 在既有「品牌徽章」旁又加了独立形态徽章，导致顶栏
 * 出现「品牌名 + 来源标签」双徽章。合并为单个动态标签（debug 2026-07-21）。
 */
export function topBarSourceLabel(platform: string, ingestSource?: string): string {
  if (ingestSource?.startsWith("cli:")) {
    const slug = ingestSource.slice(4);
    if (slug) return slug;
  }
  return platform;
}
