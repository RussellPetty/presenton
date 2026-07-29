import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { authStatusForRequest } from "@/lib/server-auth-role";
import {
  isSafeLayoutSegment,
  resolveSafeLayoutFilePath,
} from "@/lib/safe-layout-paths";

export async function POST(request: NextRequest) {
  try {
    const auth = await authStatusForRequest(request);
    if (!auth.authenticated) {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }

    const { layout_name, components } = await request.json();

    if (!layout_name || !components || !Array.isArray(components)) {
      return NextResponse.json(
        {
          error:
            "Invalid request body. Expected layout_name and components array.",
        },
        { status: 400 }
      );
    }

    if (!isSafeLayoutSegment(layout_name)) {
      return NextResponse.json(
        {
          error:
            "Invalid layout_name. Use a simple identifier without path separators.",
        },
        { status: 400 }
      );
    }

    // Save each component as a separate file under the layouts root only.
    const savedFiles = [];
    let layoutsDir: string | undefined;

    for (const component of components) {
      const { slide_number, component_code, component_name } = component;

      if (!component_code || !component_name) {
        console.warn(
          `Skipping component for slide ${slide_number}: missing code or name`
        );
        continue;
      }

      let resolved;
      try {
        resolved = resolveSafeLayoutFilePath(layout_name, component_name);
      } catch {
        return NextResponse.json(
          {
            error:
              "Invalid component_name. Use a simple identifier without path separators.",
          },
          { status: 400 }
        );
      }

      layoutsDir = resolved.layoutsDir;
      if (!existsSync(layoutsDir)) {
        await mkdir(layoutsDir, { recursive: true });
      }

      const cleanComponentCode = component_code
        .replace(/```tsx/g, "")
        .replace(/```/g, "");

      await writeFile(resolved.filePath, cleanComponentCode, "utf8");
      savedFiles.push({
        slide_number,
        component_name,
        file_path: resolved.filePath,
        file_name: resolved.fileName,
      });
    }

    return NextResponse.json({
      success: true,
      layout_name,
      path: layoutsDir,
      saved_files: savedFiles.length,
      components: savedFiles,
    });
  } catch (error) {
    console.error("Error saving layout:", error);
    return NextResponse.json(
      { error: "Failed to save layout components" },
      { status: 500 }
    );
  }
}
