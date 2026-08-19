import { NextResponse } from "next/server";

export type ServerAuthStatus = {
  configured: boolean;
  authenticated: boolean;
  username: string | null;
  user_id: string | null;
  role: "admin" | "user" | null;
};

function fastApiBase(): string {
  return (
    process.env.FAST_API_INTERNAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_FAST_API?.trim() ||
    "http://127.0.0.1:8000"
  ).replace(/\/+$/, "");
}

const UNAUTHENTICATED: ServerAuthStatus = {
  configured: true,
  authenticated: false,
  username: null,
  user_id: null,
  role: null,
};

export async function authStatusForRequest(
  request: Request
): Promise<ServerAuthStatus> {
  const cookie = request.headers.get("cookie") || "";
  const authorization = request.headers.get("authorization") || "";

  // /auth/status only understands the session cookie. Under Clerk the caller
  // authenticates with a bearer token and has no cookie at all, so these routes
  // would reject every embedded user; /auth/verify runs the full principal
  // resolution and understands both.
  const endpoint = authorization
    ? "/api/v1/auth/verify"
    : "/api/v1/auth/status";

  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;

  try {
    const response = await fetch(`${fastApiBase()}${endpoint}`, {
      headers: Object.keys(headers).length ? headers : undefined,
      cache: "no-store",
    });
    if (!response.ok) {
      return UNAUTHENTICATED;
    }
    const data = (await response.json()) as Partial<ServerAuthStatus> & {
      id?: string;
    };
    return {
      configured: true,
      authenticated: Boolean(data.authenticated),
      username: data.username ?? null,
      // /verify serializes the user, where the id field is `id`, not `user_id`.
      user_id: data.user_id ?? data.id ?? null,
      role: data.role ?? null,
    };
  } catch {
    return UNAUTHENTICATED;
  }
}

export async function requireAdminApi(
  request: Request
): Promise<NextResponse | null> {
  const status = await authStatusForRequest(request);
  if (!status.authenticated) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
  if (status.role !== "admin") {
    return NextResponse.json(
      { detail: "Admin access required" },
      { status: 403 }
    );
  }
  return null;
}
