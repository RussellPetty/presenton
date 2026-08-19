"""Bound outbound LLM concurrency and survive provider rate limiting.

Upstream fires a whole batch of slides at the provider at once (batch_size=10 in
the generation endpoint) and never retries. That is fine against a hyperscaler,
but not against a small self-hosted gateway: the Cursor-subscription proxy we
route through caps concurrent requests and answers the overflow with HTTP 429,
which upstream would surface as a failed slide.

Two knobs, both opt-in so behaviour is unchanged when unset:

* ``LLM_MAX_CONCURRENCY`` — at most N in-flight provider calls process-wide.
* ``LLM_RATE_LIMIT_MAX_RETRIES`` — retry a rate-limited call with exponential
  backoff plus jitter.

The semaphore is created lazily and bound to the running loop, because this
module is imported at startup before the loop exists.
"""

import asyncio
import logging
import os
import random
import threading
from typing import Any, Callable, Optional, TypeVar

LOGGER = logging.getLogger(__name__)

T = TypeVar("T")

_DEFAULT_MAX_RETRIES = 4
_BASE_BACKOFF_SECONDS = 1.5
_MAX_BACKOFF_SECONDS = 20.0

_semaphore: Optional[asyncio.Semaphore] = None
_semaphore_loop: Optional[asyncio.AbstractEventLoop] = None
_semaphore_lock = threading.Lock()


def get_max_concurrency() -> int:
    """0 (the default) means unlimited, matching upstream behaviour."""
    raw = (os.getenv("LLM_MAX_CONCURRENCY") or "").strip()
    if not raw:
        return 0
    try:
        value = int(raw)
    except ValueError:
        LOGGER.warning("Ignoring non-numeric LLM_MAX_CONCURRENCY=%r", raw)
        return 0
    return value if value > 0 else 0


def get_max_retries() -> int:
    raw = (os.getenv("LLM_RATE_LIMIT_MAX_RETRIES") or "").strip()
    if not raw:
        return _DEFAULT_MAX_RETRIES
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_MAX_RETRIES
    return max(0, value)


def _get_semaphore() -> Optional[asyncio.Semaphore]:
    limit = get_max_concurrency()
    if limit <= 0:
        return None

    global _semaphore, _semaphore_loop
    loop = asyncio.get_running_loop()
    # A semaphore is bound to the loop that created it; rebuild it if the loop
    # changed (tests, or a worker restarting the loop) rather than deadlocking.
    if _semaphore is None or _semaphore_loop is not loop:
        with _semaphore_lock:
            if _semaphore is None or _semaphore_loop is not loop:
                _semaphore = asyncio.Semaphore(limit)
                _semaphore_loop = loop
    return _semaphore


def is_rate_limit_error(exc: BaseException) -> bool:
    """Best-effort detection across provider SDKs.

    llmai wraps several vendor clients, and they do not share an exception
    hierarchy, so match on the status code where one is exposed and fall back to
    the message text.
    """
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    if status == 429:
        return True
    response = getattr(exc, "response", None)
    if response is not None and getattr(response, "status_code", None) == 429:
        return True
    if type(exc).__name__ in {"RateLimitError", "TooManyRequests"}:
        return True
    text = str(exc).lower()
    return "429" in text or "rate limit" in text or "too many requests" in text


def _backoff_seconds(attempt: int) -> float:
    delay = min(_BASE_BACKOFF_SECONDS * (2**attempt), _MAX_BACKOFF_SECONDS)
    # Jitter matters here: without it a whole batch that got 429'd together
    # retries together and gets 429'd together again.
    return delay * (0.5 + random.random() / 2)


def cap_parallelism(default: int) -> int:
    """Clamp a fan-out width to LLM_MAX_CONCURRENCY when one is configured.

    The V2 generation path fans slides out over a ThreadPoolExecutor rather than
    asyncio, so the async semaphore never sees those calls; bounding the pool is
    what actually limits them.
    """
    limit = get_max_concurrency()
    if limit <= 0:
        return default
    return max(1, min(default, limit))


def run_llm_call_sync(call: Callable[[], T], *, label: str = "llm") -> T:
    """Blocking sibling of :func:`run_llm_call`, for thread-pool call sites."""
    import time

    max_retries = get_max_retries()
    attempt = 0
    while True:
        try:
            return call()
        except Exception as exc:  # noqa: BLE001
            if attempt >= max_retries or not is_rate_limit_error(exc):
                raise
            delay = _backoff_seconds(attempt)
            attempt += 1
            LOGGER.warning(
                "%s rate limited (attempt %d/%d); retrying in %.1fs: %s",
                label,
                attempt,
                max_retries,
                delay,
                str(exc)[:160],
            )
            time.sleep(delay)


class _Slot:
    """A held concurrency slot, released explicitly.

    Streaming calls cannot use `async with` around the semaphore because the
    generator that consumes them outlives the acquiring frame.
    """

    def __init__(self, semaphore: Optional[asyncio.Semaphore]):
        self._semaphore = semaphore
        self._released = False

    async def release(self) -> None:
        if self._semaphore is not None and not self._released:
            self._released = True
            self._semaphore.release()


async def acquire_llm_slot() -> "_Slot":
    semaphore = _get_semaphore()
    if semaphore is None:
        return _Slot(None)
    await semaphore.acquire()
    return _Slot(semaphore)


async def run_llm_call(call: Callable[[], Any], *, label: str = "llm") -> Any:
    """Run ``call`` (an awaitable factory) under the concurrency gate, retrying
    rate-limit failures."""
    max_retries = get_max_retries()
    attempt = 0
    while True:
        semaphore = _get_semaphore()
        try:
            if semaphore is None:
                return await call()
            async with semaphore:
                return await call()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            if attempt >= max_retries or not is_rate_limit_error(exc):
                raise
            delay = _backoff_seconds(attempt)
            attempt += 1
            LOGGER.warning(
                "%s rate limited (attempt %d/%d); retrying in %.1fs: %s",
                label,
                attempt,
                max_retries,
                delay,
                str(exc)[:160],
            )
            # Released the semaphore before sleeping, so a queued call can use
            # the slot while this one backs off.
            await asyncio.sleep(delay)
