"use client";

import React, { useMemo } from "react";
import { marked } from "marked";

interface MarkdownInlineTextProps {
  content: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Slide layouts own their typography, so block-level Markdown such as headings
 * and quotes must not create nested layout elements inside a title/body field.
 * The editor already consumes these prefixes when Tiptap initializes; apply the
 * same normalization in read-only previews and exports.
 */
export function normalizeSlideInlineMarkdown(content: string): string {
  return (content || "")
    .split("\n")
    .map((line) =>
      line
        .replace(/^(?:\s*>\s*)+/, "")
        .replace(/^\s*#{1,6}\s+/, "")
    )
    .join("\n");
}

/**
 * Renders inline markdown (e.g. **bold**) without block wrappers like <p>.
 * Used for export/preview where Tiptap edit mode is off.
 */
const MarkdownInlineText: React.FC<MarkdownInlineTextProps> = ({
  content,
  className = "",
  style,
}) => {
  const normalizedContent = normalizeSlideInlineMarkdown(content);
  const html = useMemo(() => {
    try {
      const parsed = marked.parseInline(normalizedContent, { async: false });
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }, [normalizedContent]);

  if (html === null) {
    return (
      <span className={className} style={style}>
        {normalizedContent}
      </span>
    );
  }

  return (
    <span
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MarkdownInlineText;
