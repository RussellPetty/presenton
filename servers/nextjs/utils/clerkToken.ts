"use client";

/**
 * Clerk auth bridge for the embedded (broker-marketplace) deployment.
 *
 * The broker renders Presenton in an iframe with `?embed=clerk` (and optional
 * `?parentOrigin=https://app.broker...`) and posts the Clerk JWT in via
 * window.postMessage. This module receives/refreshes that token and exposes it
 * so every FastAPI call can send `Authorization: Bearer <token>`.
 *
 * Standalone / DISABLE_AUTH deployments do NOT set `?embed=clerk`, so the bridge
 * is a no-op and `getToken()` resolves to null — callers then send no bearer and
 * rely on same-origin / disabled-auth, exactly as before. Real security is the
 * server-side JWT verification; the postMessage origin check is defense-in-depth.
 */

export type PresentonBranding = {
  primaryColor?: string;
  backgroundColor?: string;
  logoUrl?: string;
  fontHeading?: string;
  fontBody?: string;
};

const EMBED_FLAG_KEY = "presenton_embed_clerk";
const PARENT_ORIGIN_KEY = "presenton_parent_origin";

let _token: string | null = null;
let _expEpochMs: number | null = null;
let _initialized = false;
let _branding: PresentonBranding | null = null;
let _brandingHandler: ((b: PresentonBranding) => void) | null = null;
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
const _waiters: Array<(t: string | null) => void> = [];

function readSearchParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

/** True when running embedded under Clerk auth (sticky across reloads). */
export function isEmbedClerkMode(): boolean {
  if (typeof window === "undefined") return false;
  if (readSearchParam("embed") === "clerk") {
    try {
      window.sessionStorage.setItem(EMBED_FLAG_KEY, "1");
      const po = readSearchParam("parentOrigin");
      if (po) window.sessionStorage.setItem(PARENT_ORIGIN_KEY, po);
    } catch {
      /* sessionStorage may be unavailable; URL param still drives this load */
    }
    return true;
  }
  try {
    return window.sessionStorage.getItem(EMBED_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function parentOrigin(): string | null {
  const fromUrl = readSearchParam("parentOrigin");
  if (fromUrl) return fromUrl;
  try {
    return window.sessionStorage.getItem(PARENT_ORIGIN_KEY);
  } catch {
    return null;
  }
}

function decodeExpEpochMs(jwt: string): number | null {
  try {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function tokenValid(): boolean {
  return !!_token && (_expEpochMs == null || _expEpochMs - Date.now() > 5000);
}

function postToParent(message: unknown) {
  if (typeof window === "undefined" || window.parent === window) return;
  try {
    window.parent.postMessage(message, parentOrigin() || "*");
  } catch {
    /* ignore */
  }
}

function scheduleRefresh() {
  if (typeof window === "undefined" || _expEpochMs == null) return;
  if (_refreshTimer) clearTimeout(_refreshTimer);
  const delay = Math.max(5000, _expEpochMs - Date.now() - 60000); // ~60s before expiry
  _refreshTimer = setTimeout(() => postToParent({ type: "presenton-token-request" }), delay);
}

function setToken(token: string, expiresAtEpochSec?: number) {
  _token = token;
  _expEpochMs = expiresAtEpochSec ? expiresAtEpochSec * 1000 : decodeExpEpochMs(token);
  while (_waiters.length) {
    const w = _waiters.shift();
    if (w) w(token);
  }
  scheduleRefresh();
}

/** Register a callback for branding pushed by the parent (idempotent-friendly). */
export function onBranding(handler: (b: PresentonBranding) => void) {
  _brandingHandler = handler;
  if (_branding) handler(_branding);
}

/** Start listening for the parent's Clerk token. No-op when not embedded. */
export function initClerkAuthBridge() {
  if (_initialized || typeof window === "undefined") return;
  _initialized = true;
  if (!isEmbedClerkMode()) return;

  window.addEventListener("message", (event: MessageEvent) => {
    const expected = parentOrigin();
    if (expected && event.origin !== expected) return; // origin allow-list
    if (event.source && event.source !== window.parent) return; // only the embedding parent
    const data = event.data as
      | { type?: string; token?: unknown; expiresAt?: unknown; branding?: unknown }
      | null;
    if (!data || typeof data !== "object") return;
    if (data.type === "presenton-auth" && typeof data.token === "string") {
      setToken(
        data.token,
        typeof data.expiresAt === "number" ? data.expiresAt : undefined
      );
      if (data.branding && typeof data.branding === "object") {
        _branding = data.branding as PresentonBranding;
        if (_brandingHandler) _brandingHandler(_branding);
      }
    }
  });

  postToParent({ type: "presenton-ready" }); // ask the parent to send the token
}

/** Current token if valid, else null (for EventSource URLs that can't send headers). */
export function getTokenSync(): string | null {
  return tokenValid() ? _token : null;
}

/**
 * Resolve the current Clerk token. Returns null immediately when not embedded
 * (standalone) so callers attach no Authorization header. When embedded, returns
 * a valid token, waiting (bounded) for the parent to deliver one.
 */
export async function getToken(): Promise<string | null> {
  if (typeof window === "undefined" || !isEmbedClerkMode()) return null;
  if (tokenValid()) return _token;
  postToParent({ type: "presenton-token-request" });
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const done = (t: string | null) => {
      if (!settled) {
        settled = true;
        resolve(t);
      }
    };
    _waiters.push(done);
    setTimeout(() => done(_token), 8000); // don't hang forever if the parent is silent
  });
}
