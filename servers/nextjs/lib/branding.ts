/**
 * Product naming for the white-label build.
 *
 * The app is embedded inside Broker Marketplace, so the upstream product name
 * must not appear anywhere a user can see it: page titles, tab titles, toasts,
 * empty states, alt text, or error copy. Everything user-facing reads from
 * here, so there is one place to change it and one thing to grep for.
 *
 * Internal identifiers are deliberately untouched — cookie names, localStorage
 * keys, `presenton_session`, module paths and the `presenton` provider enum all
 * keep their names, because renaming them would break sessions and stored state
 * without changing anything a user sees.
 */

export const PRODUCT_NAME =
  process.env.NEXT_PUBLIC_PRODUCT_NAME?.trim() || "Presentation AI";

export const PRODUCT_TAGLINE =
  process.env.NEXT_PUBLIC_PRODUCT_TAGLINE?.trim() ||
  "AI presentation generator";

/** `Foo | Presentation AI` — for per-page <title>s. */
export function pageTitle(section?: string): string {
  return section ? `${section} | ${PRODUCT_NAME}` : PRODUCT_NAME;
}
