import type { TemplateV2Layout } from "@/components/slide-editor/importing/template-v2-import";

export type UnknownRecord = Record<string, unknown>;
export type TemplateSavePayload = UnknownRecord & {
  id: string;
  name: string;
  layout_count: number;
  layouts: unknown;
};
export type PanelMode = "ai" | "schema";
export type Density = "" | "Low" | "Medium" | "High";
export type LayoutPath = Array<string | number>;
export type HistoryCommand = { action: "undo" | "redo"; token: number };
export type HistoryAvailability = { canUndo: boolean; canRedo: boolean };

export type CreatedTemplateLayout = {
  index: number;
  layout: TemplateV2Layout;
};

export type SchemaField = {
  id: string;
  label: string;
  type: "text" | "text-list" | "image";
  path: LayoutPath;
  value: string;
  minChars?: number;
  maxChars?: number;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function cloneLayout<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withEditedLayouts(
  currentLayoutsValue: unknown,
  layouts: TemplateV2Layout[],
) {
  if (Array.isArray(currentLayoutsValue)) {
    return layouts;
  }

  if (isRecord(currentLayoutsValue)) {
    return {
      ...currentLayoutsValue,
      layouts,
    };
  }

  return { layouts };
}

export function buildTemplateSavePayload({
  layouts,
  name,
  targetTemplateId,
  template,
}: {
  layouts: TemplateV2Layout[];
  name: string;
  targetTemplateId: string;
  template: unknown;
}): TemplateSavePayload {
  const templateRecord = isRecord(template) ? template : {};
  const payload = cloneLayout(templateRecord);

  payload.id = targetTemplateId;
  payload.name = name;
  payload.layout_count = layouts.length;
  payload.layouts = withEditedLayouts(templateRecord.layouts, layouts);

  return payload as TemplateSavePayload;
}

export function hashKey(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function humanize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function readLayoutId(layout: TemplateV2Layout, index: number) {
  const id = readString((layout as UnknownRecord).id).trim();
  return id || `slide-${index + 1}`;
}

function schemaLabelForElement(
  element: UnknownRecord,
  fallback: string,
  parentLabel?: string,
) {
  const label =
    readString(element.component_slot) ||
    readString(element.name) ||
    readString(element.component_description) ||
    parentLabel ||
    fallback;
  return humanize(label);
}

function textRunsToString(runs: unknown) {
  return readArray(runs)
    .map((run) => (isRecord(run) ? readString(run.text) : ""))
    .join("");
}

function textListItemsToString(items: unknown) {
  return readArray(items)
    .map((item) => textRunsToString(item))
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

export function collectSchemaFields(layout: TemplateV2Layout) {
  const fields: SchemaField[] = [];

  const addElement = (
    element: unknown,
    path: LayoutPath,
    parentLabel?: string,
  ) => {
    if (!isRecord(element)) return;

    const type = readString(element.type);
    const label = schemaLabelForElement(
      element,
      `${type || "Field"} ${fields.length + 1}`,
      parentLabel,
    );

    if (type === "text") {
      const value = textRunsToString(element.runs);
      if (value || label) {
        fields.push({
          id: path.join("."),
          label,
          type: "text",
          path,
          value,
          minChars: readNumber(element.min_length),
          maxChars: readNumber(element.max_length),
        });
      }
    }

    if (type === "text-list") {
      const value = textListItemsToString(element.items);
      if (value || label) {
        fields.push({
          id: path.join("."),
          label,
          type: "text-list",
          path,
          value,
          minChars: readNumber(element.min_item_length),
          maxChars: readNumber(element.max_item_length),
        });
      }
    }

    if (type === "image" && element.is_icon !== true) {
      fields.push({
        id: path.join("."),
        label,
        type: "image",
        path,
        value: readString(element.data) || readString(element.prompt),
      });
    }

    const childLabel =
      readString(element.component_slot) ||
      readString(element.name) ||
      parentLabel;

    if (isRecord(element.child)) {
      addElement(element.child, [...path, "child"], childLabel);
    }

    readArray(element.children).forEach((child, childIndex) => {
      addElement(child, [...path, "children", childIndex], childLabel);
    });

    readArray(element.elements).forEach((child, childIndex) => {
      addElement(child, [...path, "elements", childIndex], childLabel);
    });
  };

  const layoutRecord = layout as UnknownRecord;

  readArray(layoutRecord.elements).forEach((element, elementIndex) => {
    addElement(element, ["elements", elementIndex]);
  });

  readArray(layoutRecord.components).forEach((component, componentIndex) => {
    if (!isRecord(component)) return;
    const componentLabel =
      readString(component.component_slot) ||
      readString(component.id) ||
      readString(component.description);

    readArray(component.elements).forEach((element, elementIndex) => {
      addElement(
        element,
        ["components", componentIndex, "elements", elementIndex],
        componentLabel,
      );
    });
  });

  return fields;
}

function recordAtPath(root: unknown, path: LayoutPath) {
  let current: unknown = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return null;
      current = current[segment];
      continue;
    }
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  return isRecord(current) ? current : null;
}

function updateTextRuns(element: UnknownRecord, value: string) {
  const runs = readArray(element.runs).filter(isRecord);
  const firstRun = runs[0] ?? {};
  element.runs = [{ ...firstRun, text: value }];
}

function updateTextListItems(element: UnknownRecord, value: string) {
  const currentItems = readArray(element.items);
  const firstItem = readArray(currentItems[0]).filter(isRecord);
  const firstRun = firstItem[0] ?? {};
  const lines = value.split(/\r?\n/);
  element.items = lines.map((line) => [{ ...firstRun, text: line }]);
}

export function updateLayoutSchemaField(
  layout: TemplateV2Layout,
  field: SchemaField,
  value: string,
) {
  const nextLayout = cloneLayout(layout);
  const element = recordAtPath(nextLayout, field.path);
  if (!element) return layout;

  if (field.type === "text") {
    updateTextRuns(element, value);
  } else if (field.type === "text-list") {
    updateTextListItems(element, value);
  } else {
    element.data = value;
  }

  return nextLayout;
}

export function updateLayoutSchemaConstraint(
  layout: TemplateV2Layout,
  field: SchemaField,
  constraint: "min" | "max",
  value: string,
) {
  const nextLayout = cloneLayout(layout);
  const element = recordAtPath(nextLayout, field.path);
  if (!element || field.type === "image") return layout;

  const numericValue = value.trim() === "" ? null : Number.parseInt(value, 10);
  const key =
    field.type === "text-list"
      ? constraint === "min"
        ? "min_item_length"
        : "max_item_length"
      : constraint === "min"
        ? "min_length"
        : "max_length";

  if (numericValue === null || !Number.isFinite(numericValue)) {
    delete element[key];
  } else {
    element[key] = Math.max(0, numericValue);
  }

  return nextLayout;
}

export function extractCreatedLayouts(value: unknown): CreatedTemplateLayout[] {
  if (!isRecord(value)) return [];
  const layoutsValue = value.layouts;
  if (!Array.isArray(layoutsValue)) return [];

  return layoutsValue.flatMap((item) => {
    if (!isRecord(item)) return [];
    const index = item.index;
    if (!Number.isInteger(index) || !item.layout) return [];
    return [
      {
        index: index as number,
        layout: item.layout as TemplateV2Layout,
      },
    ];
  });
}
