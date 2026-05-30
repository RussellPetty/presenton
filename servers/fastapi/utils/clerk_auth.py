"""Verify Clerk-issued JWTs (RS256) against the Clerk instance's JWKS.

Used when AUTH_MODE=clerk (iframe embedding): broker-marketplace mints a
short-lived Clerk token, posts it into the Presenton iframe, and the frontend
sends it as `Authorization: Bearer <token>`. This module validates the
signature, issuer, expiry (and optionally audience / authorized party) and
returns the Clerk user id (`sub`), which becomes `request.state.external_user_id`.

`jwt` (PyJWT) is imported lazily so this module imports cleanly in single-user /
DISABLE_AUTH deployments that never call into Clerk verification.
"""

import threading
from typing import Optional

from utils.get_env import (
    get_clerk_audience_env,
    get_clerk_authorized_parties_env,
    get_clerk_issuer_env,
    get_clerk_jwks_url_env,
)

# PyJWKClient caches signing keys by `kid` in-memory; keep one instance per
# resolved JWKS URL so repeated verifications avoid network round-trips.
_jwk_client = None
_jwk_client_url: Optional[str] = None
_jwk_client_lock = threading.Lock()


def _resolve_jwks_url() -> Optional[str]:
    explicit = get_clerk_jwks_url_env()
    if explicit:
        return explicit
    issuer = get_clerk_issuer_env()
    if issuer:
        return f"{issuer}/.well-known/jwks.json"
    return None


def _get_jwk_client():
    """Return a cached PyJWKClient for the configured JWKS URL, or None if unset."""
    global _jwk_client, _jwk_client_url

    jwks_url = _resolve_jwks_url()
    if not jwks_url:
        return None

    if _jwk_client is not None and _jwk_client_url == jwks_url:
        return _jwk_client

    with _jwk_client_lock:
        if _jwk_client is None or _jwk_client_url != jwks_url:
            from jwt import PyJWKClient

            _jwk_client = PyJWKClient(jwks_url, cache_keys=True)
            _jwk_client_url = jwks_url

    return _jwk_client


def verify_clerk_token(token: Optional[str]) -> Optional[str]:
    """Validate a Clerk JWT and return its `sub` (Clerk user id), or None.

    Returns None (never raises) on any failure — missing config, unknown key,
    bad signature, wrong issuer/audience, expiry, or an unauthorized party —
    so the caller can respond with a clean 401."""
    if not token:
        return None

    client = _get_jwk_client()
    if client is None:
        return None

    try:
        import jwt

        signing_key = client.get_signing_key_from_jwt(token)

        options = {"require": ["exp", "sub"]}
        decode_kwargs = {
            "algorithms": ["RS256"],
            "leeway": 30,  # tolerate minor clock skew
            "options": options,
        }

        issuer = get_clerk_issuer_env()
        if issuer:
            decode_kwargs["issuer"] = issuer

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
