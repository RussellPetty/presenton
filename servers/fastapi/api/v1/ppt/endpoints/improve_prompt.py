"""Rewrite a user's rough idea into a clearer generation prompt.

Deliberately uses the app's configured LLM rather than calling a provider
directly, so it follows whatever model the deployment is on (currently Grok 4.6
low through the Cursor proxy) and inherits the concurrency gate and the
narrated-JSON tolerance instead of needing a second set of credentials in the
Next.js layer.
"""

import asyncio
import logging
import re

from fastapi import APIRouter, HTTPException
from llmai import get_client
from llmai.shared import SystemMessage, UserMessage
from pydantic import BaseModel, Field

from utils.llm_config import get_llm_config
from utils.llm_provider import get_model
from utils.llm_rate_limit import run_llm_call
from utils.llm_utils import extract_text

IMPROVE_PROMPT_ROUTER = APIRouter(prefix="/improve-prompt", tags=["Improve Prompt"])

LOGGER = logging.getLogger(__name__)

MAX_INPUT_CHARS = 8000

SYSTEM_PROMPT = """You rewrite a user's idea into a clearer, better-structured prompt that will be used to generate a slide presentation. Return ONLY the rewritten prompt text.

RULES:
1. Preserve the user's original intent and topic exactly. Clarify, organize, and enrich - never change WHAT they want the presentation to be about.
2. Frame the result as a clear instruction for creating a presentation: the topic, the audience or purpose if implied, and the key points or sections worth covering.
3. Stay proportional to the input:
   - Very short/vague prompts (1-5 words): expand into one or two clear sentences describing the presentation.
   - Medium prompts: tighten the wording and add only the most useful specifics (audience, goal, key sections).
   - Already-detailed prompts: return nearly verbatim with minor polish.
4. NEVER invent concrete facts the user didn't provide: no specific company names, person names, dates, phone numbers, URLs, statistics, or quotes. Do not add bracketed placeholders.
5. Do NOT specify a number of slides, colors, color palettes, fonts, or visual styling - those are chosen separately.
6. Do not address any specific assistant or product by name.
7. Output ONLY the rewritten prompt as plain text. Prose is fine and an inline list of topics is fine, but use no markdown, headings, code blocks, quotes, preamble, or explanation."""


class ImprovePromptRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=MAX_INPUT_CHARS)


class ImprovePromptResponse(BaseModel):
    prompt: str


def clean_model_output(raw: str) -> str:
    """Strip the wrappers models add even when told not to.

    Rule 7 asks for plain text, and the model mostly complies — but a stray code
    fence or a quoted line would otherwise be pasted straight into the user's
    prompt box.
    """
    text = (raw or "").strip()
    text = re.sub(r"^```[a-z]*\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip().strip("\"'`").strip()
    return text


@IMPROVE_PROMPT_ROUTER.post("", response_model=ImprovePromptResponse)
async def improve_prompt(body: ImprovePromptRequest) -> ImprovePromptResponse:
    original = body.prompt.strip()
    if not original:
        raise HTTPException(status_code=400, detail="Prompt is required")

    client = get_client(config=get_llm_config())
    model = get_model()

    # Delimit the user's text so the model treats it as content to rewrite
    # rather than as instructions addressed to it.
    wrapped = (
        "Rewrite the prompt between the markers.\n"
        "<<<PROMPT>>>\n"
        f"{original}\n"
        "<<<END PROMPT>>>"
    )

    def _run():
        return client.generate(
            model=model,
            messages=[
                SystemMessage(content=SYSTEM_PROMPT),
                UserMessage(content=wrapped),
            ],
        )

    try:
        response = await run_llm_call(
            lambda: asyncio.to_thread(_run), label="improve_prompt"
        )
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("Prompt improvement failed: %s", str(exc)[:200])
        raise HTTPException(
            status_code=502, detail="Could not improve the prompt right now"
        ) from exc

    improved = clean_model_output(extract_text(response.content) or "")
    if not improved:
        # Returning the original is friendlier than an error: the user keeps
        # what they typed instead of losing the round trip.
        improved = original

    return ImprovePromptResponse(prompt=improved)
