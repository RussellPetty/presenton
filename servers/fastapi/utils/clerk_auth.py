"""Verify Clerk-issued JWTs (RS256) against the issuing Clerk instance's JWKS.

Used when AUTH_MODE=clerk (iframe embedding). Supports MULTIPLE Clerk instances
(comma-separated CLERK_ISSUER) — e.g. a dev instance for the local broker app and
a prod custom-domain instance — by verifying each token against the JWKS of its
own `iss`, but only if that `iss` is in the configured allow-list.

`jwt` (PyJWT) is imported lazily so this module imports cleanly in single-user /
DISABLE_AUTH deployments that never call into Clerk verification.
"""

import threading
import time
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

# PyJWKClient refetches the whole JWKS whenever a `kid` misses, and a miss is
# never remembered. Unauthenticated callers choose the `kid`, so without a
# negative cache a trickle of junk tokens turns into one upstream fetch each —
# on a single-worker uvicorn that is enough to stall the event loop, and a slow
# or unreachable JWKS host makes each one cost the full timeout.
_JWKS_TIMEOUT_SECONDS = 5
_UNKNOWN_KID_TTL_SECONDS = 300
_unknown_kids: dict[tuple[str, str], float] = {}
_unknown_kids_lock = threading.Lock()


def _client_for(jwks_url: str):
    client = _jwk_clients.get(jwks_url)
    if client is not None:
        return client
    with _jwk_clients_lock:
        client = _jwk_clients.get(jwks_url)
        if client is None:
            from jwt import PyJWKClient

            client = PyJWKClient(
                jwks_url, cache_keys=True, timeout=_JWKS_TIMEOUT_SECONDS
            )
            _jwk_clients[jwks_url] = client
    return client


def _kid_recently_unknown(jwks_url: str, kid: str) -> bool:
    with _unknown_kids_lock:
        expires_at = _unknown_kids.get((jwks_url, kid))
        if expires_at is None:
            return False
        if expires_at <= time.monotonic():
            _unknown_kids.pop((jwks_url, kid), None)
            return False
        return True


def _remember_unknown_kid(jwks_url: str, kid: str) -> None:
    now = time.monotonic()
    with _unknown_kids_lock:
        # Opportunistically drop expired entries so a long-running process
        # cannot accumulate one entry per attacker-chosen kid forever.
        if len(_unknown_kids) > 1024:
            for key, expires_at in list(_unknown_kids.items()):
                if expires_at <= now:
                    _unknown_kids.pop(key, None)
        _unknown_kids[(jwks_url, kid)] = now + _UNKNOWN_KID_TTL_SECONDS


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

    jwks_url = _jwks_url_for(iss)
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except Exception:
        return None
    if not isinstance(kid, str) or not kid:
        return None
    if _kid_recently_unknown(jwks_url, kid):
        # Already looked this one up and the issuer did not have it; refuse
        # without hitting the network again.
        return None

    try:
        try:
            signing_key = _client_for(jwks_url).get_signing_key_from_jwt(token)
        except Exception:
            _remember_unknown_kid(jwks_url, kid)
            raise

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
