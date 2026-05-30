"""Unit tests for Clerk JWT verification (utils.clerk_auth.verify_clerk_token).

Uses a locally generated RSA keypair and stubs the JWKS client so no network is
involved — we only exercise the claim/signature validation logic."""

import time

import pytest

jwt = pytest.importorskip("jwt")
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402

import utils.clerk_auth as clerk_auth  # noqa: E402

ISSUER = "https://example.clerk.accounts.dev"


@pytest.fixture
def keypair():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def stub_jwks(monkeypatch, keypair):
    """Point verify_clerk_token at the test public key instead of real JWKS."""

    class _SigningKey:
        def __init__(self, key):
            self.key = key

    class _Client:
        def __init__(self, key):
            self._key = key

        def get_signing_key_from_jwt(self, _token):
            return _SigningKey(self._key)

    monkeypatch.setattr(
        clerk_auth, "_client_for", lambda _url: _Client(keypair.public_key())
    )
    return keypair


def _make_token(private_key, **overrides):
    claims = {
        "sub": "user_abc123",
        "iss": ISSUER,
        "exp": int(time.time()) + 300,
        **overrides,
    }
    return jwt.encode(
        claims, private_key, algorithm="RS256", headers={"kid": "test-key"}
    )


def test_valid_token_returns_sub(monkeypatch, stub_jwks):
    monkeypatch.setenv("CLERK_ISSUER", ISSUER)
    monkeypatch.delenv("CLERK_AUDIENCE", raising=False)
    monkeypatch.delenv("CLERK_AUTHORIZED_PARTIES", raising=False)

    token = _make_token(stub_jwks)
    assert clerk_auth.verify_clerk_token(token) == "user_abc123"


def test_expired_token_rejected(monkeypatch, stub_jwks):
    monkeypatch.setenv("CLERK_ISSUER", ISSUER)
    token = _make_token(stub_jwks, exp=int(time.time()) - 60)
    assert clerk_auth.verify_clerk_token(token) is None


def test_wrong_issuer_rejected(monkeypatch, stub_jwks):
    monkeypatch.setenv("CLERK_ISSUER", "https://attacker.example.com")
    token = _make_token(stub_jwks)  # iss = ISSUER, mismatch
    assert clerk_auth.verify_clerk_token(token) is None


def test_bad_signature_rejected(monkeypatch, stub_jwks):
    monkeypatch.setenv("CLERK_ISSUER", ISSUER)
    # Sign with a DIFFERENT key than the stubbed JWKS public key.
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = _make_token(other_key)
    assert clerk_auth.verify_clerk_token(token) is None


def test_missing_sub_rejected(monkeypatch, stub_jwks):
    monkeypatch.setenv("CLERK_ISSUER", ISSUER)
    # `require: [exp, sub]` makes PyJWT reject a token without `sub`.
    claims = {"iss": ISSUER, "exp": int(time.time()) + 300}
    token = jwt.encode(
        claims, stub_jwks, algorithm="RS256", headers={"kid": "test-key"}
    )
    assert clerk_auth.verify_clerk_token(token) is None


def test_audience_enforced_when_configured(monkeypatch, stub_jwks):
    monkeypatch.setenv("CLERK_ISSUER", ISSUER)
    monkeypatch.setenv("CLERK_AUDIENCE", "presenton")

    ok = _make_token(stub_jwks, aud="presenton")
    assert clerk_auth.verify_clerk_token(ok) == "user_abc123"

    wrong = _make_token(stub_jwks, aud="something-else")
    assert clerk_auth.verify_clerk_token(wrong) is None


def test_authorized_party_allowlist(monkeypatch, stub_jwks):
    monkeypatch.setenv("CLERK_ISSUER", ISSUER)
    monkeypatch.setenv("CLERK_AUTHORIZED_PARTIES", "https://app.broker.com, https://x.com")

    ok = _make_token(stub_jwks, azp="https://app.broker.com")
    assert clerk_auth.verify_clerk_token(ok) == "user_abc123"

    bad = _make_token(stub_jwks, azp="https://evil.com")
    assert clerk_auth.verify_clerk_token(bad) is None


def test_untrusted_issuer_rejected(monkeypatch, stub_jwks):
    # A valid token whose iss isn't in CLERK_ISSUER is rejected before key lookup.
    monkeypatch.setenv("CLERK_ISSUER", "https://other.clerk.accounts.dev")
    token = _make_token(stub_jwks)  # iss = ISSUER, not in the allow-list
    assert clerk_auth.verify_clerk_token(token) is None


def test_malformed_token_returns_none(monkeypatch):
    monkeypatch.setenv("CLERK_ISSUER", "https://example.clerk.accounts.dev")
    assert clerk_auth.verify_clerk_token("not-a-jwt") is None


def test_empty_token_returns_none():
    assert clerk_auth.verify_clerk_token(None) is None
    assert clerk_auth.verify_clerk_token("") is None
