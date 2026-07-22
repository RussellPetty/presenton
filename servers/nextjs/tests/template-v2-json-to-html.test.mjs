import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function importRenderer() {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "template-v2-html-"));
  const outfile = path.join(tempDirectory, "template-v2-json-to-html.mjs");
  await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: ["lib/template-v2-json-to-html.ts"],
    format: "esm",
    outfile,
    platform: "node",
    tsconfig: path.join(projectRoot, "tsconfig.json"),
  });
  return import(pathToFileURL(outfile).href);
}

test("renders template v2 text run underlines in generated HTML", async () => {
  const { templateV2UiToHtml } = await importRenderer();

  const html = templateV2UiToHtml({
    elements: [
      {
        type: "text",
        position: { x: 0, y: 0 },
        size: { width: 300, height: 80 },
        font: {
          family: "Arial",
          size: 24,
          color: "#111827",
          underline: true,
        },
        runs: [
          { text: "Under", font: { underline: true } },
          { text: "Plain", font: { underline: false } },
        ],
      },
    ],
  });

  assert.ok(html);
  assert.match(
    html,
    /<span style="[^"]*text-decoration:underline;[^"]*">Under\s*<\/span>/,
  );
  assert.match(
    html,
    /<span style="[^"]*text-decoration:none;[^"]*">Plain<\/span>/,
  );
  assert.doesNotMatch(
    html,
    /display:flex;[^"]*text-decoration:underline;/,
    "text wrappers should not force underline onto child runs",
  );
});

test("renders legacy text-decoration underline fields", async () => {
  const { templateV2UiToHtml } = await importRenderer();

  const html = templateV2UiToHtml({
    elements: [
      {
        type: "text",
        position: { x: 0, y: 0 },
        size: { width: 300, height: 80 },
        font: { family: "Arial", size: 24, color: "#111827" },
        runs: [{ text: "Legacy", font: { text_decoration: "underline" } }],
      },
    ],
  });

  assert.ok(html);
  assert.match(
    html,
    /<span style="[^"]*text-decoration:underline;[^"]*">Legacy<\/span>/,
  );
});
