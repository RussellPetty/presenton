import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const initializerUrl = new URL(
  "../app/ConfigurationInitializer.tsx",
  import.meta.url,
);

test("initial Presenton loading screen is centered by the viewport container", async () => {
  const source = await readFile(initializerUrl, "utf8");

  assert.match(
    source,
    /className="fixed inset-0[^\n]*flex items-center justify-center[^\n]*bg-white"/,
  );
  assert.match(
    source,
    /className="flex flex-col items-center gap-7 whitespace-nowrap text-center"/,
  );
  assert.doesNotMatch(
    source,
    /absolute left-1\/2 top-1\/2[\s\S]*?-translate-x-1\/2 -translate-y-1\/2/,
  );
});
