"""The `?token=` query parameter must only authenticate SSE endpoints.

EventSource cannot set request headers, so the streaming routes accept the token
in the query string. That is a deliberate, narrow exception: query strings are
captured by access logs, proxies and browser history in a way that Authorization
headers are not, so it must not become a general way to authenticate the API.
"""

from types import SimpleNamespace

import pytest

from api.v1.auth.principal import _bearer_token, _token_in_query_allowed


def _request(path: str, query: dict | None = None, headers: dict | None = None):
    return SimpleNamespace(
        url=SimpleNamespace(path=path),
        query_params=query or {},
        headers=headers or {},
    )


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/ppt/presentation/stream/2f1c8e4a-0000-4000-8000-000000000000",
        "/api/v2/ppt/presentation/stream/2f1c8e4a-0000-4000-8000-000000000000",
        "/api/v1/ppt/outlines/stream/2f1c8e4a-0000-4000-8000-000000000000",
        "/api/v1/ppt/outlines/stream/abc/",
    ],
)
def test_streaming_paths_allow_token_in_query(path):
    assert _token_in_query_allowed(_request(path)) is True
    assert _bearer_token(_request(path, {"token": "tok"})) == "tok"


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/ppt/presentation/all",
        "/api/v1/ppt/presentation/2f1c8e4a-0000-4000-8000-000000000000",
        "/api/v1/ppt/template/all",
        "/api/v1/auth/status",
        "/app_data/exports/deck.pdf",
        "/api/v1/ppt/presentation/stream/abc/extra",
        "/api/v1/ppt/images/stream/abc",
        "/api/v1/ppt/presentation/streamer/abc",
        "/evil/api/v1/ppt/presentation/stream/abc",
    ],
)
def test_other_paths_reject_token_in_query(path):
    assert _token_in_query_allowed(_request(path)) is False
    assert _bearer_token(_request(path, {"token": "tok"})) is None


def test_authorization_header_still_works_everywhere():
    req = _request(
        "/api/v1/ppt/presentation/all",
        headers={"Authorization": "Bearer header-token"},
    )
    assert _bearer_token(req) == "header-token"


def test_header_takes_precedence_over_query_on_streaming_paths():
    req = _request(
        "/api/v1/ppt/outlines/stream/abc",
        query={"token": "query-token"},
        headers={"Authorization": "Bearer header-token"},
    )
    assert _bearer_token(req) == "header-token"


def test_blank_token_is_not_accepted():
    req = _request("/api/v1/ppt/outlines/stream/abc", {"token": "   "})
    assert _bearer_token(req) is None


def test_missing_authorization_and_query_yields_none():
    assert _bearer_token(_request("/api/v1/ppt/outlines/stream/abc")) is None
