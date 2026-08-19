"""Tolerate models that narrate before emitting their JSON.

`response_format={"type": "json_schema"}` is a hard guarantee on the big hosted
APIs, so llmai calls `json.loads` on the whole assistant message. It is only a
strong hint on providers that wrap an agent CLI — our Cursor-subscription proxy
routes through `cursor-agent`, which reliably answers like this:

    I'll gather current homebuyer facts so the outline stays accurate.{"slides":[...]}

That is schema-correct JSON with a sentence glued to the front, and `json.loads`
fails at character 0, so an otherwise perfectly good generation is thrown away.

This installs a tolerant parse in front of llmai's strict one: unchanged when the
payload is already clean JSON, and otherwise it recovers the first balanced JSON
value in the text. Markdown fences are handled too, since models emit those just
as often.
"""

import json
import logging
from typing import Any, Optional

LOGGER = logging.getLogger(__name__)

_installed = False


def _strip_code_fences(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return text
    # ```json\n{...}\n```  ->  {...}
    body = stripped[3:]
    newline = body.find("\n")
    if newline != -1 and body[:newline].strip().isalpha():
        body = body[newline + 1 :]
    if body.rstrip().endswith("```"):
        body = body.rstrip()[:-3]
    return body


def _find_balanced(text: str, opener: str, closer: str) -> Optional[str]:
    """Return the first balanced opener/closer span, ignoring braces in strings."""
    start = text.find(opener)
    if start == -1:
        return None

    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def loads_tolerant(text: str) -> Any:
    """json.loads, falling back to the first embedded JSON value in the text."""
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        pass

    candidate = _strip_code_fences(text)
    try:
        return json.loads(candidate)
    except (ValueError, TypeError):
        pass

    for opener, closer in (("{", "}"), ("[", "]")):
        span = _find_balanced(candidate, opener, closer)
        if span:
            try:
                parsed = json.loads(span)
            except (ValueError, TypeError):
                continue
            LOGGER.info(
                "Recovered JSON from a narrated response (%d chars of preamble)",
                candidate.find(span[0]),
            )
            return parsed

    # Nothing recoverable: raise the original error so callers still see a
    # normal parse failure rather than a silent None.
    return json.loads(text)


def install_tolerant_json_parsing() -> None:
    """Wrap llmai's OpenAI-compatible client so structured output survives
    a chatty provider. Idempotent."""
    global _installed
    if _installed:
        return

    try:
        from llmai.openai.client import OpenAIClient
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("Could not install tolerant JSON parsing: %s", exc)
        return

    original = OpenAIClient._final_content

    def _tolerant_final_content(self, content, response_format):  # type: ignore[no-untyped-def]
        try:
            return original(self, content, response_format)
        except (ValueError, TypeError):
            text_content = self._assistant_content_to_openai_content(content)
            if not isinstance(text_content, str) or not text_content:
                raise
            return loads_tolerant(text_content)

    OpenAIClient._final_content = _tolerant_final_content  # type: ignore[method-assign]
    _installed = True
    LOGGER.info("Installed tolerant JSON parsing for OpenAI-compatible providers")
