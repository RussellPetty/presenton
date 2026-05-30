# Broker-Marketplace ⇄ Presentation AI (Presenton) integration spec

How to embed the deployed Presenton service in broker-marketplace's Design Studio
as the **"Presentation AI"** page, authenticated with the broker's Clerk session.

- Presenton URL: `https://presenton-production-60a3.up.railway.app` (or your custom subdomain)
- Auth model: broker mints a short-lived **Clerk JWT** and posts it into the iframe
  via `postMessage`; Presenton verifies it server-side against Clerk's JWKS and scopes
  all data to the Clerk user (`sub`). No third-party cookies.
- Everything on the Presenton side is built and deployed; this doc is the **broker-side**
  work + the env flip that turns Clerk auth on.

---

## 1. Clerk JWT template (Clerk dashboard)

Create a JWT template (e.g. named `presenton`) on the **same Clerk instance** broker-marketplace
uses (`clerk.broker-marketplace.com`). Required claims: `sub` (the Clerk user id — becomes
the Presenton owner), `exp`, `iss`. Default Clerk session-token lifetime (~60s) is fine.

Optional hardening (must match Presenton env if set):
- `aud` claim → set `CLERK_AUDIENCE` on Presenton.
- restrict `azp` to the broker origin → set `CLERK_AUTHORIZED_PARTIES` on Presenton.

## 2. Render the iframe (the "Presentation AI" Design Studio page)

```tsx
const PRESENTON_ORIGIN = "https://presenton-production-60a3.up.railway.app";
const BROKER_ORIGIN = window.location.origin; // e.g. https://app.broker-marketplace.com

<iframe
  ref={iframeRef}
  src={`${PRESENTON_ORIGIN}/upload?embed=clerk&parentOrigin=${encodeURIComponent(BROKER_ORIGIN)}`}
  style={{ width: "100%", height: "100%", border: 0 }}
  allow="clipboard-write"
/>
```

- `embed=clerk` puts Presenton in Clerk mode (skips its own login UI, sends the bearer,
  passes the token on SSE). It's sticky across in-iframe navigation.
- `parentOrigin` is the origin Presenton validates incoming `postMessage`s against and
  targets its outgoing ones to.

## 3. postMessage bridge (broker side, React)

Presenton drives a tiny handshake. The broker listens and replies with the Clerk token
(+ optional branding). Messages, by `type`:

- **iframe → broker**: `{ type: "presenton-ready" }` (on load) and
  `{ type: "presenton-token-request" }` (initial + ~60s before expiry).
- **broker → iframe**: `{ type: "presenton-auth", token, expiresAt?, branding? }`.

```tsx
import { useAuth } from "@clerk/nextjs";

function usePresentonBridge(iframeRef, presentonOrigin) {
  const { getToken } = useAuth();

  useEffect(() => {
    async function sendToken() {
      const token = await getToken({ template: "presenton" });
      if (!token) return;
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "presenton-auth",
          token,
          // expiresAt: <epoch seconds> // optional; Presenton also reads exp from the JWT
          branding: await getBrokerBranding(), // see §4 (optional)
        },
        presentonOrigin
      );
    }

    function onMessage(e: MessageEvent) {
      if (e.origin !== presentonOrigin) return;
      if (e.data?.type === "presenton-ready" || e.data?.type === "presenton-token-request") {
        sendToken();
      }
    }
    window.addEventListener("message", onMessage);
    // Belt-and-suspenders: also push a fresh token on an interval < token lifetime.
    const iv = setInterval(sendToken, 45_000);
    return () => { window.removeEventListener("message", onMessage); clearInterval(iv); };
  }, [iframeRef, presentonOrigin, getToken]);
}
```

`getToken({ template })` auto-refreshes under the hood; the broker just needs to (re)send on
`presenton-token-request` and on its own interval. Always post with `targetOrigin = presentonOrigin`.

## 4. Branding → auto theme (optional, task #13)

Include a `branding` object in `presenton-auth` and Presenton will auto-create/apply the
user's custom theme. Pull these from the org's Clerk metadata / your brand settings:

```ts
branding: {
  primaryColor: "#006d21",     // hex
  backgroundColor: "#f2f7ff",  // hex
  logoUrl: "https://.../logo.png",
  fontHeading: "Inter",
  fontBody: "Inter",
}
```

(The Presenton side that consumes `branding` lands with task #13; the contract is fixed here.)

## 5. Turn Clerk auth on (Presenton Railway env)

Currently the service runs with `DISABLE_AUTH=true` (single shared `local` user) for validation.
To go multi-tenant with Clerk, set on the `presenton` Railway service and redeploy:

| Var | Value |
|-----|-------|
| `AUTH_MODE` | `clerk` |
| `CLERK_ISSUER` | `https://clerk.broker-marketplace.com` |
| `CLERK_JWKS_URL` | (optional) defaults to `${CLERK_ISSUER}/.well-known/jwks.json` |
| `CLERK_AUDIENCE` / `CLERK_AUTHORIZED_PARTIES` | only if the JWT template sets them |
| `INTERNAL_API_SECRET` | already set (used by MCP / export / template SSR) |
| `DISABLE_AUTH` | **remove it** |

Then each broker user gets their own presentations/templates/themes; the `local` data from the
validation phase stays under the `local` user (invisible to Clerk users).

## 6. Iframe hardening (optional, recommended)

Restrict who may frame Presenton by adding a CSP `frame-ancestors` header (nginx, all routes):

```
add_header Content-Security-Policy "frame-ancestors 'self' https://app.broker-marketplace.com" always;
```

(There is no `X-Frame-Options` set, so embedding works today; this just locks it to the broker.)

## 7. End-to-end validation checklist

1. Set the Clerk env (§5) + redeploy; confirm `/api/v1/auth/status` with no token now reports unauthenticated.
2. Open the Design Studio "Presentation AI" page as a logged-in broker user → iframe loads (no Presenton login).
3. Generate a deck → it appears only for that user; a second user sees only their own.
4. (If §4 wired) the user's brand colors/logo are pre-applied as a custom theme.
5. Export a deck → downloads correctly.

## Contract summary (what each side owns)

- **Presenton (done):** verifies the Clerk JWT (JWKS), scopes all data by `sub`, embed-gated
  frontend bridge, SSE `?token=`, internal-service auth, white-labeled UI.
- **Broker (this doc):** Clerk JWT template, iframe with `?embed=clerk&parentOrigin=`, postMessage
  token bridge (+ optional branding), the env flip, optional CSP.
