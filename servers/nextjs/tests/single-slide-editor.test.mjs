import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const presentationPageUrl = new URL(
  "../app/(presentation-generator)/presentation/components/PresentationPage.tsx",
  import.meta.url,
);
const slideContentUrl = new URL(
  "../app/(presentation-generator)/presentation/components/SlideContent.tsx",
  import.meta.url,
);
const presentationActionsUrl = new URL(
  "../app/(presentation-generator)/presentation/components/PresentationActions.tsx",
  import.meta.url,
);
const presentationRenderUrl = new URL(
  "../app/(presentation-generator)/components/PresentationRender.tsx",
  import.meta.url,
);

test("editor renders only the selected slide without a scrolling deck", async () => {
  const [presentationPageSource, slideContentSource] = await Promise.all([
    readFile(presentationPageUrl, "utf8"),
    readFile(slideContentUrl, "utf8"),
  ]);

  assert.doesNotMatch(presentationPageSource, /SnapSlideDeck/);
  assert.doesNotMatch(
    presentationPageSource,
    /presentationData\.slides\.map\([\s\S]*?<SlideContent/,
  );
  assert.match(
    presentationPageSource,
    /activeEditorSlide[\s\S]*?<SlideContent[\s\S]*?fitToContainer/,
  );
  assert.match(
    presentationPageSource,
    /<div className="mx-auto h-full min-h-0 w-full">\s*<SlideContent/,
  );
  assert.match(slideContentSource, /<SlideActionBar/);
  assert.doesNotMatch(slideContentSource, /revealOnGroupHover/);
});

test("right tools rail stays visible and opens its panel on tab selection", async () => {
  const [presentationPageSource, presentationActionsSource] = await Promise.all([
    readFile(presentationPageUrl, "utf8"),
    readFile(presentationActionsUrl, "utf8"),
  ]);

  assert.match(presentationPageSource, /isRightPanelOpen \? "xl:w-\[375px\]" : "xl:w-\[70px\]"/);
  assert.match(presentationActionsSource, /onPanelOpenChange\(true\)/);
  assert.match(presentationActionsSource, /<aside className="ml-auto /);
  assert.match(
    presentationActionsSource,
    /\{panelOpen \? \([\s\S]*?<ActionsPanel[\s\S]*?<ActionsSidebar/,
  );
  assert.match(presentationActionsSource, /aria-label=\{panelOpen \? "Close tools panel" : "Open tools panel"\}/);
});

test("active slide can scale above its authored size to fill the viewport", async () => {
  const presentationRenderSource = await readFile(presentationRenderUrl, "utf8");

  assert.match(
    presentationRenderSource,
    /if \(fitToContainer\)[\s\S]*?return Math\.min\(sx, sy\);/,
  );
  assert.doesNotMatch(
    presentationRenderSource,
    /if \(fitToContainer\)[\s\S]*?return Math\.min\(sx, sy, 1\);/,
  );
});

test("desktop editor centers and dismisses its navigation introduction", async () => {
  const presentationPageSource = await readFile(presentationPageUrl, "utf8");

  assert.match(presentationPageSource, /presenton:editor-navigation-hint:v1/);
  assert.match(presentationPageSource, /Navigate with/);
  assert.match(presentationPageSource, /or the left thumbnails/);
  assert.match(presentationPageSource, /Dismiss navigation hint/);
  assert.match(
    presentationPageSource,
    /style=\{\{ left: "50%", transform: "translateX\(-50%\)" \}\}/,
  );
  assert.match(
    presentationPageSource,
    /window\.setTimeout\(dismissNavigationHint, 15_000\)/,
  );
  assert.match(
    presentationPageSource,
    /navigationHintSlideRef\.current === selectedSlide[\s\S]*?return;[\s\S]*?dismissNavigationHint\(\)/,
  );
});
