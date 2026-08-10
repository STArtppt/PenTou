/**
 * Qwen / 通义千问分享态与国内站登录态共用的 turn 映射真源。
 * 国内登录态 data.list[] 与分享态 session.record_list[] 同构。
 */

function makeId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeMsg(role: "user" | "ai", content: string, timestamp: string) {
  return { id: `msg_${Math.random().toString(36).slice(2, 9)}`, role, content, timestamp };
}

function resourceUrl(resource: any): string {
  return (
    resource?.download_url ||
    resource?.cdn_url ||
    resource?.url ||
    resource?.preview_url ||
    resource?.thumbnail_url ||
    resource?.image_url ||
    resource?.img_url ||
    ""
  );
}

/** layout.image 可能是 refer 字符串、字符串数组、{refer_id} 或 {url} 对象。 */
function resolveLayoutImageRefs(imageField: any, resources: any[]): string[] {
  const refs = Array.isArray(imageField) ? imageField : imageField != null ? [imageField] : [];
  const urls: string[] = [];
  for (const ref of refs) {
    if (typeof ref === "string") {
      const resource = resources.find(
        (r: any) => r?.refer_id === ref || r?.id === ref || r?.resource_id === ref,
      );
      const url = resourceUrl(resource);
      if (url) urls.push(url);
      continue;
    }
    if (ref && typeof ref === "object") {
      const referId = ref.refer_id ?? ref.referId;
      if (referId != null) {
        const resource = resources.find(
          (r: any) => r?.refer_id === referId || r?.id === referId || r?.resource_id === referId,
        );
        const url = resourceUrl(resource) || (typeof ref.url === "string" ? ref.url : "");
        if (url) urls.push(url);
      } else {
        const url = resourceUrl(ref);
        if (url) urls.push(url);
      }
    }
  }
  return urls;
}

function markdownImages(urls: string[], startIndex = 1): string[] {
  const lines: string[] = [];
  let i = startIndex;
  for (const url of urls) {
    if (!url) {
      lines.push("[生成图片缺失]");
      continue;
    }
    lines.push(`![生成图片 ${i}](${url})`);
    i++;
  }
  return lines;
}

/**
 * 从 multi_load 单项提取 markdown（图片或可替换正文）。
 * 返回 null 表示本 load 不参与正文替换（思考/引用等本期跳过）。
 */
function renderMultiLoadItem(load: any): string | null {
  const type = String(load?.type || "");

  // 联网搜图瀑布 / 内联图卡
  if (type === "image_waterfall" || type === "image_inline") {
    const list = load?.content?.list;
    if (!Array.isArray(list) || list.length === 0) return null;
    const urls = list
      .map(
        (item: any) =>
          item?.image_url || item?.img_url || item?.download_url || item?.cdn_url || item?.url || item?.img_thumbnail || "",
      )
      .filter(Boolean);
    if (urls.length === 0) return null;
    return markdownImages(urls).join("\n\n");
  }

  // 生成图 card：ai_generate_image_list 等
  const content = load?.content;
  if (content && typeof content === "object") {
    // 真源路径：content.extra_info.content.extra.result_images
    const resultImages =
      content?.extra_info?.content?.extra?.result_images ??
      // 旧/分享测试载荷：load.extra_info...
      load?.extra_info?.content?.extra?.result_images;
    if (Array.isArray(resultImages) && resultImages.length > 0) {
      const urls = resultImages.map(
        (img: any) => img?.download_url || img?.cdn_url || img?.preview_url || img?.url || img?.thumbnail_url || "",
      );
      return markdownImages(urls).join("\n\n") || null;
    }

    const resources = content?.resource_infos;
    const layouts = content?.layout_list;
    if (Array.isArray(layouts) && layouts.length > 0 && Array.isArray(resources)) {
      const urls: string[] = [];
      for (const layout of layouts) {
        const resolved = resolveLayoutImageRefs(layout?.image, resources);
        if (resolved.length > 0) urls.push(...resolved);
      }
      if (urls.length > 0) return markdownImages(urls).join("\n\n");
    }

    // display_list 直接嵌 url 对象
    const displayList = content?.display_list;
    if (Array.isArray(displayList) && displayList.length > 0) {
      const urls: string[] = [];
      for (const item of displayList) {
        urls.push(...resolveLayoutImageRefs(item?.image, Array.isArray(resources) ? resources : []));
      }
      if (urls.length > 0) return markdownImages(urls).join("\n\n");
    }

    if (Array.isArray(resources) && resources.length > 0 && type.includes("image")) {
      // 仅当明确是图片类时才全量 resource_infos，避免误抓无关资源
      const urls = resources.map(resourceUrl).filter(Boolean);
      // 去重 watermark 倾向：优先 layout 已处理；这里是 fallback
      if (urls.length > 0) return markdownImages(urls).join("\n\n");
    }
  }

  // 兼容旧测试载荷：extra_info 挂在 load 根上、无 content
  const legacyResult = load?.extra_info?.content?.extra?.result_images;
  if (Array.isArray(legacyResult) && legacyResult.length > 0) {
    const urls = legacyResult.map(
      (img: any) => img?.download_url || img?.cdn_url || img?.preview_url || img?.url || img?.thumbnail_url || "",
    );
    return markdownImages(urls).join("\n\n") || null;
  }

  // multimodal_chat_think / bar_* / ref_source → 不展开进正文（占位符直接剥掉）
  return null;
}

/**
 * Qianwen 结构化图片 → markdown 图片（spec media-assets §4.5）。
 * 覆盖：result_images、layout_list+resource_infos、image_waterfall、image_inline。
 */
export function extractQianwenMessageImages(message: any): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  for (const load of message?.meta_data?.multi_load ?? []) {
    const md = renderMultiLoadItem(load);
    if (!md) continue;
    for (const line of md.split(/\n\n+/)) {
      const m = line.match(/!\[[^\]]*\]\(([^)]+)\)/);
      if (m) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        images.push(line);
      } else if (line === "[生成图片缺失]") {
        images.push(line);
      }
    }
  }

  // 重新编号
  return images.map((line, i) => {
    if (line === "[生成图片缺失]") return line;
    return line.replace(/!\[[^\]]*\]/, `![生成图片 ${i + 1}]`);
  });
}

/** 展开 response 正文：替换 [(source_seq)] 占位，补未挂接的图片。 */
export function expandQianwenResponseMessage(message: any): string {
  const text = typeof message.content === "string" ? message.content.trim() : "";
  const multiLoad: any[] = message?.meta_data?.multi_load ?? [];
  const bySeq = new Map<string, string>();

  for (const load of multiLoad) {
    const seq = load?.source_seq;
    if (!seq || typeof seq !== "string") continue;
    const md = renderMultiLoadItem(load);
    if (md) bySeq.set(seq, md);
  }

  const used = new Set<string>();
  let result = text.replace(/\[\(([^)\]]+)\)\]/g, (_match: string, seq: string) => {
    const md = bySeq.get(seq);
    if (md != null) {
      used.add(seq);
      return md;
    }
    // 无对应渲染（思考/引用等）→ 剥掉占位，避免脏文本
    return "";
  });

  // 未通过占位挂接的图片 load 追加到文末
  const leftover: string[] = [];
  for (const load of multiLoad) {
    const seq = load?.source_seq;
    if (seq && used.has(seq)) continue;
    const md = renderMultiLoadItem(load);
    if (md && md.includes("![")) leftover.push(md);
  }
  if (leftover.length > 0) {
    result = [result, ...leftover].filter(Boolean).join("\n\n");
  }

  // 若正文无 multi_load 路径图，再走 extract 兜底（兼容仅 extra_info 的旧载荷）
  if (!result.includes("![生成图片") && !result.includes("[生成图片缺失]")) {
    const imgs = extractQianwenMessageImages(message);
    if (imgs.length > 0) {
      result = [result, ...imgs].filter(Boolean).join("\n\n");
    }
  }

  return result.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function recordTimestamp(record: any, fallbackDate: string): string {
  if (typeof record.created_at === "number") return new Date(record.created_at).toISOString();
  if (typeof record.request_timestamp === "number") return new Date(record.request_timestamp).toISOString();
  if (typeof record.created_at === "string" && record.created_at) {
    const t = Date.parse(record.created_at);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return fallbackDate;
}

function recordSortKey(record: any): number {
  if (typeof record.created_at === "number") return record.created_at;
  if (typeof record.request_timestamp === "number") return record.request_timestamp;
  if (typeof record.created_at === "string") {
    const t = Date.parse(record.created_at);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

/** record_list / data.list 同构映射为 messages（时间正序）。 */
export function mapQianwenRecords(
  records: any[],
  fallbackDate = new Date().toISOString(),
): Array<{ id: string; role: "user" | "ai"; content: string; timestamp: string }> {
  const messages: Array<{ id: string; role: "user" | "ai"; content: string; timestamp: string }> = [];

  // 登录态 data.list 实测新→旧；分享态 record_list 旧→新。统一按时间升序。
  const ordered = [...records].sort((a, b) => recordSortKey(a) - recordSortKey(b));

  for (const record of ordered) {
    const timestamp = recordTimestamp(record, fallbackDate);

    for (const request of record.request_messages || []) {
      if (typeof request.content === "string" && request.content.trim()) {
        messages.push(makeMsg("user", request.content.trim(), timestamp));
      }
    }

    const responseText = (record.response_messages || [])
      .map((message: any) => expandQianwenResponseMessage(message))
      .filter(Boolean)
      .join("\n\n");
    if (responseText) messages.push(makeMsg("ai", responseText, timestamp));
  }

  return messages;
}

/** 分享态 API payload（含 session.record_list）→ Conversation 数组。 */
export function parseQianwenApiPayload(data: any): any[] {
  const date = new Date().toISOString();
  const records = data?.session?.record_list;
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Qianwen API payload did not contain any messages.");
  }

  const messages = mapQianwenRecords(records, date);
  if (messages.length === 0) {
    throw new Error("Qianwen API payload did not contain any message text.");
  }

  return [
    {
      id: makeId(),
      title: data.title || data.session?.title || "Qianwen Shared Conversation",
      platform: "Qianwen",
      date: messages[0]?.timestamp || date,
      folderId: null,
      messages,
    },
  ];
}
