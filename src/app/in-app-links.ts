/**
 * in-app-links.ts — 应用内链接协议 `pentou://<kind>/<id>`（spec in-app-links / design D4）。
 *
 * 主题汇总的来源清单要能**点回原会话**。本应用是状态驱动、无路由器，因此不走哈希路由
 * （为一个链接功能装一套导航体系不划算），改用自定义协议 + 渲染层拦截。
 *
 * 渲染侧必须配合两处：`urlTransform` 放行 `pentou:`（不放行则链接被净化成空），
 * `a` 组件命中时 `preventDefault` 并交给应用内跳转。
 */

export const IN_APP_LINK_PROTOCOL = "pentou:";

export type InAppLinkKind = "conversation" | "document";

export interface InAppLink {
  kind: InAppLinkKind;
  id: string;
}

const KINDS: InAppLinkKind[] = ["conversation", "document"];
/** 与服务端的 id 校验同口径（`CONV_ID_RE` / `DOC_ID_RE` 的并集），挡掉路径穿越与空 id。 */
const ID_RE = /^[a-zA-Z0-9_-]+$/;

export function buildInAppLink(kind: InAppLinkKind, id: string): string {
  return `pentou://${kind}/${id}`;
}

/**
 * 解析一个 href。非 `pentou:` 协议、未知 kind、非法 id 一律返回 `null`
 * —— 调用方据此决定「按普通外链处理」还是「按应用内跳转处理」。
 */
export function parseInAppLink(href: unknown): InAppLink | null {
  if (typeof href !== "string") return null;
  const m = href.match(/^pentou:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const kind = m[1] as InAppLinkKind;
  const id = m[2];
  if (!KINDS.includes(kind)) return null;
  if (!ID_RE.test(id)) return null;
  return { kind, id };
}

/** href 是否指向应用内对象（含格式非法的情形 —— 那也不该按外链在新标签页打开）。 */
export function isInAppHref(href: unknown): boolean {
  return typeof href === "string" && href.toLowerCase().startsWith(IN_APP_LINK_PROTOCOL);
}
