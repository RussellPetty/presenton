import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

import {
  BundledPresentationExportFormat,
  bundledExportPackageAvailable,
  runBundledPresentationExport,
} from "@/lib/run-bundled-presentation-export";
import { authStatusForRequest } from "@/lib/server-auth-role";

function isValidFormat(value: unknown): value is BundledPresentationExportFormat {
  return value === "pdf" || value === "pptx";
}

async function readExportRequestBody(req: NextRequest): Promise<{
  format?: unknown;
  id?: unknown;
  title?: unknown;
}> {
  const rawBody = await req.text();
  if (!rawBody.trim()) {
    throw new Error("EMPTY_BODY");
  }

  const parsed = JSON.parse(rawBody) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_BODY");
  }

  return parsed as { format?: unknown; id?: unknown; title?: unknown };
}

function buildExportDownloadUrl(outPath: string): string {
  const appDataDirectory = process.env.APP_DATA_DIRECTORY?.trim();
  if (!appDataDirectory) {
    throw new Error("APP_DATA_DIRECTORY is required to download exported files.");
  }

  const exportsDirectory = path.join(appDataDirectory, "exports");
  const relativePath = path.relative(exportsDirectory, outPath);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Export finished outside the configured exports directory.");
  }

  return `/api/export-presentation/file?name=${encodeURIComponent(relativePath)}`;
}

async function moveExportIntoOwnerDirectory(
  outPath: string,
  userId: string | null
): Promise<string> {
  if (!userId) {
    return outPath;
  }

  const appDataDirectory = process.env.APP_DATA_DIRECTORY?.trim();
  if (!appDataDirectory) {
    throw new Error("APP_DATA_DIRECTORY is required to scope exported files.");
  }

  const exportsDirectory = await fs.realpath(
    path.join(appDataDirectory, "exports")
  );
  const sourcePath = await fs.realpath(outPath);
  const ownerDirectory = path.join(exportsDirectory, "users", userId);
  await fs.mkdir(ownerDirectory, { recursive: true });

  const sourceParent = path.dirname(sourcePath);
  if (sourceParent === ownerDirectory) {
    return sourcePath;
  }
  if (sourceParent !== exportsDirectory) {
    throw new Error("Export finished outside the current user's export directory.");
  }

  const destination = path.join(ownerDirectory, path.basename(sourcePath));
  await fs.rename(sourcePath, destination);
  return destination;
}


/**
 * Obtain a session cookie for the headless export render.
 *
 * The renderer loads /pdf-maker in a browser, which cannot replay a bearer
 * token, so it authenticates with a cookie. Under Clerk the caller sends a
 * bearer and has no cookie to forward, and without one the render fetches the
 * deck unauthenticated and silently exports a blank shell rather than failing.
 */
async function resolveExportCookie(req: Request): Promise<string> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  if (cookieHeader) return cookieHeader;

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization) return "";

  const base = (
    process.env.FAST_API_INTERNAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_FAST_API?.trim() ||
    "http://127.0.0.1:8000"
  ).replace(/\/+$/, "");

  try {
    const headers: Record<string, string> = { authorization };
    // Preserve impersonation so the render reads the deck as its owner.
    const actAs = req.headers.get("x-presenton-user-id");
    if (actAs) headers["x-presenton-user-id"] = actAs;

    const response = await fetch(`${base}/api/v1/auth/export-session`, {
      method: "POST",
      headers,
      cache: "no-store",
    });
    if (!response.ok) return "";
    const data = (await response.json()) as { cookie?: unknown };
    return typeof data.cookie === "string" ? data.cookie : "";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const auth = await authStatusForRequest(req);
  if (!auth.authenticated) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  let body: Awaited<ReturnType<typeof readExportRequestBody>>;
  try {
    body = await readExportRequestBody(req);
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error &&
        (error.message === "EMPTY_BODY" || error.message === "INVALID_BODY"))
    ) {
      return NextResponse.json(
        { error: "Invalid export request JSON body" },
        { status: 400 }
      );
    }
    throw error;
  }

  const { format, id, title } = body;
  const cookieHeader = await resolveExportCookie(req);

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json(
      { error: "Missing Presentation ID" },
      { status: 400 }
    );
  }

  if (!isValidFormat(format)) {
    return NextResponse.json(
      { error: "Invalid export format" },
      { status: 400 }
    );
  }

  try {
    if (!(await bundledExportPackageAvailable())) {
      throw new Error(
        "presentation-export runtime is not available. Run scripts/sync-presentation-export.cjs to install it."
      );
    }

    const { path: unscopedOutPath } = await runBundledPresentationExport({
      format,
      presentationId: id.trim(),
      title: typeof title === "string" ? title : undefined,
      cookieHeader,
    });
    const outPath = await moveExportIntoOwnerDirectory(
      unscopedOutPath,
      auth.user_id
    );

    return NextResponse.json({
      success: true,
      path: buildExportDownloadUrl(outPath),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[export-presentation:${format}]`, message);
    return NextResponse.json(
      { error: message, success: false },
      { status: 500 }
    );
  }
}
