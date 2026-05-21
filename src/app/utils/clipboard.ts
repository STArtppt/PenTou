/**
 * 复制文本到剪贴板，带非安全上下文（局域网 HTTP）兜底。
 * 优先用 navigator.clipboard（需 HTTPS/localhost），失败时回退到
 * 临时 textarea + document.execCommand("copy")。
 * 返回 true 表示成功，false 表示失败（不抛错）。
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 走兜底
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
