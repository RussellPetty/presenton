"""Verification tests for Clerk-issued JWTs (AUTH_MODE=clerk).

These exercise utils.clerk_auth.verify_clerk_token against a locally generated
RSA keypair, with the JWKS served from an in-process stub. That covers the happy
path as well as the rejections that actually carry the security weight: an
issuer outside the allow-list, a signature from the wrong key, a missing
subject, and expiry.
"""

import json
import time

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

jwt = pytest.importorskip("jwt")

from jwt.utils import base64url_encode  # noqa: E402

import utils.clerk_auth as clerk_auth  # noqa: E402


ISSUER = "https://trusted-instance.clerk.accounts.dev"
UNTRUSTED_ISSUER = "https://attacker-instance.clerk.accounts.dev"
KEY_ID = "test-key-1"


def _new_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _jwks_entry(private_key: rsa.RSAPrivateKey, kid: str = KEY_ID) -> dict:
    numbers = private_key.public_key().public_numbers()
    to_b64 = lambda value, length: base64url_encode(  # noqa: E731
        value.to_bytes(length, "big")
    ).decode()
    return {
        "kty": "RSA",
        "kid": kid,
        "alg": "RS256",
        "use": "sig",
        "n": to_b64(numbers.n, (numbers.n.bit_length() + 7) // 8),
        "e": to_b64(numbers.e, (numbers.e.bit_length() + 7) // 8),
    }


def _sign(private_key: rsa.RSAPrivateKey, claims: dict, kid: str = KEY_ID) -> str:
    return jwt.encode(
        claims, private_key, algorithm="RS256", headers={"kid": kid}
    )


def _claims(**overrides) -> dict:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "sub": "user_2abcdefghijklmnop",
        "iat": now,
        "exp": now + 300,
    }
    claims.update(overrides)
    return claims


@pytest.fixture
def signing_key() -> rsa.RSAPrivateKey:
    return _new_key()


@pytest.fixture(autouse=True)
def clerk_env(monkeypatch, signing_key):
    """Trust exactly one issuer and serve its JWKS from memory."""
    monkeypatch.setenv("AUTH_MODE", "clerk")
    monkeypatch.setenv("CLERK_ISSUER", ISSUER)
    monkeypatch.delenv("CLERK_AUDIENCE", raising=False)
    monkeypatch.delenv("CLERK_JWKS_URL", raising=False)
    monkeypatch.delenv("CLERK_AUTHORIZED_PARTIES", raising=False)

    jwks = {"keys": [_jwks_entry(signing_key)]}

    class _StubJWKClient:
        def __init__(self, url, **kwargs):
            self.url = url

        def get_signing_key_from_jwt(self, token):
            header = jwt.get_unverified_header(token)
            for key in jwks["keys"]:
                if key["kid"] == header.get("kid"):
                    return jwt.PyJWK(key, algorithm="RS256")
            raise jwt.PyJWKClientError("no matching key")

    # Only the trusted issuer's JWKS exists; anything else 404s the same way a
    # real unknown instance would.
    monkeypatch.setattr(clerk_auth, "_jwk_clients", {})
    monkeypatch.setattr(clerk_auth, "_unknown_kids", {})
    monkeypatch.setitem(
        clerk_auth.__dict__, "_client_for", lambda url: _StubJWKClient(url)
    )
    yield


def test_valid_token_returns_subject(signing_key):
    token = _sign(signing_key, _claims())
    assert clerk_auth.verify_clerk_token(token) == "user_2abcdefghijklmnop"


def test_untrusted_issuer_is_rejected(signing_key):
    """The allow-list is the trust boundary: a well-formed token from an
    instance we do not trust must not authenticate."""
    token = _sign(signing_key, _claims(iss=UNTRUSTED_ISSUER))
    assert clerk_auth.verify_clerk_token(token) is None


def test_signature_from_another_key_is_rejected(signing_key):
    attacker_key = _new_key()
    token = _sign(attacker_key, _claims())
    assert clerk_auth.verify_clerk_token(token) is None


def test_unsigned_token_is_rejected():
    token = jwt.encode(_claims(), key="", algorithm="none")
    assert clerk_auth.verify_clerk_token(token) is None


def test_expired_token_is_rejected(signing_key):
    now = int(time.time())
    token = _sign(signing_key, _claims(iat=now - 7200, exp=now - 3600))
    assert clerk_auth.verify_clerk_token(token) is None


def test_missing_subject_is_rejected(signing_key):
    claims = _claims()
    claims.pop("sub")
    token = _sign(signing_key, claims)
    assert clerk_auth.verify_clerk_token(token) is None


def test_missing_expiry_is_rejected(signing_key):
    claims = _claims()
    claims.pop("exp")
    token = _sign(signing_key, claims)
    assert clerk_auth.verify_clerk_token(token) is None


def test_empty_and_none_tokens_are_rejected():
    assert clerk_auth.verify_clerk_token(None) is None
    assert clerk_auth.verify_clerk_token("") is None
    assert clerk_auth.verify_clerk_token("not-a-jwt") is None


def test_no_configured_issuer_rejects_everything(monkeypatch, signing_key):
    """Fail closed: with CLERK_ISSUER unset nothing may authenticate."""
    monkeypatch.setenv("CLERK_ISSUER", "")
    token = _sign(signing_key, _claims())
    assert clerk_auth.verify_clerk_token(token) is None


def test_audience_is_enforced_when_configured(monkeypatch, signing_key):
    monkeypatch.setenv("CLERK_AUDIENCE", "presenton")
    assert clerk_auth.verify_clerk_token(_sign(signing_key, _claims())) is None
    ok = _sign(signing_key, _claims(aud="presenton"))
    assert clerk_auth.verify_clerk_token(ok) == "user_2abcdefghijklmnop"


def test_authorized_parties_allow_list(monkeypatch, signing_key):
    monkeypatch.setenv("CLERK_AUTHORIZED_PARTIES", "https://app.example.com")
    blocked = _sign(signing_key, _claims(azp="https://evil.example.com"))
    assert clerk_auth.verify_clerk_token(blocked) is None
    allowed = _sign(signing_key, _claims(azp="https://app.example.com"))
    assert clerk_auth.verify_clerk_token(allowed) == "user_2abcdefghijklmnop"


def test_trailing_slash_in_configured_issuer_still_matches(
    monkeypatch, signing_key
):
    monkeypatch.setenv("CLERK_ISSUER", f"{ISSUER}/")
    token = _sign(signing_key, _claims())
    assert clerk_auth.verify_clerk_token(token) == "user_2abcdefghijklmnop"


def test_multiple_issuers_are_supported(monkeypatch, signing_key):
    """Dev and prod Clerk instances are both embedded, so the allow-list is a
    comma-separated list and each token verifies against its own issuer."""
    monkeypatch.setenv("CLERK_ISSUER", f"{UNTRUSTED_ISSUER},{ISSUER}")
    token = _sign(signing_key, _claims())
    assert clerk_auth.verify_clerk_token(token) == "user_2abcdefghijklmnop"


def test_unknown_kid_is_negative_cached(monkeypatch, signing_key):
    """An unknown `kid` must not cause a JWKS fetch on every attempt.

    PyJWKClient refetches the whole key set on a miss and never remembers it,
    and the `kid` is attacker-chosen, so without this a stream of junk tokens
    becomes a stream of upstream requests on a single-worker server."""
    fetches = {"count": 0}

    class _CountingClient:
        def __init__(self, url, **kwargs):
            self.url = url

        def get_signing_key_from_jwt(self, token):
            fetches["count"] += 1
            raise jwt.PyJWKClientError("no matching key")

    monkeypatch.setitem(
        clerk_auth.__dict__, "_client_for", lambda url: _CountingClient(url)
    )

    token = _sign(signing_key, _claims(), kid="attacker-chosen-kid")
    for _ in range(5):
        assert clerk_auth.verify_clerk_token(token) is None

    assert fetches["count"] == 1, (
        f"expected one JWKS lookup, got {fetches['count']}"
    )


def test_negative_cache_expires(monkeypatch, signing_key):
    monkeypatch.setattr(clerk_auth, "_UNKNOWN_KID_TTL_SECONDS", 0)
    token = _sign(signing_key, _claims(), kid="transient-kid")
    assert clerk_auth.verify_clerk_token(token) is None
    # TTL of zero means the entry is already stale, so a later real rotation of
    # the issuer's keys is picked up rather than being cached as broken.
    assert clerk_auth._kid_recently_unknown("https://x/jwks.json", "transient-kid") is False


def test_token_without_kid_is_rejected(signing_key):
    token = jwt.encode(_claims(), signing_key, algorithm="RS256")
    assert clerk_auth.verify_clerk_token(token) is None
