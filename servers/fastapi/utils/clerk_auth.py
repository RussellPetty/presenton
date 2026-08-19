"""Verify Clerk-issued JWTs (RS256) against the issuing Clerk instance's JWKS.

Used when AUTH_MODE=clerk (iframe embedding). Supports MULTIPLE Clerk instances
(comma-separated CLERK_ISSUER) — e.g. a dev instance for the local broker app and
a prod custom-domain instance — by verifying each token against the JWKS of its
own `iss`, but only if that `iss` is in the configured allow-list.

`jwt` (PyJWT) is imported lazily so this module imports cleanly in single-user /
DISABLE_AUTH deployments that never call into Clerk verification.
"""

import threading
from typing import Optional

from utils.get_env import (
    get_clerk_audience_env,
    get_clerk_authorized_parties_env,
    get_clerk_issuers,
    get_clerk_jwks_url_env,
)

# One PyJWKClient per JWKS URL (each caches signing keys by `kid`).
_jwk_clients: dict[str, object] = {}
_jwk_clients_lock = threading.Lock()


def _client_for(jwks_url: str):
    client = _jwk_clients.get(jwks_url)
    if client is not None:
        return client
    with _jwk_clients_lock:
        client = _jwk_clients.get(jwks_url)
        if client is None:
            from jwt import PyJWKClient

            client = PyJWKClient(jwks_url, cache_keys=True)
            _jwk_clients[jwks_url] = client
    return client


def _jwks_url_for(iss: str) -> str:
    # Explicit override only makes sense for a single issuer; otherwise derive
    # per-issuer (Clerk serves JWKS at {frontend-api}/.well-known/jwks.json).
    explicit = get_clerk_jwks_url_env()
    if explicit:
        return explicit
    return f"{iss.rstrip('/')}/.well-known/jwks.json"


def verify_clerk_token(token: Optional[str]) -> Optional[str]:
    """Validate a Clerk JWT and return its `sub` (Clerk user id), or None.

    Returns None (never raises) on any failure — missing config, untrusted issuer,
    unknown key, bad signature, wrong audience, expiry, or an unauthorized party —
    so the caller can respond with a clean 401."""
    if not token:
        return None

    try:
        import jwt

        unverified = jwt.decode(token, options={"verify_signature": False})
    except Exception:
        return None

    iss = unverified.get("iss")
    allowed = {a.rstrip("/") for a in get_clerk_issuers()}
    if not allowed or not isinstance(iss, str) or iss.rstrip("/") not in allowed:
        return None
    iss = iss.rstrip("/")

    try:
        signing_key = _client_for(_jwks_url_for(iss)).get_signing_key_from_jwt(token)

        options = {"require": ["exp", "sub"]}
        decode_kwargs = {
            "algorithms": ["RS256"],
            "leeway": 30,
            "options": options,
            "issuer": iss,
        }
        audience = get_clerk_audience_env()
        if audience:
            decode_kwargs["audience"] = audience
        else:
            options["verify_aud"] = False

        claims = jwt.decode(token, signing_key.key, **decode_kwargs)
    except Exception:
        return None

    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        return None

    authorized_parties = get_clerk_authorized_parties_env()
    if authorized_parties:
        azp = claims.get("azp")
        if azp is not None and azp not in authorized_parties:
            return None

    return sub
