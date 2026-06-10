import { NextRequest, NextResponse } from "next/server";

function getFastApiBaseUrl(): string {
  const internal = process.env.FAST_API_INTERNAL_URL?.trim();
  if (internal) {
    return internal.replace(/\/+$/, "");
  }

  const configured = process.env.NEXT_PUBLIC_FAST_API?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  return "http://127.0.0.1:8000";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { detail: "Missing presentation id" },
      { status: 400 }
    );
  }

  const exportCookie = request.headers.get("x-export-cookie")?.trim();
  const exportToken = request.headers.get("x-export-token")?.trim();
  const exportUserId = request.headers.get("x-export-user-id")?.trim();
  if (!exportCookie && !exportToken) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const presentationUrl = `${getFastApiBaseUrl()}/api/v1/ppt/presentation/${id}`;

  // Clerk mode: forward the broker token as a bearer (FastAPI verifies it and
  // scopes to the owner). When the token is the internal service secret, the
  // FastAPI export also names the deck owner; forward it so the middleware
  // impersonates that user (a real Clerk JWT ignores the header). Single-user
  // mode: forward the session cookie.
  const upstreamHeaders: Record<string, string> = {};
  if (exportToken) {
    upstreamHeaders["Authorization"] = `Bearer ${exportToken}`;
    if (exportUserId) {
      upstreamHeaders["X-Presenton-User-Id"] = exportUserId;
    }
  } else if (exportCookie) {
    upstreamHeaders["Cookie"] = exportCookie;
  }

  try {
    const response = await fetch(presentationUrl, {
      method: "GET",
      headers: upstreamHeaders,
      cache: "no-store",
    });

    const bodyText = await response.text();
    const contentType = response.headers.get("content-type") ?? "application/json";

    return new NextResponse(bodyText, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[export-presentation-data] Failed to fetch presentation", error);
    return NextResponse.json(
      { detail: "Failed to fetch presentation data" },
      { status: 500 }
    );
  }
}
