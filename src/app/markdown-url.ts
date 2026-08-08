/**
 * markdown-url.ts — 文档正文渲染时的 URL 净化策略。
 *
 * react-markdown 的 `defaultUrlTransform` 会把白名单之外的协议 strip 成空字符串。
 * 应用内链接用的是自定义协议 `pentou:`，**不在这里放行就会被直接清空**
 * —— design D4 标注它是本期最容易漏的一处，因此单独成模块并单测。
 */
import { defaultUrlTransform } from "react-markdown";
import { isInAppHref } from "./in-app-links";

/** 在图片 data URI 之外，额外放行应用内链接协议。 */
export function docUrlTransform(url: string): string {
  if (url.startsWith("data:image/")) return url;
  if (isInAppHref(url)) return url;
  return defaultUrlTransform(url);
}
