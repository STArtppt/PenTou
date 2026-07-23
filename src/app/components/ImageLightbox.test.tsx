// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageGalleryProvider, ImageLightbox, MarkdownImage } from "./ImageLightbox";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../data", () => ({
  useAppContext: () => ({ theme: "light", language: "en" }),
}));

async function waitFor(assertion: () => void) {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 1000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }
  }
  throw lastError;
}

function fireKey(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("ImageLightbox gallery navigation (media-assets US-01 AC4–AC6)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("multi-image gallery: counter, next/prev buttons, arrow keys, no wrap", async () => {
    const items = [
      { id: "a", src: "https://example.com/1.png", alt: "one" },
      { id: "b", src: "https://example.com/2.png", alt: "two" },
      { id: "c", src: "https://example.com/3.png", alt: "three" },
    ];
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;

    await act(async () => {
      root = createRoot(container);
      root.render(<ImageLightbox items={items} initialIndex={0} onClose={onClose} />);
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="image-lightbox"]')).not.toBeNull();
    });

    const img = () => container.querySelector('[data-testid="image-lightbox-img"]') as HTMLImageElement;
    const counter = () => container.querySelector('[data-testid="image-lightbox-counter"]')?.textContent?.trim();
    const prev = () => container.querySelector('[data-testid="image-lightbox-prev"]') as HTMLButtonElement;
    const next = () => container.querySelector('[data-testid="image-lightbox-next"]') as HTMLButtonElement;

    expect(img().src).toContain("1.png");
    expect(counter()).toBe("1 / 3");
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(false);

    // 首张 ← no-op
    await act(async () => {
      fireKey("ArrowLeft");
    });
    expect(img().src).toContain("1.png");
    expect(counter()).toBe("1 / 3");

    await act(async () => {
      next().click();
    });
    expect(img().src).toContain("2.png");
    expect(counter()).toBe("2 / 3");
    expect(prev().disabled).toBe(false);

    await act(async () => {
      fireKey("ArrowRight");
    });
    expect(img().src).toContain("3.png");
    expect(counter()).toBe("3 / 3");
    expect(next().disabled).toBe(true);

    // 末张 → no-op
    await act(async () => {
      fireKey("ArrowRight");
    });
    expect(img().src).toContain("3.png");

    await act(async () => {
      fireKey("Escape");
    });
    expect(onClose).toHaveBeenCalled();

    await act(async () => {
      root!.unmount();
    });
    container.remove();
  });

  it("single image: no nav controls or counter", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;

    await act(async () => {
      root = createRoot(container);
      root.render(
        <ImageLightbox
          items={[{ id: "only", src: "https://example.com/solo.png" }]}
          initialIndex={0}
          onClose={() => {}}
        />,
      );
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="image-lightbox-img"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="image-lightbox-counter"]')).toBeNull();
    expect(container.querySelector('[data-testid="image-lightbox-prev"]')).toBeNull();
    expect(container.querySelector('[data-testid="image-lightbox-next"]')).toBeNull();

    await act(async () => {
      root!.unmount();
    });
    container.remove();
  });

  it("clicking mask closes; clicking image does not", async () => {
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;

    await act(async () => {
      root = createRoot(container);
      root.render(
        <ImageLightbox
          items={[{ id: "x", src: "https://example.com/x.png" }]}
          initialIndex={0}
          onClose={onClose}
        />,
      );
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="image-lightbox"]')).not.toBeNull();
    });
    const lightbox = container.querySelector('[data-testid="image-lightbox"]') as HTMLElement;
    const img = container.querySelector('[data-testid="image-lightbox-img"]') as HTMLElement;

    await act(async () => {
      img.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      lightbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      root!.unmount();
    });
    container.remove();
  });

  it("ImageGalleryProvider collects images for MarkdownImage open snapshot", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;

    await act(async () => {
      root = createRoot(container);
      root.render(
        <ImageGalleryProvider>
          <MarkdownImage src="https://example.com/a.png" alt="a" />
          <MarkdownImage src="https://example.com/b.png" alt="b" />
        </ImageGalleryProvider>,
      );
    });

    const thumbs = container.querySelectorAll("img");
    expect(thumbs.length).toBe(2);

    await act(async () => {
      thumbs[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="image-lightbox"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="image-lightbox-counter"]')?.textContent?.trim()).toBe("1 / 2");

    await act(async () => {
      (container.querySelector('[data-testid="image-lightbox-next"]') as HTMLButtonElement).click();
    });
    expect(
      (container.querySelector('[data-testid="image-lightbox-img"]') as HTMLImageElement).src,
    ).toContain("b.png");
    expect(container.querySelector('[data-testid="image-lightbox-counter"]')?.textContent?.trim()).toBe("2 / 2");

    await act(async () => {
      root!.unmount();
    });
    container.remove();
  });
});
