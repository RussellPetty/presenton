import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shortcutsUrl = new URL(
  "../components/slide-editor/shortcuts/editorShortcuts.ts",
  import.meta.url,
);
const dialogUrl = new URL(
  "../app/(presentation-generator)/presentation/components/KeyboardShortcutsDialog.tsx",
  import.meta.url,
);

test("shortcut modal documents editor slide navigation", async () => {
  const [shortcutsSource, dialogSource] = await Promise.all([
    readFile(shortcutsUrl, "utf8"),
    readFile(dialogUrl, "utf8"),
  ]);

  assert.match(shortcutsSource, /id: "navigation"/);
  assert.match(shortcutsSource, /id: "previous-slide"/);
  assert.match(shortcutsSource, /chords: \[\["ArrowLeft"\], \["ArrowUp"\]\]/);
  assert.match(shortcutsSource, /id: "next-slide"/);
  assert.match(shortcutsSource, /chords: \[\["ArrowRight"\], \["ArrowDown"\]\]/);
  assert.match(shortcutsSource, /ArrowLeft: "←"/);
  assert.match(shortcutsSource, /ArrowRight: "→"/);
  assert.match(dialogSource, /navigation: Presentation/);
});
