"""Preserve Gemini "thought signatures" across tool-call rounds in llmai.

Gemini 3 "thinking" models (e.g. ``gemini-3.1-flash-lite``) attach a
``thought_signature`` to each ``functionCall`` part they emit. The Gemini API
**requires** those signatures to be echoed back verbatim when the assistant's
function-call turn is replayed in ``contents`` on the next request. Otherwise it
fails with:

    Function call is missing a thought_signature in functionCall parts ...

``llmai==0.2.5`` discards the signature both when it parses a response into its
own message objects and when it rebuilds ``contents`` via
``GooglePart.from_function_call``. Because ``llmai`` is a pinned PyPI dependency
(installed fresh in the Docker build), we cannot edit it directly, so we patch
``GoogleClient`` at runtime instead:

* Wrap the underlying google-genai ``generate_content`` /
  ``generate_content_stream`` so every ``functionCall`` part's
  ``thought_signature`` is captured on the client instance, keyed by
  ``(function name, canonical args)`` and ordered by appearance.
* Post-process ``_messages_to_google_messages`` so each outgoing ``functionCall``
  part is re-stamped with its captured signature (in document order, matching
  capture order).

The capture cache lives on each ``GoogleClient`` instance — and the chat service
creates one client per turn — so nothing leaks across turns or users. The patch
is idempotent and fully defensive: if ``llmai``/``google-genai`` internals change
shape it logs a warning and no-ops rather than breaking generation.
"""

from __future__ import annotations

import json
import logging
from typing import Any

LOGGER = logging.getLogger(__name__)

_PATCH_FLAG = "_presenton_thought_signature_patch"
_STORE_ATTR = "_presenton_thought_sig_by_call"


def _canonical_args(args: Any) -> str:
    """Stable key for a function call's arguments (order-independent)."""
    try:
        if isinstance(args, (bytes, bytearray)):
            args = args.decode("utf-8", "ignore")
        if isinstance(args, str):
            args = json.loads(args) if args.strip() else {}
        if not isinstance(args, dict):
            args = {}
        return json.dumps(args, sort_keys=True, ensure_ascii=False)
    except Exception:
        return "{}"


def _record_signatures(store: dict, response_or_event: Any) -> None:
    """Capture thought_signature for every functionCall part in a response/event."""
    try:
        for candidate in getattr(response_or_event, "candidates", None) or []:
            content = getattr(candidate, "content", None)
            for part in getattr(content, "parts", None) or []:
                function_call = getattr(part, "function_call", None)
                signature = getattr(part, "thought_signature", None)
                if not function_call or signature is None:
                    continue
                key = (
                    getattr(function_call, "name", None),
                    _canonical_args(getattr(function_call, "args", None)),
                )
                bucket = store.setdefault(key, [])
                # Streamed parts can repeat; only append genuinely new signatures.
                if not bucket or bucket[-1] != signature:
                    bucket.append(signature)
    except Exception:
        LOGGER.debug("thought-signature capture skipped", exc_info=True)


def apply() -> None:
    """Patch llmai's GoogleClient to preserve Gemini thought signatures.

    Safe to call multiple times; only the first call takes effect.
    """
    try:
        from llmai.google.client import GoogleClient
    except Exception:
        LOGGER.warning(
            "llmai GoogleClient unavailable; thought-signature patch not applied",
            exc_info=True,
        )
        return

    if getattr(GoogleClient, _PATCH_FLAG, False):
        return

    if not hasattr(GoogleClient, "__init__") or not hasattr(
        GoogleClient, "_messages_to_google_messages"
    ):
        LOGGER.warning(
            "llmai GoogleClient shape unexpected; thought-signature patch not applied"
        )
        return

    original_init = GoogleClient.__init__
    original_messages_to_google = GoogleClient._messages_to_google_messages

    def patched_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        store: dict = {}
        setattr(self, _STORE_ATTR, store)
        try:
            models = self._client.models  # cached on the genai client instance
            original_generate = models.generate_content
            original_generate_stream = models.generate_content_stream

            def generate_content_with_capture(*a, **kw):
                response = original_generate(*a, **kw)
                _record_signatures(store, response)
                return response

            def generate_content_stream_with_capture(*a, **kw):
                for event in original_generate_stream(*a, **kw):
                    _record_signatures(store, event)
                    yield event

            models.generate_content = generate_content_with_capture
            models.generate_content_stream = generate_content_stream_with_capture
        except Exception:
            LOGGER.warning(
                "Could not wrap google-genai for thought-signature capture",
                exc_info=True,
            )

    def patched_messages_to_google(self, messages):
        contents = original_messages_to_google(self, messages)
        store = getattr(self, _STORE_ATTR, None)
        if not store:
            return contents
        try:
            cursor: dict = {}
            for content in contents:
                if getattr(content, "role", None) != "model":
                    continue
                for part in getattr(content, "parts", None) or []:
                    function_call = getattr(part, "function_call", None)
                    if not function_call:
                        continue
                    if getattr(part, "thought_signature", None):
                        continue
                    key = (
                        getattr(function_call, "name", None),
                        _canonical_args(getattr(function_call, "args", None)),
                    )
                    signatures = store.get(key)
                    if not signatures:
                        continue
                    index = cursor.get(key, 0)
                    signature = (
                        signatures[index]
                        if index < len(signatures)
                        else signatures[-1]
                    )
                    cursor[key] = index + 1
                    part.thought_signature = signature
        except Exception:
            LOGGER.debug("thought-signature replay skipped", exc_info=True)
        return contents

    GoogleClient.__init__ = patched_init
    GoogleClient._messages_to_google_messages = patched_messages_to_google
    setattr(GoogleClient, _PATCH_FLAG, True)
    LOGGER.info("Applied llmai GoogleClient thought-signature preservation patch")
