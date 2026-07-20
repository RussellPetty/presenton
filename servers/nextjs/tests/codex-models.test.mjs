import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadCodexModels() {
  const outDir = await mkdtemp(path.join(tmpdir(), "codex-models-test-"));
  const outfile = path.join(outDir, "codex-models.mjs");

  await build({
    entryPoints: [path.join(projectRoot, "utils", "codexModels.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });

  return import(pathToFileURL(outfile).href);
}

const codexModelsPromise = loadCodexModels();

test("lists named GPT-5.6 models with Luna as the default", async () => {
  const { CODEX_MODELS, DEFAULT_CODEX_MODEL, isSupportedCodexModel } = await codexModelsPromise;

  assert.equal(DEFAULT_CODEX_MODEL, "gpt-5.6-luna");
  assert.deepEqual(CODEX_MODELS.slice(0, 3), [
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
  ]);
  assert.equal(isSupportedCodexModel("gpt-5.6-sol"), true);
  assert.equal(isSupportedCodexModel("gpt-5.6-terra"), true);
  assert.equal(isSupportedCodexModel("gpt-5.6-luna"), true);
  assert.equal(isSupportedCodexModel("gpt-5.6"), false);
  assert.equal(isSupportedCodexModel("gpt-5.2"), false);
});
