import type { Annotation } from "./data";

export function relocateAnnotations(
  annos: Annotation[],
  _oldBody: string,
  newBody: string,
): Annotation[] {
  return annos.map((a) => {
    const idx = newBody.indexOf(a.anchor);
    if (idx === -1) {
      return { ...a, orphanedAt: new Date().toISOString() };
    }
    return {
      ...a,
      orphanedAt: undefined,
      range: { start: idx, end: idx + a.anchor.length },
    };
  });
}

export function applyHighlightsToDOM(
  rootEl: HTMLElement,
  annotations: Annotation[],
): void {
  rootEl.querySelectorAll("mark[data-anno-id]").forEach((mark) => {
    const textNode = document.createTextNode(mark.textContent || "");
    mark.parentNode?.replaceChild(textNode, mark);
  });
  rootEl.normalize();

  for (const anno of annotations) {
    if (anno.orphanedAt) continue;
    highlightAnchorInDOM(rootEl, anno);
  }
}

function highlightAnchorInDOM(root: HTMLElement, anno: Annotation): void {
  if (!anno.anchor) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const idx = node.textContent?.indexOf(anno.anchor) ?? -1;
    if (idx === -1) continue;

    const before = node.textContent!.slice(0, idx);
    const after = node.textContent!.slice(idx + anno.anchor.length);

    const mark = document.createElement("mark");
    mark.dataset.annoId = anno.id;
    mark.textContent = anno.anchor;
    mark.style.backgroundColor = anno.color;
    mark.style.borderRadius = "2px";
    mark.style.padding = "0 1px";
    if (anno.comment) mark.title = anno.comment;
    mark.className = `annotation-highlight annotation-${anno.type}`;

    const parent = node.parentNode!;
    if (before) parent.insertBefore(document.createTextNode(before), node);
    parent.insertBefore(mark, node);
    if (after) parent.insertBefore(document.createTextNode(after), node);
    parent.removeChild(node);
    break;
  }
}

export function captureAnnotationFromSelection(
  body: string,
): { anchor: string; range: { start: number; end: number } } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;

  const anchor = selection.toString().trim();
  if (!anchor) return null;

  const start = body.indexOf(anchor);
  if (start === -1) return null;

  return { anchor, range: { start, end: start + anchor.length } };
}
