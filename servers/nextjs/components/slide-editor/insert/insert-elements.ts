import type { TemplateV2InsertComponent } from "@/components/slide-editor/events/events";
import { normalizeChartTypeName } from "@/components/slide-editor/charts/chart-data";
import {
  measureNoWrapTextWidth,
  rawFont,
} from "@/components/slide-editor/text/template-v2-text";
import type {
  ChartType,
  Fill,
  Font,
  InfographicType,
  Marker,
  SlideElement,
  Stroke,
  TableCell,
} from "@/components/slide-editor/types";

const DEFAULT_CHART_INSERT_POSITION = { x: 128, y: 115 };
const DEFAULT_CHART_INSERT_SIZE = { width: 717, height: 410 };
const DEFAULT_INFOGRAPHIC_INSERT_POSITION = { x: 128, y: 170 };
const DEFAULT_IMAGE_PLACEHOLDER_SRC = "/placeholder.jpg";
const TEXT_INSERT_HORIZONTAL_PADDING_PX = 8;
const TEXT_INSERT_VERTICAL_PADDING_PX = 14;
const IMAGE_RADIUS = { tl: 10, tr: 10, bl: 10, br: 10 };

export type EditorInsertContent = {
  elements?: SlideElement[];
  components?: TemplateV2InsertComponent[];
};

function fittedTextHeight(
  lineCount: number,
  fontSize: number,
  lineHeight: number,
) {
  return Math.ceil(
    lineCount * fontSize * lineHeight + TEXT_INSERT_VERTICAL_PADDING_PX,
  );
}

function makeTextElement({
  text,
  x,
  y,
  width,
  height,
  size,
  color = "101323",
  bold = false,
  italic = false,
  lineHeight = 1.1,
  horizontal = "left",
}: {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  size: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  lineHeight?: number;
  horizontal?: "left" | "center" | "right";
}): SlideElement {
  return {
    type: "text",
    position: { x, y },
    size: { width, height },
    alignment: { horizontal, vertical: "top" },
    runs: [{ text }],
    font: {
      family: "Arial",
      size,
      color,
      bold,
      italic,
      line_height: lineHeight,
    },
  };
}

function makeTableCell({
  text,
  font,
  color,
  alignment = "left",
}: {
  text: string;
  font: Font;
  color?: Fill;
  alignment?: TableCell["alignment"];
}): TableCell {
  return {
    alignment,
    color,
    runs: [{ text, font }],
  };
}

function makeBulletListElement(marker: Marker): SlideElement {
  const baseFont = {
    size: 18,
    family: "Inter",
    color: "#111111",
    bold: false,
    italic: false,
    line_height: 1.4,
    letter_spacing: 0,
    ellipsis: false,
  };
  const items = [
    [
      {
        text: "Clarify the goal and audience",
        font: { ...baseFont, bold: true },
      },
    ],
    [{ text: "Show the strongest supporting point", font: { ...baseFont } }],
    [
      {
        text: "Close with the next action",
        font: { ...baseFont, italic: true },
      },
    ],
  ];
  const renderFont = rawFont({ font: baseFont });
  const fittedWidth = Math.ceil(
    Math.max(
      ...items.map((item, index) => {
        const prefix =
          marker === "bullet"
            ? "• "
            : marker === "number"
              ? `${index + 1}. `
              : "";
        const text = item.map((run) => run.text).join("");
        return measureNoWrapTextWidth(`${prefix}${text}`, renderFont);
      }),
    ) + TEXT_INSERT_HORIZONTAL_PADDING_PX,
  );

  return {
    type: "text-list",
    position: { x: 122, y: 128 },
    size: {
      width: fittedWidth,
      height: fittedTextHeight(
        items.length,
        baseFont.size,
        baseFont.line_height,
      ),
    },
    rotation: 0,
    font: baseFont,

    marker,
    items,
    decorative: false,
    name: "Project task list",
    max_items: 6,
    min_items: 3,
    max_item_length: 60,
    min_item_length: 30,
  };
}

export function createTextInsertElements(kind?: string): SlideElement[] {
  switch (kind) {
    case "title-block":
      return [
        makeTextElement({
          text: "Add a clear slide title",
          x: 109,
          y: 109,
          width: 986,
          height: fittedTextHeight(1, 38, 1.1),
          size: 38,
          bold: true,
        }),
      ];
    case "subtitle":
      return [
        makeTextElement({
          text: "Add a concise supporting subtitle",
          x: 122,
          y: 154,
          width: 870,
          height: fittedTextHeight(1, 24, 1.2),
          size: 24,
          color: "344054",
          lineHeight: 1.2,
        }),
      ];
    case "bullet-list":
      return [makeBulletListElement("bullet")];
    case "numbered-list":
      return [makeBulletListElement("number")];
    case "list-item":
      return [makeBulletListElement("none")];
    case "quote":
      return [
        makeTextElement({
          text: '"Add a memorable quote or customer insight here."',
          x: 122,
          y: 147,
          width: 858,
          height: fittedTextHeight(2, 24, 1.25),
          size: 24,
          color: "101323",
          italic: true,
          lineHeight: 1.25,
        }),
      ];
    case "body-text":
      return [
        makeTextElement({
          text: "Add body text here. Use this space for a short paragraph or supporting detail.",
          x: 122,
          y: 154,
          width: 858,
          height: fittedTextHeight(2, 18, 1.28),
          size: 18,
          color: "344054",
          lineHeight: 1.28,
        }),
      ];
    default:
      return [];
  }
}

function chartTypeFromPaletteId(id?: string): ChartType | null {
  const normalized = normalizeChartTypeName(id);
  switch (normalized) {
    case "area":
    case "bar":
    case "donut":
    case "horizontal_bar":
    case "line":
    case "pie":
    case "polar_area":
    case "radar":
    case "scatter":
      return normalized as ChartType;
    case "stackedbar":
    case "stacked_bar":
      return "stacked_bar";
    case "horizontalstackbar":
    case "horizontalstackedbar":
    case "horizontal_stack_bar":
    case "horizontal_stacked_bar":
      return "horizontal_stacked_bar";
    default:
      return null;
  }
}

function chartData(
  categories: string[],
  values: number[],
  colors: string[],
) {
  return categories.map((category, index) => ({
    label: category,
    value: values[index] ?? 0,
    color: colors[index % colors.length] ?? colors[0],
  }));
}

function chartExample(chartType: ChartType) {
  switch (chartType) {
    case "donut":
      return {
        title: "Revenue Share by Segment",
        categories: ["Enterprise", "Mid-market", "Small business", "Consumer"],
        values: [42, 28, 18, 12],
        seriesName: "Revenue Share",
        colors: ["7F22FE", "155DFC", "F59E0B", "12B76A"],
      };
    case "horizontal_bar":
      return {
        title: "Qualified Leads by Channel",
        categories: ["Email", "Search", "Social", "Referral"],
        values: [68, 54, 47, 38],
        seriesName: "Qualified Leads",
        colors: ["7F22FE", "155DFC", "F59E0B", "12B76A"],
      };
    case "polar_area":
      return {
        title: "Support Tickets by Priority",
        categories: ["Critical", "High", "Medium", "Low"],
        values: [18, 32, 46, 24],
        seriesName: "Ticket Volume",
        colors: ["7F22FE", "155DFC", "F59E0B", "12B76A"],
      };
    case "radar":
      return {
        title: "Product Readiness Score",
        categories: ["Design", "Reliability", "Speed", "Security", "Usability"],
        values: [82, 74, 88, 69, 91],
        seriesName: "Readiness Score",
        colors: ["7F22FE", "155DFC", "F59E0B", "12B76A", "06B6D4"],
      };
    case "scatter":
      return {
        title: "Campaign Conversion Results",
        categories: ["Campaign A", "Campaign B", "Campaign C", "Campaign D"],
        values: [42, 57, 63, 76],
        seriesName: "Conversions",
        colors: ["7F22FE", "155DFC", "F59E0B", "12B76A"],
      };
    default:
      return {
        title: "Quarterly Revenue Trend",
        categories: ["Q1", "Q2", "Q3", "Q4"],
        values: [38, 54, 47, 68],
        seriesName: "Revenue",
        colors: ["7F22FE", "155DFC", "F59E0B", "12B76A"],
      };
  }
}

function makeChartElement(chartType: ChartType): SlideElement {
  if (chartType === "bar") {
    const categories = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const values = [70, 120, 45, 145, 105, 105, 45];
    const colors = [
      "4D20C5",
      "155DFC",
      "F59E0B",
      "12B76A",
      "EF4444",
      "06B6D4",
      "8B5CF6",
    ];

    return {
      type: "chart",
      position: { ...DEFAULT_CHART_INSERT_POSITION },
      size: { ...DEFAULT_CHART_INSERT_SIZE },
      chart_type: "bar",
      title: "Weekly Website Visits\nJun 10-16",
      color: "4D20C5",
      axis_color: "D8D8D8",
      grid_color: "D8D8D8",
      data_labels: "top",
      x_axis_grid: true,
      y_axis_grid: true,
      x_axis: true,
      y_axis: true,
      categories,
      series: [{ name: "Visits", values }],
      colors,
      data: chartData(categories, values, colors),
    };
  }

  if (chartType === "line") {
    const categories = ["2021", "2022", "2023", "2024", "2025", "2026"];
    const values = [15, 45, 85, 50, 75, 95];
    const colors = [
      "4D20C5",
      "155DFC",
      "F59E0B",
      "12B76A",
      "EF4444",
      "06B6D4",
    ];

    return {
      type: "chart",
      position: { ...DEFAULT_CHART_INSERT_POSITION },
      size: { ...DEFAULT_CHART_INSERT_SIZE },
      chart_type: "line",
      title: "Revenue Growth\n2021-2026",
      color: "4D20C5",
      axis_color: "D8D8D8",
      grid_color: "D8D8D8",
      data_labels: null,
      x_axis_grid: true,
      y_axis_grid: true,
      x_axis: true,
      y_axis: false,
      categories,
      series: [{ name: "Revenue", values }],
      colors,
      data: chartData(categories, values, colors),
    };
  }

  if (chartType === "area") {
    const categories = ["2021", "2022", "2023", "2024", "2025", "2026"];
    const values = [25, 48, 46, 57, 62, 78];
    const colors = [
      "4D20C5",
      "155DFC",
      "F59E0B",
      "12B76A",
      "EF4444",
      "06B6D4",
    ];

    return {
      type: "chart",
      position: { ...DEFAULT_CHART_INSERT_POSITION },
      size: { ...DEFAULT_CHART_INSERT_SIZE },
      chart_type: "area",
      title: "Monthly Active Users\n2021-2026",
      color: "7555F6",
      axis_color: "D8D8D8",
      grid_color: "D8D8D8",
      data_labels: null,
      x_axis_grid: true,
      y_axis_grid: true,
      x_axis: true,
      y_axis: false,
      categories,
      series: [{ name: "Active Users", values }],
      colors,
      data: chartData(categories, values, colors),
    };
  }

  if (chartType === "pie") {
    const categories = ["Product", "Services", "Support", "Training"];
    const values = [45, 30, 15, 10];
    const colors = ["7555F6", "155DFC", "F59E0B", "12B76A"];

    return {
      type: "chart",
      position: { ...DEFAULT_CHART_INSERT_POSITION },
      size: { ...DEFAULT_CHART_INSERT_SIZE },
      chart_type: "pie",
      title: "Revenue Mix by Offering",
      color: "7555F6",
      axis_color: "D8D8D8",
      grid_color: "D8D8D8",
      data_labels: "top",
      categories,
      series: [{ name: "Revenue Share", values }],
      colors,
      data: chartData(categories, values, colors),
    };
  }

  if (chartType === "stacked_bar" || chartType === "horizontal_stacked_bar") {
    const categories = ["Q1", "Q2", "Q3", "Q4"];
    const values = [38, 54, 47, 68];
    const secondaryValues = [24, 36, 31, 42];
    const colors = ["7F22FE", "155DFC"];

    return {
      type: "chart",
      position: { ...DEFAULT_CHART_INSERT_POSITION },
      size: { width: 538, height: 410 },
      chart_type: chartType,
      title: "Quarterly Revenue by Segment",
      color: "7F22FE",
      axis_color: "D0D5DD",
      grid_color: "D0D5DD",
      data_labels: "top",
      legend: true,
      x_axis_grid: true,
      y_axis_grid: true,
      categories,
      series: [
        { name: "New Business", values },
        { name: "Expansion", values: secondaryValues },
      ],
      colors,
      data: chartData(categories, values, colors),
    };
  }

  const { title, categories, values, seriesName, colors } =
    chartExample(chartType);

  return {
    type: "chart",
    position: { ...DEFAULT_CHART_INSERT_POSITION },
    size: { width: 538, height: 410 },
    chart_type: chartType,
    title,
    color: "7F22FE",
    axis_color: "D0D5DD",
    grid_color: "D0D5DD",
    data_labels: "top",
    x_axis_grid: true,
    y_axis_grid: true,
    categories,
    series: [{ name: seriesName, values }],
    colors,
    data: chartData(categories, values, colors),
  };
}

export function createChartInsertElements(kind?: string): SlideElement[] {
  const chartType = chartTypeFromPaletteId(kind);
  return chartType ? [makeChartElement(chartType)] : [];
}

function infographicTypeFromPaletteId(id?: string): InfographicType | null {
  switch (id) {
    case "progress_bar":
    case "progress-bar":
      return "progress_bar";
    case "gauge":
    case "gauge-chart":
      return "gauge";
    default:
      return null;
  }
}

function makeInfographicElement(infographicType: InfographicType): SlideElement {
  if (infographicType === "progress_bar") {
    return {
      type: "infographic",
      position: { ...DEFAULT_INFOGRAPHIC_INSERT_POSITION },
      size: { width: 420, height: 74 },
      data: {
        type: "progress_bar",
        min_value: 0,
        max_value: 100,
        value: 68,
      },
      colors: ["E5E7EB", "2563EB"],
    };
  }

  return {
    type: "infographic",
    position: { ...DEFAULT_INFOGRAPHIC_INSERT_POSITION },
    size: { width: 320, height: 190 },
    data: {
      type: "gauge",
      min_value: 0,
      max_value: 100,
      value: 76,
    },
    colors: ["E5E7EB", "2563EB"],
  };
}

export function createInfographicInsertElements(kind?: string): SlideElement[] {
  const infographicType = infographicTypeFromPaletteId(kind);
  return infographicType ? [makeInfographicElement(infographicType)] : [];
}

function makeSimpleTableElement(): SlideElement {
  const baseFont: Font = {
    family: "Inter",
    size: 14,
    color: "#344054",
    line_height: 1.2,
  };
  const headerFont: Font = {
    ...baseFont,
    color: "#101323",
    bold: true,
  };
  const headerFill: Fill = { color: "#F2F4F7", opacity: 1 };
  const bodyFill: Fill = { color: "#FFFFFF", opacity: 1 };

  return {
    type: "table",
    position: { x: 122, y: 128 },
    size: { width: 819, height: 186 },
    font: baseFont,
    columns: [
      makeTableCell({ text: "Metric", font: headerFont, color: headerFill }),
      makeTableCell({ text: "Current", font: headerFont, color: headerFill }),
      makeTableCell({ text: "Target", font: headerFont, color: headerFill }),
    ],
    rows: [
      [
        makeTableCell({ text: "Activation", font: baseFont, color: bodyFill }),
        makeTableCell({ text: "68%", font: baseFont, color: bodyFill }),
        makeTableCell({ text: "75%", font: baseFont, color: bodyFill }),
      ],
      [
        makeTableCell({ text: "Retention", font: baseFont, color: bodyFill }),
        makeTableCell({ text: "42%", font: baseFont, color: bodyFill }),
        makeTableCell({ text: "50%", font: baseFont, color: bodyFill }),
      ],
    ],
    min_columns: 2,
    max_columns: 6,
    min_rows: 2,
    max_rows: 8,
  };
}

export function createTableInsertElements(kind?: string): SlideElement[] {
  return kind === "simple-table" ? [makeSimpleTableElement()] : [];
}

function makeImageElement({
  x,
  y,
  width,
  height,
  name = "Image",
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
}): SlideElement {
  return {
    type: "image",
    position: { x, y },
    size: { width, height },
    data: DEFAULT_IMAGE_PLACEHOLDER_SRC,
    fit: "cover",
    name,
    border_radius: IMAGE_RADIUS,
  };
}

export function createImageInsertContent(kind?: string): EditorInsertContent {
  switch (kind) {
    case "image":
      return {
        elements: [
          makeImageElement({
            x: 134,
            y: 128,
            width: 666,
            height: 397,
          }),
        ],
      };
    case "image-text":
      return {
        components: [
          {
            id: "image_text",
            description: "Image with heading and supporting text",
            position: { x: 122, y: 128 },
            elements: [
              makeImageElement({ x: 0, y: 0, width: 486, height: 371 }),
              makeTextElement({
                text: "Add a heading",
                x: 525,
                y: 15,
                width: 442,
                height: 74,
                size: 24,
                bold: true,
              }),
              makeTextElement({
                text: "Add supporting text that explains why this visual matters.",
                x: 525,
                y: 108,
                width: 442,
                height: 134,
                size: 16,
                color: "475467",
                lineHeight: 1.3,
              }),
            ],
          },
        ],
      };
    case "image-grid":
      return {
        components: [
          {
            id: "image_grid",
            description: "Two-by-two image grid",
            position: { x: 128, y: 122 },
            elements: [
              makeImageElement({
                x: 0,
                y: 0,
                width: 346,
                height: 211,
                name: "Image 1",
              }),
              makeImageElement({
                x: 371,
                y: 0,
                width: 346,
                height: 211,
                name: "Image 2",
              }),
              makeImageElement({
                x: 0,
                y: 243,
                width: 346,
                height: 211,
                name: "Image 3",
              }),
              makeImageElement({
                x: 371,
                y: 243,
                width: 346,
                height: 211,
                name: "Image 4",
              }),
            ],
          },
        ],
      };
    default:
      return {};
  }
}

const DEFAULT_VECTOR_FILL: Fill = { color: "F4F3FF", opacity: 1 };
const DEFAULT_VECTOR_STROKE: Stroke = { color: "7A5AF8", width: 1.5 };
const DEFAULT_VECTOR_LINE_STROKE: Stroke = {
  ...DEFAULT_VECTOR_STROKE,
  width: 2,
};

function makeVector({
  points,
  shape,
  closed = true,
  fill = DEFAULT_VECTOR_FILL,
  stroke = DEFAULT_VECTOR_STROKE,
  curve,
}: {
  points: Array<{ x: number; y: number }>;
  shape?: "polygon" | "ellipse";
  closed?: boolean;
  fill?: Fill | null;
  stroke?: Stroke | null;
  curve?: { type: "smooth"; tension?: number; segments?: number };
}): SlideElement {
  return {
    type: "vector",
    ...(shape ? { shape } : {}),
    points,
    closed,
    ...(curve ? { curve } : {}),
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
  };
}

export function createElementInsertElements(kind?: string): SlideElement[] {
  switch (kind) {
    case "vector-rectangle":
      return [
        makeVector({
          points: [
            { x: 134, y: 134 },
            { x: 518, y: 134 },
            { x: 518, y: 326 },
            { x: 134, y: 326 },
          ],
        }),
      ];
    case "vector-circle":
      return [
        makeVector({
          shape: "ellipse",
          points: ellipseVectorPoints(134, 134, 220, 220),
        }),
      ];
    case "vector-ellipse":
      return [
        makeVector({
          shape: "ellipse",
          points: ellipseVectorPoints(134, 134, 346, 198),
        }),
      ];
    case "vector-triangle":
      return [
        makeVector({
          points: [
            { x: 326, y: 122 },
            { x: 518, y: 354 },
            { x: 134, y: 354 },
          ],
        }),
      ];
    case "vector-diamond":
      return [
        makeVector({
          points: [
            { x: 326, y: 122 },
            { x: 518, y: 238 },
            { x: 326, y: 354 },
            { x: 134, y: 238 },
          ],
        }),
      ];
    case "vector-pentagon":
      return [
        makeVector({
          points: regularPolygonVectorPoints(326, 248, 150, 5, -Math.PI / 2),
        }),
      ];
    case "vector-hexagon":
      return [
        makeVector({
          points: regularPolygonVectorPoints(326, 248, 166, 6),
        }),
      ];
    case "vector-arrow":
      return [
        makeVector({
          points: [
            { x: 134, y: 206 },
            { x: 420, y: 206 },
            { x: 420, y: 158 },
            { x: 574, y: 248 },
            { x: 420, y: 338 },
            { x: 420, y: 290 },
            { x: 134, y: 290 },
          ],
        }),
      ];
    case "vector-line":
      return [
        makeVector({
          points: [
            { x: 134, y: 218 },
            { x: 569, y: 219 },
          ],
          closed: false,
          fill: null,
          stroke: DEFAULT_VECTOR_LINE_STROKE,
        }),
      ];
    default:
      return [];
  }
}

function ellipseVectorPoints(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const radiusX = width / 2;
  const radiusY = height / 2;
  const centerX = x + radiusX;
  const centerY = y + radiusY;
  return [
    { x: centerX, y },
    { x: x + width, y: centerY },
    { x: centerX, y: y + height },
    { x, y: centerY },
  ];
}

function regularPolygonVectorPoints(
  centerX: number,
  centerY: number,
  radius: number,
  sides: number,
  rotation = 0,
) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (Math.PI * 2 * index) / sides;
    return {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });
}
