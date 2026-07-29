import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const nextRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
let tempDirectory;
let safeLayoutPaths;

before(async () => {
  tempDirectory = await mkdtemp(
    path.join(os.tmpdir(), "presenton-safe-layout-paths-"),
  );
  const outfile = path.join(tempDirectory, "safe-layout-paths.mjs");

  await build({
    entryPoints: [path.join(nextRoot, "lib/safe-layout-paths.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });

  safeLayoutPaths = await import(pathToFileURL(outfile).href);
});

after(async () => {
  if (tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("accepts simple layout and component identifiers", () => {
  assert.equal(safeLayoutPaths.isSafeLayoutSegment("MyLayout"), true);
  assert.equal(safeLayoutPaths.isSafeLayoutSegment("slide_01"), true);
  assert.equal(safeLayoutPaths.isSafeLayoutSegment("Hero.Card"), true);
});

test("rejects path traversal and separator segments", () => {
  assert.equal(safeLayoutPaths.isSafeLayoutSegment("../escape"), false);
  assert.equal(safeLayoutPaths.isSafeLayoutSegment(".."), false);
  assert.equal(safeLayoutPaths.isSafeLayoutSegment("a/b"), false);
  assert.equal(safeLayoutPaths.isSafeLayoutSegment("a\\b"), false);
  assert.equal(safeLayoutPaths.isSafeLayoutSegment("/tmp"), false);
  assert.equal(safeLayoutPaths.isSafeLayoutSegment(""), false);
});

test("resolves files only under the layouts root", () => {
  const cwd = tempDirectory;
  const previous = process.env.APP_DATA_DIRECTORY;
  delete process.env.APP_DATA_DIRECTORY;

  try {
    const resolved = safeLayoutPaths.resolveSafeLayoutFilePath(
      "DemoLayout",
      "TitleSlide",
      cwd,
    );
    const expectedDir = path.join(cwd, "app_data", "layouts", "DemoLayout");
    assert.equal(resolved.layoutsDir, expectedDir);
    assert.equal(
      resolved.filePath,
      path.join(expectedDir, "TitleSlide.tsx"),
    );
  } finally {
    if (previous === undefined) {
      delete process.env.APP_DATA_DIRECTORY;
    } else {
      process.env.APP_DATA_DIRECTORY = previous;
    }
  }
});

test("throws before writing when identifiers are unsafe", () => {
  assert.throws(
    () =>
      safeLayoutPaths.resolveSafeLayoutFilePath(
        "../../../../tmp",
        "owned",
        tempDirectory,
      ),
    /Invalid layout_name/,
  );
  assert.throws(
    () =>
      safeLayoutPaths.resolveSafeLayoutFilePath(
        "DemoLayout",
        "../../owned",
        tempDirectory,
      ),
    /Invalid component_name/,
  );
});
