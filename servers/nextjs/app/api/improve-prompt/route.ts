import { NextRequest, NextResponse } from "next/server";

/**
 * Rewrite a rough idea into a clearer generation prompt.
 *
 * This is a thin proxy to FastAPI rather than a direct provider call: the
 * rewrite then runs on whatever model the deployment is configured for, and no
 * provider credentials have to exist in the Next.js layer at all.
 */
function fastApiBase(): string {
  return (
    process.env.FAST_API_INTERNAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_FAST_API?.trim() ||
    "http://127.0.0.1:8000"
  ).replace(/\/+$/, "");
}

export async function POST(request: NextRequest) {
  let prompt: unknown;
  try {
    const body = await request.json();
    prompt = (body as { prompt?: unknown })?.prompt;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }
  if (prompt.length > 8000) {
    return NextResponse.json(
      { error: "Prompt is too long to improve" },
      { status: 400 }
    );
  }

  // Forward the caller's credentials so the request is attributed to them and
  // stays inside their tenant.
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authorization = request.headers.get("authorization");
  if (authorization) headers.authorization = authorization;
  const cookie = request.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const actAs = request.headers.get("x-presenton-user-id");
  if (actAs) headers["x-presenton-user-id"] = actAs;

  try {
    const response = await fetch(`${fastApiBase()}/api/v1/ppt/improve-prompt`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt }),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Could not improve the prompt right now" },
        { status: response.status === 401 ? 401 : 502 }
      );
    }

    const data = (await response.json()) as { prompt?: unknown };
    if (typeof data.prompt !== "string" || !data.prompt.trim()) {
      return NextResponse.json(
        { error: "Could not improve the prompt right now" },
        { status: 502 }
      );
    }
    return NextResponse.json({ prompt: data.prompt });
  } catch {
    return NextResponse.json(
      { error: "Could not improve the prompt right now" },
      { status: 502 }
    );
  }
}
