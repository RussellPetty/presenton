/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   url: string,
 *   kind: "headshot" | "logo"
 * }} BrandPhotoAsset
 */

/** @param {string | undefined} baseHref */
function getComparisonBase(baseHref) {
  if (baseHref) return baseHref;
  if (typeof window !== "undefined" && window.location?.href) {
    return window.location.href;
  }
  return "http://presenton.local/";
}

/**
 * Canonical form used only when comparing media URLs. URL parsing encodes raw
 * spaces exactly as the browser does for HTMLImageElement.src. The query is
 * retained, so two different signed URLs never match merely because their
 * filenames are alike. No path decoding is performed (notably, %2F stays %2F).
 *
 * @param {string} value
 * @param {string} [baseHref]
 * @returns {string | null}
 */
export function canonicalizeMediaUrlForComparison(value, baseHref) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (/^(?:data|blob):/i.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed, getComparisonBase(baseHref));
    parsed.hash = "";
    // Percent escape hex digits are case-insensitive. Normalize their casing
    // without decoding/re-encoding the path or touching the source URL.
    return parsed.href.replace(/%[0-9a-f]{2}/gi, (escape) =>
      escape.toUpperCase()
    );
  } catch {
    return trimmed.replace(/ /g, "%20");
  }
}

/**
 * @param {string} left
 * @param {string} right
 * @param {string} [baseHref]
 */
export function areMediaUrlsEqual(left, right, baseHref) {
  const canonicalLeft = canonicalizeMediaUrlForComparison(left, baseHref);
  const canonicalRight = canonicalizeMediaUrlForComparison(right, baseHref);
  if (canonicalLeft === null || canonicalRight === null) return false;
  if (canonicalLeft === canonicalRight) return true;

  // Historical decks can contain the direct FastAPI host while the web runtime
  // renders these nginx-served assets on the current origin. Only permit that
  // origin difference for our two known backend asset namespaces.
  try {
    const leftUrl = new URL(canonicalLeft);
    const rightUrl = new URL(canonicalRight);
    const isBackendPath = (pathname) =>
      pathname.startsWith("/app_data/") || pathname.startsWith("/static/");
    return (
      isBackendPath(leftUrl.pathname) &&
      isBackendPath(rightUrl.pathname) &&
      leftUrl.pathname === rightUrl.pathname &&
      leftUrl.search === rightUrl.search
    );
  } catch {
    return false;
  }
}

/**
 * @param {Record<string, unknown> | null} record
 * @param {string} key
 */
function readString(record, key) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Build the selectable headshot/logo list supplied by the embedding app.
 * @param {Record<string, unknown> | null} branding
 * @param {Record<string, unknown>[] | null} partners
 * @returns {BrandPhotoAsset[]}
 */
export function collectBrandPhotoAssets(branding, partners) {
  /** @type {BrandPhotoAsset[]} */
  const assets = [];
  const seen = new Set();

  /**
   * @param {string} id
   * @param {string} label
   * @param {string | null} url
   * @param {"headshot" | "logo"} kind
   */
  const add = (id, label, url, kind) => {
    const comparisonKey = url
      ? canonicalizeMediaUrlForComparison(url) || url
      : null;
    if (!url || !comparisonKey || seen.has(comparisonKey)) return;
    seen.add(comparisonKey);
    assets.push({ id, label, url, kind });
  };

  add("my-headshot", "My headshot", readString(branding, "headshotUrl"), "headshot");
  add("my-logo", "My logo", readString(branding, "logoUrl"), "logo");

  (partners || []).forEach((partner, index) => {
    const name =
      readString(partner, "name") ||
      readString(partner, "fullName") ||
      readString(partner, "company") ||
      "Partner";
    const id = readString(partner, "id") || String(index);
    add(
      `partner-${id}-headshot`,
      `${name} headshot`,
      readString(partner, "headshotUrl"),
      "headshot"
    );
    add(
      `partner-${id}-logo`,
      `${name} logo`,
      readString(partner, "logoUrl"),
      "logo"
    );
  });

  return assets;
}
