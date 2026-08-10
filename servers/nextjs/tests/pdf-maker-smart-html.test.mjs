import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pdfMakerSourceUrl = new URL(
  "../app/(export)/pdf-maker/PdfMakerPage.tsx",
  import.meta.url,
);

test("pdf maker mounts Smart slide HTML directly without an iframe", async () => {
  const source = await readFile(pdfMakerSourceUrl, "utf8");

  assert.match(source, /const SmartHtmlPdfSlide/);
  assert.match(source, /dangerouslySetInnerHTML=\{\{ __html: html \}\}/);
  assert.match(source, /useSmartChartInjection\(\{/);
  assert.doesNotMatch(source, /<iframe\b/);
});
