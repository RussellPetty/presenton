import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function importPixelRatioModule() {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "pixel-ratio-"));
  const outfile = path.join(tempDirectory, "pixel-ratio.mjs");
  await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: ["components/slide-editor/surface/pixelRatio.ts"],
    format: "esm",
    outfile,
    platform: "node",
    tsconfig: path.join(projectRoot, "tsconfig.json"),
  });
  return import(pathToFileURL(outfile).href);
}

test("content canvas resolution stays sharp across display densities", async () => {
  const {
    calculateContentScenePixelRatio,
  } = await importPixelRatioModule();

  const contentRatio = (devicePixelRatio, displayScale, capabilities = {}) =>
    calculateContentScenePixelRatio({
      devicePixelRatio,
      displayScale,
      ...capabilities,
    });

  assert.equal(contentRatio(1, 0.5), 2);
  assert.ok(Math.abs(contentRatio(2, 0.8) - 2.16) < 0.001);
  assert.equal(contentRatio(3, 1), 4);
  assert.equal(contentRatio(4, 1.5), 4);
  assert.equal(contentRatio(3, 1, { deviceMemory: 4 }), 3);
  assert.equal(contentRatio(1, 0.5, { hardwareConcurrency: 4 }), 1.5);
});

test("pixel-ratio synchronization also runs outside edit mode", async () => {
  const source = await readFile(
    path.join(
      projectRoot,
      "components/slide-editor/surface/TemplateV2KonvaSlide.tsx",
    ),
    "utf8",
  );

  assert.match(
    source,
    /useEffect\(\(\) => \{\s+if \(!isRenderActive \|\| typeof window === "undefined"\)[\s\S]*?calculateScenePixelRatio/,
  );
});
