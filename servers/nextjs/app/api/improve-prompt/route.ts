import { NextRequest, NextResponse } from "next/server";
import { readUserConfigFile } from "@/lib/user-config-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Lightweight, fast Gemini model used purely to rewrite the user's idea into a
// clearer presentation prompt. Overridable via env, but defaults to flash-lite
// so this stays cheap and snappy regardless of the main generation model.
const DEFAULT_MODEL = "gemini-3.1-flash-lite";

const SYSTEM_PROMPT = `You rewrite a user's idea into a clearer, better-structured prompt that will be used to generate a slide presentation. Return ONLY the rewritten prompt text.

RULES:
1. Preserve the user's original intent and topic exactly. Clarify, organize, and enrich — never change WHAT they want the presentation to be about.
2. Frame the result as a clear instruction for creating a presentation: the topic, the audience or purpose if implied, and the key points or sections worth covering.
3. Stay proportional to the input:
   - Very short/vague prompts (1–5 words): expand into one or two clear sentences describing the presentation.
   - Medium prompts: tighten the wording and add only the most useful specifics (audience, goal, key sections).
   - Already-detailed prompts: return nearly verbatim with minor polish.
4. NEVER invent concrete facts the user didn't provide: no specific company names, person names, dates, phone numbers, URLs, statistics, or quotes. Do not add bracketed placeholders.
5. Do NOT specify a number of slides, colors, color palettes, fonts, or visual styling — those are chosen separately.
6. Do not address any specific assistant or product by name.
7. Output ONLY the rewritten prompt as plain text. Prose is fine and an inline list of topics is fine, but use no markdown, headings, code blocks, quotes, preamble, or explanation.`;

function stripModelPrefix(model: string): string {
  return model.replace(/^models\//, "").trim();
}

function resolveModel(): string {
  const override = process.env.PROMPT_ENHANCER_MODEL?.trim();
  if (override) return stripModelPrefix(override);
  return DEFAULT_MODEL;
}

// Mirror /api/has-required-key: prefer a key written to the user config file,
// fall back to the container env (how the deployed app supplies it).
function resolveGoogleApiKey(): string {
  let keyFromFile = "";
  const userConfigPath = process.env.USER_CONFIG_PATH;
  if (userConfigPath) {
    try {
      const cfg = readUserConfigFile<{ GOOGLE_API_KEY?: string }>(userConfigPath);
      keyFromFile = cfg?.GOOGLE_API_KEY || "";
    } catch {
      keyFromFile = "";
    }
  }
  const keyFromEnv = process.env.GOOGLE_API_KEY || "";
  return (keyFromFile || keyFromEnv).trim();
}

function cleanModelOutput(raw: string): string {
  return raw
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const prompt = body?.prompt;

    if (typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (prompt.length > 8000) {
      return NextResponse.json(
        { error: "Prompt is too long to improve" },
        { status: 400 }
      );
    }

    const apiKey = resolveGoogleApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Prompt improvement is not configured" },
        { status: 500 }
      );
    }

    const model = resolveModel();

    // Wrapping the input in delimiters keeps short/bare inputs from tripping
    // safety false-positives and makes the boundaries explicit to the model.
    const wrapped = `Here is the idea to rewrite:\n"""\n${prompt.trim()}\n"""`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      cache: "no-store",
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: wrapped }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
          // Keep latency low — this is a simple rewrite, not a reasoning task.
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("[improve-prompt] Gemini error:", response.status, errText);
      return NextResponse.json(
        { error: "Failed to improve prompt" },
        { status: 502 }
      );
    }

    const data = await response.json();

    const candidate = data?.candidates?.[0];
    const parts: Array<{ text?: string; thought?: boolean }> =
      candidate?.content?.parts ?? [];

    // Join visible text parts only — skip any internal "thought" parts.
    const improved = cleanModelOutput(
      parts
        .filter((p) => p && typeof p.text === "string" && p.thought !== true)
        .map((p) => p.text as string)
        .join("")
    );

    if (!improved) {
      console.error(
        "[improve-prompt] Empty completion. finishReason:",
        candidate?.finishReason
      );
      return NextResponse.json(
        { error: "No improvement generated" },
        { status: 502 }
      );
    }

    return NextResponse.json({ improvedPrompt: improved });
  } catch (err: any) {
    console.error("[improve-prompt] error:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
