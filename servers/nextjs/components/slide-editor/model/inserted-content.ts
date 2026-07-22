import { editorChartToRawChart } from "@/components/slide-editor/model/chart-model";
import {
  asRecord,
  isRecord,
  normalizeId,
  readArray,
  readNumber,
  readPoint,
  readString,
  stripUndefined,
  type Box,
  type RawComponent,
  type RawElement,
  type RawUi,
  type Size,
  type UnknownRecord,
} from "@/components/slide-editor/model/core";
import { rawFontToSource } from "@/components/slide-editor/text/template-v2-text";

export function appendInsertedContent(
  sourceUi: RawUi,
  elements: UnknownRecord[],
  insertedComponents: UnknownRecord[],
  label?: string,
) {
  const components = [...readArray(sourceUi.components)];
  const start = components.length;
  elements.forEach((element, offset) => {
    components.push(insertedElementToComponent(element, label, start + offset));
  });
  insertedComponents.forEach((component, offset) => {
    components.push(
      insertedComponentToRaw(
        component,
        label,
        start + elements.length + offset,
      ),
    );
  });
  return { ...sourceUi, components };
}

export function insertedComponentToRaw(
  component: UnknownRecord,
  label: string | undefined,
  index: number,
): RawComponent {
  const box = sourceElementBox(component);
  const elements = readArray(component.elements)
    .filter(isRecord)
    .map((element) => rawElementFromInsertedElement(element));
  const { size, ...componentWithoutSize } = component;
  void size;
  return {
    ...componentWithoutSize,
    id: `${normalizeId(
      readString(component.id) ?? label ?? "inserted-component",
    )}_${index + 1}`,
    description:
      readString(component.description) ?? label ?? "Inserted component",
    position: { x: box.x, y: box.y },
    elements,
  };
}

export function insertedElementToComponent(
  element: UnknownRecord,
  label: string | undefined,
  index: number,
) {
  const box = sourceElementBox(element);
  const rawElement = rawElementFromInsertedElement(element);
  return {
    id: `${normalizeId(label ?? readString(element.type) ?? "inserted")}_${index + 1}`,
    description: label ?? "Inserted element",
    position: { x: box.x, y: box.y },
    elements: [
      isVectorType(readString(rawElement.type))
        ? localizePolygonElement(rawElement, box)
        : {
            ...rawElement,
            position: { x: 0, y: 0 },
            size: { width: box.width, height: box.height },
          },
    ],
  };
}

export function rawElementFromInsertedElement(
  element: UnknownRecord,
): RawElement {
  const type = readString(element.type);
  const rawElement = normalizeInsertedElementGeometry(element);
  const normalizedElement = {
    ...rawElement,
    font: rawFontToSource(rawElement.font),
    border_radius: normalizeInsertedBorderRadius(
      rawElement.border_radius ?? rawElement.borderRadius,
    ),
    line_height: rawElement.line_height ?? rawElement.lineHeight,
  };
  const textNormalizedElement = normalizeInsertedTextCollections(
    normalizedElement,
    hasTemplateV2Metadata(element),
  );

  if (type === "chart") {
    return editorChartToRawChart(textNormalizedElement, textNormalizedElement);
  }

  return textNormalizedElement;
}

export function sourceElementBox(element: UnknownRecord): Box {
  const polygonBox = polygonBoundsForElement(element);
  if (polygonBox) return polygonBox;

  const position = readPoint(element.position);
  const size = sourceElementSize(element);
  return {
    x: position.x,
    y: position.y,
    width: Math.max(1, size.width),
    height: Math.max(1, size.height),
  };
}

export function sourceElementSize(element: UnknownRecord): Size {
  const polygonBox = polygonBoundsForElement(element);
  if (polygonBox) {
    return { width: polygonBox.width, height: polygonBox.height };
  }

  const size = asRecord(element.size);
  return {
    width: Math.max(1, readNumber(size?.width) ?? 1),
    height: Math.max(1, readNumber(size?.height) ?? 1),
  };
}

export function normalizeInsertedElementGeometry(
  element: UnknownRecord,
): RawElement {
  return convertInsertedChildArrays(element);
}

export function convertInsertedChildArrays(element: UnknownRecord): RawElement {
  const next: RawElement = { ...element };

  if (Array.isArray(element.children)) {
    next.children = element.children.map((child) =>
      isRecord(child) ? rawElementFromInsertedElement(child) : child,
    );
  }
  if (Array.isArray(element.elements)) {
    next.elements = element.elements.map((child) =>
      isRecord(child) ? rawElementFromInsertedElement(child) : child,
    );
  }
  if (isRecord(element.child)) {
    next.child = rawElementFromInsertedElement(element.child);
  }

  return next;
}

export function normalizeInsertedBorderRadius(value: unknown) {
  const radius = asRecord(value);
  if (!radius) return value;
  return stripUndefined({
    ...radius,
    radius: radius.radius,
    tl: radius.tl,
    tr: radius.tr,
    bl: radius.bl,
    br: radius.br,
    topLeft: radius.topLeft,
    topRight: radius.topRight,
    bottomLeft: radius.bottomLeft,
    bottomRight: radius.bottomRight,
  });
}

function localizePolygonElement(element: RawElement, box: Box): RawElement {
  return {
    ...element,
    points: readArray(element.points)
      .map(asRecord)
      .filter((point): point is UnknownRecord => Boolean(point))
      .map((point) => ({
        x: (readNumber(point.x) ?? 0) - box.x,
        y: (readNumber(point.y) ?? 0) - box.y,
      })),
  };
}

function isVectorType(type: string | null | undefined) {
  return type === "vector";
}

function polygonBoundsForElement(element: UnknownRecord): Box | null {
  const type = readString(element.type);
  if (type !== "vector") return null;
  const points = pointsForElement(element);
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const stroke = asRecord(element.stroke);
  const strokeWidth = Math.max(1, readNumber(stroke?.width) ?? 1);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX, strokeWidth),
    height: Math.max(1, maxY - minY, strokeWidth),
  };
}

function pointsForElement(element: UnknownRecord): Array<{ x: number; y: number }> {
  return readArray(element.points)
    .map(asRecord)
    .filter((point): point is UnknownRecord => Boolean(point))
    .map((point) => {
      const x = readNumber(point.x);
      const y = readNumber(point.y);
      return x != null && y != null ? { x, y } : null;
    })
    .filter((point): point is { x: number; y: number } => point != null);
}

export function hasTemplateV2Metadata(element: UnknownRecord) {
  return Boolean(
    element.component_id ||
      element.component_instance_id ||
      element.component_slot ||
      element.component_description ||
      (Array.isArray(element.design_variables) &&
        element.design_variables.length > 0),
  );
}

export function normalizeInsertedTextCollections(
  element: RawElement,
  normalizeTemplateText: boolean,
): RawElement {
  if (!normalizeTemplateText) return element;
  return stripUndefined({
    ...element,
    runs: normalizeInsertedTextRuns(element.runs),
    items: normalizeInsertedTextListItems(element.items),
    columns: normalizeInsertedTableCells(element.columns),
    rows: normalizeInsertedTableRows(element.rows),
  });
}

export function normalizeInsertedTextRuns(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((run) => {
    if (!isRecord(run)) return run;
    return {
      ...run,
      font: rawFontToSource(run.font),
    };
  });
}

export function normalizeInsertedTextListItems(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((item) =>
    Array.isArray(item) ? normalizeInsertedTextRuns(item) : item,
  );
}

export function normalizeInsertedTableRows(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((row) =>
    Array.isArray(row) ? normalizeInsertedTableCells(row) : row,
  );
}

export function normalizeInsertedTableCells(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((cell) => {
    if (!isRecord(cell)) return cell;
    return {
      ...cell,
      font: rawFontToSource(cell.font),
      runs: normalizeInsertedTextRuns(cell.runs),
    };
  });
}
