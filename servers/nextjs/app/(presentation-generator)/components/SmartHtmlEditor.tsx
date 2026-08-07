"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useDispatch } from "react-redux";

import IconsEditor from "@/components/slide-editor/images/IconsEditor";
import { useTailwindRuntimeReady } from "@/components/runtime/TailwindCdnRuntime";
import { updateSlideHtmlContent } from "@/store/slices/presentationGeneration";
import ImageEditor from "./ImageEditor";
import SmartHtmlSlide from "./SmartHtmlSlide";
import { useSmartChartInjection } from "./useSmartChartInjection";

type ActiveMedia = {
  element: HTMLImageElement;
  kind: "icon" | "image";
  query: string;
};

const EXCLUDED_TEXT_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "IMG",
  "VIDEO",
  "AUDIO",
  "CANVAS",
]);

const INLINE_TEXT_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "SPAN",
  "U",
  "A",
  "SMALL",
  "SUB",
  "SUP",
  "S",
  "MARK",
  "CODE",
  "KBD",
  "VAR",
  "ABBR",
  "CITE",
  "Q",
  "TIME",
  "BR",
  "WBR",
]);

export default function SmartHtmlEditor({
  slide,
  fonts,
  title,
}: {
  slide: {
    id?: string | null;
    index?: number;
    html_content?: string | null;
  };
  fonts?: unknown;
  title: string;
}) {
  const dispatch = useDispatch();
  const tailwindReady = useTailwindRuntimeReady();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dirtyRef = useRef(false);
  const html = slide.html_content?.trim() ?? "";
  const [instanceId] = useState(
    () =>
      `${slide.id ?? "smart-slide"}-${Math.random()
        .toString(36)
        .slice(2)}`
  );
  const [activeMedia, setActiveMedia] = useState<ActiveMedia | null>(null);

  const saveHtml = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const clone = container.cloneNode(true) as HTMLElement;
    const unwrap = (element: Element) => {
      const parent = element.parentNode;
      if (!parent) return;
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      parent.removeChild(element);
    };

    clone.querySelectorAll('[data-smart-text-wrapper="1"]').forEach(unwrap);
    clone.querySelectorAll<HTMLElement>('[data-editable-text="1"]').forEach((element) => {
      element.removeAttribute("data-editable-text");
      element.removeAttribute("data-smart-text-wrapper");
      element.removeAttribute("contenteditable");
      element.removeAttribute("spellcheck");
    });
    clone
      .querySelectorAll<HTMLElement>("[data-smart-editable-media]")
      .forEach((element) => element.removeAttribute("data-smart-editable-media"));

    const nextHtml = clone.innerHTML.trim();
    dirtyRef.current = false;
    if (!nextHtml || nextHtml === html) return;

    dispatch(
      updateSlideHtmlContent({
        slideIndex: slide.index ?? 0,
        slideId: slide.id,
        html: nextHtml,
      })
    );
  }, [dispatch, html, slide.id, slide.index]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !tailwindReady) return;
    container.innerHTML = html;
    dirtyRef.current = false;

    const cleanups: Array<() => void> = [];
    const markEditable = (element: HTMLElement, isWrapper = false) => {
      if (element.closest('[data-editable-text="1"]')) return;
      element.setAttribute("data-editable-text", "1");
      if (isWrapper) element.setAttribute("data-smart-text-wrapper", "1");
      element.setAttribute("contenteditable", "true");
      element.setAttribute("spellcheck", "false");

      const markDirty = () => {
        dirtyRef.current = true;
      };
      const handleBlur = () => {
        if (dirtyRef.current) saveHtml();
      };
      element.addEventListener("input", markDirty);
      element.addEventListener("cut", markDirty);
      element.addEventListener("paste", markDirty);
      element.addEventListener("drop", markDirty);
      element.addEventListener("blur", handleBlur);
      cleanups.push(() => {
        element.removeEventListener("input", markDirty);
        element.removeEventListener("cut", markDirty);
        element.removeEventListener("paste", markDirty);
        element.removeEventListener("drop", markDirty);
        element.removeEventListener("blur", handleBlur);
      });
    };

    const allElements = Array.from(
      container.querySelectorAll<HTMLElement>("*")
    );
    allElements.forEach((element) => {
      if (EXCLUDED_TEXT_TAGS.has(element.tagName)) return;
      const text = element.textContent?.replace(/\s+/g, " ").trim();
      if (!text) return;
      const descendants = Array.from(element.querySelectorAll<HTMLElement>("*"));
      if (
        descendants.length > 0 &&
        descendants.every((descendant) => INLINE_TEXT_TAGS.has(descendant.tagName))
      ) {
        markEditable(element);
      }
    });
    allElements.forEach((element) => {
      if (
        EXCLUDED_TEXT_TAGS.has(element.tagName) ||
        element.children.length > 0 ||
        element.closest('[data-editable-text="1"]')
      ) {
        return;
      }
      if (element.textContent?.replace(/\s+/g, " ").trim()) markEditable(element);
    });
    allElements.forEach((element) => {
      if (
        EXCLUDED_TEXT_TAGS.has(element.tagName) ||
        element.closest('[data-editable-text="1"]')
      ) {
        return;
      }
      Array.from(element.childNodes).forEach((node) => {
        if (
          node.nodeType !== Node.TEXT_NODE ||
          !node.textContent?.replace(/\s+/g, " ").trim()
        ) {
          return;
        }
        const wrapper = document.createElement("span");
        wrapper.textContent = node.textContent;
        element.replaceChild(wrapper, node);
        markEditable(wrapper, true);
      });
    });

    container.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      if (!image.getAttribute("src")) return;
      image.setAttribute("data-smart-editable-media", "true");
      const handleClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const isIcon =
          image.getAttribute("image-type") === "icon" ||
          image.src.includes(".svg") ||
          image.alt.toLowerCase().includes("icon");
        setActiveMedia({
          element: image,
          kind: isIcon ? "icon" : "image",
          query:
            image.getAttribute(isIcon ? "query" : "prompt")?.trim() ?? "",
        });
      };
      image.addEventListener("click", handleClick);
      cleanups.push(() => image.removeEventListener("click", handleClick));
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      if (dirtyRef.current) saveHtml();
    };
  }, [html, saveHtml, tailwindReady]);

  useEffect(() => {
    if (!tailwindReady || !fonts || typeof fonts !== "object" || Array.isArray(fonts)) {
      return;
    }

    const assets: HTMLElement[] = [];
    Object.entries(fonts as Record<string, unknown>).forEach(([family, source]) => {
      if (typeof source !== "string" || !source.trim()) return;
      if (source.includes("fonts.googleapis.com") || source.endsWith(".css")) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = source;
        document.head.appendChild(link);
        assets.push(link);
        return;
      }
      const style = document.createElement("style");
      const safeFamily = family.replaceAll("'", "\\'");
      const safeSource = source.replaceAll("'", "\\'");
      style.textContent = `@font-face{font-family:'${safeFamily}';src:url('${safeSource}');font-display:swap}`;
      document.head.appendChild(style);
      assets.push(style);
    });
    return () => assets.forEach((asset) => asset.remove());
  }, [fonts, tailwindReady]);

  useSmartChartInjection({
    html: tailwindReady ? html : "",
    instanceId,
    containerRef,
  });

  const replaceMedia = (url: string, query?: string) => {
    if (!activeMedia) return;
    activeMedia.element.src = url;
    if (query) {
      activeMedia.element.setAttribute(
        activeMedia.kind === "icon" ? "query" : "prompt",
        query
      );
    }
    dirtyRef.current = true;
    setActiveMedia(null);
    window.setTimeout(saveHtml, 0);
  };

  if (!tailwindReady) {
    return <SmartHtmlSlide fixedSize fonts={fonts} html={html} title={title} />;
  }

  return (
    <>
      <div
        ref={containerRef}
        data-smart-slide-instance={instanceId}
        className="smart-html-editor relative h-full w-full overflow-hidden bg-white"
        aria-label={title}
      />
      <style jsx global>{`
        .smart-html-editor [contenteditable="true"] {
          cursor: text;
          user-select: text;
          -webkit-user-select: text;
        }
        .smart-html-editor [contenteditable="true"]:focus {
          outline: none;
        }
        .smart-html-editor [data-smart-editable-media="true"] {
          cursor: pointer;
          transition: opacity 160ms ease;
        }
        .smart-html-editor [data-smart-editable-media="true"]:hover {
          opacity: 0.86;
        }
      `}</style>
      {activeMedia?.kind === "image" && (
        <ImageEditor
          initialImage={activeMedia.element.src}
          slideIndex={slide.index ?? 0}
          promptContent={activeMedia.query}
          onClose={() => setActiveMedia(null)}
          onImageChange={replaceMedia}
        />
      )}
      {activeMedia?.kind === "icon" && (
        <IconsEditor
          currentIconUrl={activeMedia.element.src}
          icon_prompt={activeMedia.query ? [activeMedia.query] : []}
          onClose={() => setActiveMedia(null)}
          onIconChange={replaceMedia}
        />
      )}
    </>
  );
}
