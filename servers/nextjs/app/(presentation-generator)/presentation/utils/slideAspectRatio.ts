export const PRESENTATION_ASPECT_RATIOS = ["16:9", "4:3", "1:1"] as const;

export type PresentationAspectRatio =
  (typeof PRESENTATION_ASPECT_RATIOS)[number];

export const BASE_SLIDE_WIDTH = 1280;
export const BASE_SLIDE_HEIGHT = 720;

const SLIDE_HEIGHTS: Record<PresentationAspectRatio, number> = {
  "16:9": 720,
  "4:3": 960,
  "1:1": 1280,
};

export function normalizePresentationAspectRatio(
  value: unknown
): PresentationAspectRatio {
  return PRESENTATION_ASPECT_RATIOS.includes(
    value as PresentationAspectRatio
  )
    ? (value as PresentationAspectRatio)
    : "16:9";
}

export function getSlideDimensions(value: unknown) {
  const aspectRatio = normalizePresentationAspectRatio(value);
  const height = SLIDE_HEIGHTS[aspectRatio];

  return {
    aspectRatio,
    width: BASE_SLIDE_WIDTH,
    height,
    contentOffsetY: (height - BASE_SLIDE_HEIGHT) / 2,
  };
}
