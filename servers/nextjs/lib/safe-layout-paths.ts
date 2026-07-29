import path from "path";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeLayoutSegment(value: unknown): value is string {
  return typeof value === "string" && SAFE_SEGMENT.test(value);
}

export function getLayoutsRoot(cwd: string = process.cwd()): string {
  const appDataDirectory = process.env.APP_DATA_DIRECTORY?.trim();
  if (appDataDirectory) {
    return path.join(appDataDirectory, "layouts");
  }
  return path.join(cwd, "app_data", "layouts");
}

export function resolveSafeLayoutFilePath(
  layoutName: string,
  componentName: string,
  cwd: string = process.cwd(),
): { layoutsDir: string; filePath: string; fileName: string } {
  if (!isSafeLayoutSegment(layoutName)) {
    throw new Error("Invalid layout_name");
  }
  if (!isSafeLayoutSegment(componentName)) {
    throw new Error("Invalid component_name");
  }

  const layoutsRoot = path.resolve(getLayoutsRoot(cwd));
  const layoutsDir = path.resolve(layoutsRoot, layoutName);
  const fileName = `${componentName}.tsx`;
  const filePath = path.resolve(layoutsDir, fileName);

  if (
    layoutsDir !== layoutsRoot &&
    !layoutsDir.startsWith(layoutsRoot + path.sep)
  ) {
    throw new Error("Layout path escapes layouts directory");
  }
  if (
    filePath !== layoutsDir &&
    !filePath.startsWith(layoutsDir + path.sep)
  ) {
    throw new Error("Component path escapes layout directory");
  }

  return { layoutsDir, filePath, fileName };
}
