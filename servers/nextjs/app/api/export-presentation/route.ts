import { NextRequest, NextResponse } from "next/server";
import path from "path";

import {
  BundledPresentationExportFormat,
  bundledExportPackageAvailable,
  runBundledPresentationExport,
} from "@/lib/run-bundled-presentation-export";

function isValidFormat(value: unknown): value is BundledPresentationExportFormat {
  return value === "pdf" || value === "pptx";
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

export async function POST(req: NextRequest) {
  const { format, id, title } = await req.json();
  const cookieHeader = req.headers.get("cookie") ?? "";
  // Clerk mode: the caller forwards its Clerk bearer; pass it through so the
  // headless export render can authenticate its presentation-data fetch
  // (FastAPI verifies the token and scopes to the owner). No cookie exists.
  const authHeader = req.headers.get("authorization") ?? "";
  const authToken = /^bearer\s+/i.test(authHeader)
    ? authHeader.replace(/^bearer\s+/i, "").trim()
    : "";

  if (!id) {
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

    const { path: outPath } = await runBundledPresentationExport({
      format,
      presentationId: id,
      title,
      cookieHeader,
      authToken,
    });

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
