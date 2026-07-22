"use client";

import { useEffect, useMemo, useState } from "react";
import Chart from "chart.js/auto";
import type {
  ChartConfiguration,
  ChartDataset,
  ChartOptions,
  Plugin,
} from "chart.js";
import { Group, Image as KonvaImage, Rect } from "react-konva";
import {
  ellipsizeChartText,
  markdownToPlainChartText,
  normalizeChartTypeName,
} from "@/components/slide-editor/charts/chart-data";
import type { DataLabelPosition } from "@/components/slide-editor/types";
import {
  asRecord,
  clamp,
  isRecord,
  readArray,
  readBoolean,
  readNumber,
  readString,
  withHash,
  type RawElement,
} from "@/components/slide-editor/model/core";

type RawChartPoint = {
  x: number;
  y: number;
  r?: number;
};

type RawChartDataset = {
  categoryColors?: string[];
  color: string;
  name: string;
  points: RawChartPoint[];
  values: number[];
};

type ChartJsKind = {
  area: boolean;
  chartJsType:
  | "bar"
  | "bubble"
  | "doughnut"
  | "line"
  | "pie"
  | "polarArea"
  | "radar"
  | "scatter";
  horizontal: boolean;
  pieLike: boolean;
  stacked: boolean;
};

type LabelBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

type LineSegment = {
  end: { x: number; y: number };
  start: { x: number; y: number };
};

const DEFAULT_CHART_COLORS = [
  "#7F22FE",
  "#155DFC",
  "#F59E0B",
  "#12B76A",
  "#EF4444",
  "#06B6D4",
  "#8B5CF6",
  "#64748B",
];

const CHART_FONT_FAMILY = "Inter, Arial, sans-serif";
const DATA_LABEL_POSITIONS = new Set(["base", "mid", "top", "outside"]);
const CHART_TITLE_DISPLAY_MAX_LENGTH = 44;
const CHART_AXIS_TITLE_DISPLAY_MAX_LENGTH = 36;
const CHART_AXIS_TICK_DISPLAY_MAX_LENGTH = 22;
const CHART_LEGEND_DISPLAY_MAX_LENGTH = 28;

export function TemplateV2ChartJsElement({
  element,
  height,
  interactive,
  width,
}: {
  element: RawElement;
  height: number;
  interactive: boolean;
  width: number;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const logicalWidth = Math.max(1, Math.round(width));
  const logicalHeight = Math.max(1, Math.round(height));
  const pixelRatio =
    typeof window === "undefined"
      ? 1
      : clamp(window.devicePixelRatio || 1, 1, interactive ? 2 : 3);
  const renderSignature = useMemo(
    () =>
      chartRenderSignature(
        element,
        logicalWidth,
        logicalHeight,
        pixelRatio,
      ),
    [element, logicalHeight, logicalWidth, pixelRatio],
  );
  const renderInput = useMemo(
    () => ({
      element,
      logicalHeight,
      logicalWidth,
      pixelRatio,
      renderSignature,
    }),
    [element, logicalHeight, logicalWidth, pixelRatio, renderSignature],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    const nextCanvas = document.createElement("canvas");
    nextCanvas.width = renderInput.logicalWidth;
    nextCanvas.height = renderInput.logicalHeight;
    nextCanvas.style.width = `${renderInput.logicalWidth}px`;
    nextCanvas.style.height = `${renderInput.logicalHeight}px`;

    const config = createChartJsConfig(
      renderInput.element,
      renderInput.logicalHeight,
      renderInput.pixelRatio,
    );

    let chart: Chart | null = null;
    try {
      chart = new Chart(nextCanvas, config);
      chart.update("none");
      setCanvas(nextCanvas);
    } catch (error) {
      console.error("Failed to render template v2 Chart.js chart:", error);
      setCanvas(null);
    }

    return () => {
      chart?.destroy();
    };
  }, [renderInput]);

  return (
    <Group listening={interactive}>
      <Rect width={width} height={height} fill="rgba(0,0,0,0)" />
      {canvas ? (
        <KonvaImage
          image={canvas}
          listening={false}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
          width={width}
          height={height}
        />
      ) : null}
    </Group>
  );
}

function chartRenderSignature(
  element: RawElement,
  width: number,
  height: number,
  pixelRatio: number,
) {
  return stableChartStringify({
    axis_color: element.axis_color,
    axisColor: element.axisColor,
    categories: element.categories,
    chart_type: element.chart_type,
    chartType: element.chartType,
    color: element.color,
    colors: element.colors,
    data: element.data,
    data_labels: element.data_labels,
    dataLabels: element.dataLabels,
    grid_color: element.grid_color,
    gridColor: element.gridColor,
    height,
    legend: element.legend,
    legend_color: element.legend_color,
    legendColor: element.legendColor,
    pixelRatio,
    series: element.series,
    showLegend: element.showLegend,
    text_color: element.text_color,
    textColor: element.textColor,
    title: element.title,
    title_color: element.title_color,
    titleColor: element.titleColor,
    width,
    x_axis: element.x_axis,
    x_axis_grid: element.x_axis_grid,
    x_axis_title: element.x_axis_title,
    xAxis: element.xAxis,
    xAxisGrid: element.xAxisGrid,
    xAxisTitle: element.xAxisTitle,
    y_axis: element.y_axis,
    y_axis_grid: element.y_axis_grid,
    y_axis_title: element.y_axis_title,
    yAxis: element.yAxis,
    yAxisGrid: element.yAxisGrid,
    yAxisTitle: element.yAxisTitle,
  });
}

function stableChartStringify(value: unknown) {
  return JSON.stringify(value, (_key, currentValue) => {
    if (!isRecord(currentValue)) return currentValue;
    return Object.keys(currentValue)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = currentValue[key];
        return result;
      }, {});
  });
}

function createChartJsConfig(
  element: RawElement,
  height: number,
  pixelRatio: number,
): ChartConfiguration {
  const kind = rawChartJsKind(element.chart_type ?? element.chartType);
  const primaryColor = safeChartColor(
    readString(element.color),
    DEFAULT_CHART_COLORS[0],
  );
  const sourceColors = readArray(element.colors).map((value) =>
    safeChartColor(String(value)),
  );
  const rawColors = sourceColors.length > 0 ? sourceColors : [primaryColor];
  const categories = rawChartCategories(element, kind.pieLike);
  const datasets = rawChartDatasets(
    element,
    categories,
    rawColors,
    kind.pieLike,
  );
  const axisColor = safeChartColor(
    readString(element.axis_color ?? element.axisColor),
    "#98A2B3",
  );
  const gridColor = safeChartColor(
    readString(element.grid_color ?? element.gridColor),
    axisColor,
  );
  const textColor = safeChartColor(
    readString(element.text_color ?? element.textColor),
    "#475467",
  );
  const titleColor = safeChartColor(
    readString(element.title_color ?? element.titleColor),
    "#344054",
  );
  const legendColor = safeChartColor(
    readString(element.legend_color ?? element.legendColor),
    textColor,
  );
  const title = markdownToPlainChartText(readString(element.title) ?? "");
  const dataLabelPosition = readDataLabelPosition(
    hasOwn(element, "data_labels") ? element.data_labels : element.dataLabels,
  );
  const showValues = dataLabelPosition != null;
  const showXAxisGrid =
    readBoolean(element.x_axis_grid ?? element.xAxisGrid) ?? true;
  const showYAxisGrid =
    readBoolean(element.y_axis_grid ?? element.yAxisGrid) ?? true;
  const showXAxis = readBoolean(element.x_axis ?? element.xAxis) ?? true;
  const showYAxis = readBoolean(element.y_axis ?? element.yAxis) ?? true;
  const xAxisTitle =
    markdownToPlainChartText(
      readString(
        "x_axis_title" in element
          ? element.x_axis_title
          : element.xAxisTitle,
      ) ?? "",
    );
  const yAxisTitle =
    markdownToPlainChartText(
      readString(
        "y_axis_title" in element
          ? element.y_axis_title
          : element.yAxisTitle,
      ) ?? "",
    );
  const fontSize = clamp(height * 0.033, 9, 18);
  const titleFontSize = clamp(height * 0.044, 11, 26);
  const valueFontSize = clamp(height * 0.029, 8, 15);
  const chartDatasets = createChartJsDatasets(kind, datasets);
  const autoShowLegend =
    kind.pieLike ||
    datasets.length > 1 ||
    Boolean(datasets[0]?.name && datasets[0].name !== "Series 1");
  const showLegend =
    readBoolean(
      "legend" in element ? element.legend : element.showLegend,
    ) ?? autoShowLegend;

  return {
    type: kind.chartJsType,
    data: {
      labels: categories.map((category) => displayChartCategoryLabel(category)),
      datasets: chartDatasets,
    },
    options: {
      animation: false,
      color: textColor,
      devicePixelRatio: pixelRatio,
      font: {
        family: CHART_FONT_FAMILY,
      },
      indexAxis: kind.horizontal ? "y" : "x",
      layout: {
        padding: kind.pieLike
          ? { top: 16, right: 20, bottom: 12, left: 20 }
          : { top: 12, right: 22, bottom: 8, left: 12 },
      },
      maintainAspectRatio: false,
      normalized: true,
      plugins: {
        legend: showLegend ? {
          display: showLegend,
          labels: {
            boxHeight: Math.max(8, fontSize * 0.8),
            boxWidth: Math.max(8, fontSize * 0.8),
            color: legendColor,
            font: {
              family: CHART_FONT_FAMILY,
              size: fontSize,
              weight: 600,
            },
            padding: Math.max(8, fontSize),
            usePointStyle: true,
          },
          position: "bottom",
        } : {
          display: false,
        },
        title: {
          color: titleColor,
          display: Boolean(title),
          font: {
            family: CHART_FONT_FAMILY,
            size: titleFontSize,
            weight: 700,
          },
          padding: {
            bottom: Math.max(16, titleFontSize * 0.8),
            top: 0,
          },
          text: title
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) =>
              ellipsizeChartText(line, CHART_TITLE_DISPLAY_MAX_LENGTH),
            ),
        },
        tooltip: {
          enabled: false,
        },
      },
      responsive: false,
      scales: chartScales({
        axisColor,
        fontSize,
        gridColor,
        kind,
        showXAxis,
        showXAxisGrid,
        showYAxis,
        showYAxisGrid,
        xAxisTitle,
        yAxisTitle,
      }),
    } as ChartOptions,
    plugins: [
      chartValueLabelsPlugin({
        enabled: showValues,
        fontSize: valueFontSize,
        horizontal: kind.horizontal,
        outsideColor: textColor,
        position: dataLabelPosition ?? "top",
      }),
    ],
  };
}

function createChartJsDatasets(
  kind: ChartJsKind,
  datasets: RawChartDataset[],
): ChartDataset[] {
  if (kind.chartJsType === "pie" || kind.chartJsType === "doughnut") {
    const dataset = datasets[0] ?? emptyDataset();
    return [
      {
        backgroundColor: categoryColors(dataset),
        borderColor: "#FFFFFF",
        borderWidth: 1,
        data: dataset.values,
        hoverOffset: 0,
        label: displayChartLegendLabel(dataset.name),
      },
    ];
  }

  if (kind.chartJsType === "polarArea") {
    const sourceDatasets = datasets.length > 0 ? datasets : [emptyDataset()];
    return sourceDatasets.map((dataset) => {
      const colors =
        sourceDatasets.length === 1
          ? categoryColors(dataset)
          : dataset.values.map(() => dataset.color);
      return {
        backgroundColor: colors.map((color) => withAlpha(color, 0.78)),
        borderColor: colors,
        borderWidth: 1,
        data: dataset.values,
        label: displayChartLegendLabel(dataset.name),
      };
    });
  }

  if (kind.chartJsType === "scatter" || kind.chartJsType === "bubble") {
    return datasets.map((dataset) => {
      const colors =
        datasets.length === 1
          ? categoryColors(dataset)
          : [withHash(dataset.color) ?? "#7F22FE"];
      return {
        backgroundColor: colors.map((color) => withAlpha(color, 0.78)),
        borderColor: colors,
        borderWidth: 2,
        data:
          kind.chartJsType === "bubble"
            ? dataset.points.map((point) => ({ ...point, r: point.r ?? 6 }))
            : dataset.points.map(({ x, y }) => ({ x, y })),
        label: displayChartLegendLabel(dataset.name),
        pointRadius: kind.chartJsType === "scatter" ? 4 : undefined,
        pointHoverRadius: 4,
      };
    });
  }

  return datasets.map((dataset, index) => {
    const color =
      withHash(dataset.color) ??
      DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length];
    const isLineLike = kind.chartJsType === "line";
    const datasetCategoryColors =
      datasets.length === 1 && dataset.categoryColors?.length
        ? categoryColors(dataset)
        : null;

    return {
      backgroundColor: kind.area
        ? withAlpha(color, 0.24)
        : isLineLike
          ? color
          : datasetCategoryColors
            ? datasetCategoryColors
            : color,
      borderColor: color,
      borderRadius:
        kind.chartJsType === "bar"
          ? kind.stacked
            ? 7
            : (context: { raw: unknown }) =>
                barBorderRadius(context.raw, kind.horizontal)
          : undefined,
      borderSkipped:
        kind.chartJsType === "bar" && kind.stacked ? "start" : false,
      borderWidth: isLineLike ? 3 : 0,
      data: dataset.values,
      fill: kind.area,
      label: displayChartLegendLabel(dataset.name),
      maxBarThickness: 62,
      pointBackgroundColor: datasetCategoryColors ?? color,
      pointBorderColor: "#FFFFFF",
      pointBorderWidth: isLineLike ? 1.5 : 0,
      pointRadius: isLineLike ? 3.5 : 0,
      tension: isLineLike ? 0.35 : 0,
    };
  });
}

function barBorderRadius(rawValue: unknown, horizontal: boolean) {
  const radius = 7;
  const value = chartValue(rawValue);

  if (horizontal) {
    return value < 0
      ? {
        bottomLeft: radius,
        bottomRight: 0,
        topLeft: radius,
        topRight: 0,
      }
      : {
        bottomLeft: 0,
        bottomRight: radius,
        topLeft: 0,
        topRight: radius,
      };
  }

  return value < 0
    ? {
      bottomLeft: radius,
      bottomRight: radius,
      topLeft: 0,
      topRight: 0,
    }
    : {
      bottomLeft: 0,
      bottomRight: 0,
      topLeft: radius,
      topRight: radius,
    };
}

function chartScales({
  axisColor,
  fontSize,
  gridColor,
  kind,
  showXAxis,
  showXAxisGrid,
  showYAxis,
  showYAxisGrid,
  xAxisTitle,
  yAxisTitle,
}: {
  axisColor: string;
  fontSize: number;
  gridColor: string;
  kind: ChartJsKind;
  showXAxis: boolean;
  showXAxisGrid: boolean;
  showYAxis: boolean;
  showYAxisGrid: boolean;
  xAxisTitle: string;
  yAxisTitle: string;
}) {
  if (kind.pieLike || kind.chartJsType === "polarArea") return undefined;

  if (kind.chartJsType === "radar") {
    return {
      r: {
        angleLines: {
          color: withAlpha(gridColor, showXAxisGrid ? 0.35 : 0),
          display: showXAxisGrid,
        },
        beginAtZero: true,
        grid: {
          color: withAlpha(gridColor, showYAxisGrid ? 0.35 : 0),
          display: showYAxisGrid,
        },
        pointLabels: {
          color: axisColor,
          display: showXAxis,
          font: {
            family: CHART_FONT_FAMILY,
            size: fontSize,
            weight: 600,
          },
        },
        ticks: {
          backdropColor: "transparent",
          callback: (value: string | number) => formatAxisTick(value),
          color: axisColor,
          display: showYAxis,
          font: {
            family: CHART_FONT_FAMILY,
            size: Math.max(8, fontSize - 1),
          },
        },
      },
    };
  }

  const showCategoryGrid = kind.horizontal
    ? showXAxisGrid
    : showYAxisGrid;
  const showLinearGrid = kind.horizontal ? showYAxisGrid : showXAxisGrid;
  const showCategoryAxis = kind.horizontal ? showYAxis : showXAxis;
  const showLinearAxis = kind.horizontal ? showXAxis : showYAxis;

  const categoryAxis = {
    display: showCategoryAxis || showCategoryGrid,
    border: {
      color: axisColor,
      display: showCategoryAxis,
    },
    grid: {
      color: withAlpha(gridColor, showCategoryGrid ? 0.25 : 0),
      display: showCategoryGrid,
      drawTicks: showCategoryAxis,
    },
    stacked: kind.stacked,
    ticks: {
      color: axisColor,
      display: showCategoryAxis,
      font: {
        family: CHART_FONT_FAMILY,
        size: fontSize,
        weight: 600,
      },
    },
    title: {
      color: axisColor,
      display:
        showCategoryAxis &&
        Boolean(kind.horizontal ? yAxisTitle : xAxisTitle),
      font: {
        family: CHART_FONT_FAMILY,
        size: fontSize,
        weight: 700,
      },
      text: ellipsizeChartText(
        kind.horizontal ? yAxisTitle : xAxisTitle,
        CHART_AXIS_TITLE_DISPLAY_MAX_LENGTH,
      ),
    },
    type: "category",
  };
  const linearAxis = {
    beginAtZero: true,
    display: showLinearAxis || showLinearGrid,
    border: {
      color: axisColor,
      display: showLinearAxis,
    },
    grace: "8%",
    grid: {
      color: withAlpha(gridColor, showLinearGrid ? 0.35 : 0),
      display: showLinearGrid,
      drawTicks: showLinearAxis,
    },
    stacked: kind.stacked,
    ticks: {
      callback: (value: string | number) => formatAxisTick(value),
      color: axisColor,
      display: showLinearAxis,
      font: {
        family: CHART_FONT_FAMILY,
        size: Math.max(8, fontSize - 2),
        weight: 600,
      },
    },
    title: {
      color: axisColor,
      display:
        showLinearAxis &&
        Boolean(kind.horizontal ? xAxisTitle : yAxisTitle),
      font: {
        family: CHART_FONT_FAMILY,
        size: fontSize,
        weight: 700,
      },
      text: ellipsizeChartText(
        kind.horizontal ? xAxisTitle : yAxisTitle,
        CHART_AXIS_TITLE_DISPLAY_MAX_LENGTH,
      ),
    },
    type: "linear",
  };

  if (kind.chartJsType === "scatter" || kind.chartJsType === "bubble") {
    return {
      x: {
        ...linearAxis,
        display: showXAxis || showYAxisGrid,
        border: {
          ...linearAxis.border,
          display: showXAxis,
        },
        grid: {
          color: withAlpha(gridColor, showYAxisGrid ? 0.35 : 0),
          display: showYAxisGrid,
          drawTicks: showXAxis,
        },
        ticks: {
          ...linearAxis.ticks,
          display: showXAxis,
        },
        title: {
          ...linearAxis.title,
          display: showXAxis && Boolean(xAxisTitle),
          text: ellipsizeChartText(
            xAxisTitle,
            CHART_AXIS_TITLE_DISPLAY_MAX_LENGTH,
          ),
        },
      },
      y: {
        ...linearAxis,
        display: showYAxis || showXAxisGrid,
        border: {
          ...linearAxis.border,
          display: showYAxis,
        },
        grid: {
          color: withAlpha(gridColor, showXAxisGrid ? 0.35 : 0),
          display: showXAxisGrid,
          drawTicks: showYAxis,
        },
        ticks: {
          ...linearAxis.ticks,
          display: showYAxis,
        },
        title: {
          ...linearAxis.title,
          display: showYAxis && Boolean(yAxisTitle),
          text: ellipsizeChartText(
            yAxisTitle,
            CHART_AXIS_TITLE_DISPLAY_MAX_LENGTH,
          ),
        },
      },
    };
  }

  return kind.horizontal
    ? { x: linearAxis, y: categoryAxis }
    : { x: categoryAxis, y: linearAxis };
}

function rawChartJsKind(value: unknown): ChartJsKind {
  const normalized = normalizeChartTypeName(value);

  switch (normalized) {
    case "area":
      return baseKind("line", { area: true });
    case "bubble":
      return baseKind("bubble");
    case "donut":
    case "doughnut":
      return baseKind("doughnut", { pieLike: true });
    case "horizontal_bar":
    case "bar_horizontal":
      return baseKind("bar", { horizontal: true });
    case "line":
      return baseKind("line");
    case "pie":
      return baseKind("pie", { pieLike: true });
    case "polar":
    case "polar_area":
      return baseKind("polarArea");
    case "radar":
      return baseKind("radar");
    case "scatter":
      return baseKind("scatter");
    case "stackedbar":
    case "stacked_bar":
    case "bar_stacked":
    case "stacked":
      return baseKind("bar", { stacked: true });
    case "horizontalstackbar":
    case "horizontalstackedbar":
    case "horizontal_stack_bar":
    case "horizontal_stacked_bar":
      return baseKind("bar", { horizontal: true, stacked: true });
    case "bar":
    default:
      return baseKind("bar");
  }
}

function baseKind(
  chartJsType: ChartJsKind["chartJsType"],
  overrides: Partial<ChartJsKind> = {},
): ChartJsKind {
  return {
    area: false,
    chartJsType,
    horizontal: false,
    pieLike: false,
    stacked: false,
    ...overrides,
  };
}

function rawChartCategories(
  element: RawElement,
  singleSeriesOnly = false,
): string[] {
  const categories = readArray(element.categories).map(String);
  const dataLabels = readArray(element.data)
    .map((item) => readString(asRecord(item)?.label))
    .filter((label): label is string => Boolean(label));
  const rawSeries = readArray(element.series).filter(isRecord);
  const series = singleSeriesOnly ? rawSeries.slice(0, 1) : rawSeries;
  const length = Math.min(
    24,
    Math.max(
      1,
      categories.length,
      dataLabels.length,
      ...series.map((item) => readArray(item.values ?? item.data).length),
    ),
  );

  if (categories.length > 0) {
    return Array.from(
      { length },
      (_, index) => categories[index] ?? `Item ${index + 1}`,
    );
  }
  if (dataLabels.length > 0) {
    return Array.from(
      { length },
      (_, index) => dataLabels[index] ?? `Item ${index + 1}`,
    );
  }

  return Array.from({ length }, (_, index) => `Item ${index + 1}`);
}

function rawChartDatasets(
  element: RawElement,
  categories: string[],
  colors: string[],
  singleSeriesOnly = false,
): RawChartDataset[] {
  const rawSeries = readArray(element.series).filter(isRecord);
  const effectiveSeries = singleSeriesOnly ? rawSeries.slice(0, 1) : rawSeries;
  const categoryLength = Math.max(1, categories.length);

  if (effectiveSeries.length > 0) {
    return effectiveSeries.slice(0, 12).map((item, index) => {
      const rawValues = readArray(item.values ?? item.data);
      const values = normalizeValues(
        rawValues.map((value) => chartValue(value)),
        categoryLength,
      );
      const points = normalizePoints(
        rawValues.map((value, valueIndex) => chartPoint(value, valueIndex)),
        categoryLength,
        values,
      );

      return {
        color:
          colors[index % colors.length] ??
          DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length],
        name: readString(item.name) ?? `Series ${index + 1}`,
        categoryColors: effectiveSeries.length === 1 ? colors : undefined,
        points,
        values,
      };
    });
  }

  const rawData = readArray(element.data).filter(isRecord);
  const values = normalizeValues(
    rawData.map((item) => chartValue(item)),
    categoryLength,
  );
  return [
    {
      color:
        colors[0] ??
        safeChartColor(readString(element.color), DEFAULT_CHART_COLORS[0]),
      name: readString(element.title) ?? "Series 1",
      categoryColors: colors,
      points: normalizePoints(
        rawData.map((value, valueIndex) => chartPoint(value, valueIndex)),
        categoryLength,
        values,
      ),
      values,
    },
  ];
}

function chartValue(value: unknown) {
  const directNumber = readNumber(value);
  if (directNumber != null) return directNumber;

  const record = asRecord(value);
  return (
    readNumber(record?.value) ??
    readNumber(record?.y) ??
    readNumber(record?.data) ??
    0
  );
}

function chartPoint(value: unknown, index: number): RawChartPoint {
  const record = asRecord(value);
  if (!record) {
    return { x: index + 1, y: chartValue(value) };
  }

  return {
    x: readNumber(record.x) ?? index + 1,
    y: chartValue(record),
    ...(readNumber(record.r ?? record.radius) != null
      ? { r: readNumber(record.r ?? record.radius) ?? undefined }
      : {}),
  };
}

function normalizeValues(values: number[], length: number) {
  const normalized = values.slice(0, length);
  while (normalized.length < length) normalized.push(0);
  return normalized;
}

function normalizePoints(
  points: RawChartPoint[],
  length: number,
  fallbackValues: number[],
) {
  const normalized = points.slice(0, length);
  while (normalized.length < length) {
    const index = normalized.length;
    normalized.push({ x: index + 1, y: fallbackValues[index] ?? 0 });
  }
  return normalized;
}

function emptyDataset(): RawChartDataset {
  return {
    color: DEFAULT_CHART_COLORS[0],
    name: "Series 1",
    points: [{ x: 1, y: 0 }],
    values: [0],
  };
}

function categoryColors(dataset: RawChartDataset) {
  const colors = dataset.categoryColors ?? [];
  return dataset.values.map(
    (_, index) =>
      withHash(colors[index % colors.length]) ??
      withHash(dataset.color) ??
      DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length],
  );
}

function readDataLabelPosition(value: unknown): DataLabelPosition | null {
  if (value === true) return "top";
  if (value === false || value == null) return null;
  const text = readString(value);
  return text && DATA_LABEL_POSITIONS.has(text)
    ? (text as DataLabelPosition)
    : null;
}

function hasOwn(record: RawElement, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function chartValueLabelsPlugin({
  enabled,
  fontSize,
  horizontal,
  outsideColor,
  position,
}: {
  enabled: boolean;
  fontSize: number;
  horizontal: boolean;
  outsideColor: string;
  position: DataLabelPosition;
}): Plugin {
  return {
    id: "templateV2ChartValueLabels",
    afterDatasetsDraw(chart) {
      if (!enabled) return;

      const ctx = chart.ctx;
      ctx.save();
      ctx.font = `600 ${fontSize}px ${CHART_FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const occupiedLabels: LabelBounds[] = [];
      const lineObstacles: LineSegment[] = [];
      const pointObstacles: LabelBounds[] = [];

      chart.data.datasets.forEach((_, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        const metaType = readString((meta as { type?: unknown }).type);
        if (meta.hidden || !isPointChartType(metaType)) return;
        meta.data.forEach((element) => {
          const bounds = pointElementBounds(element);
          if (bounds) pointObstacles.push(bounds);
        });
        if (metaType === "line" || metaType === "radar") {
          for (let index = 1; index < meta.data.length; index += 1) {
            const start = chartElementPoint(meta.data[index - 1]);
            const end = chartElementPoint(meta.data[index]);
            if (start && end) lineObstacles.push({ start, end });
          }
        }
      });

      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        if (meta.hidden) return;

        meta.data.forEach((element, index) => {
          const rawValue = readArray(dataset.data)[index];
          const numeric = chartValue(rawValue);
          const metaType = readString((meta as { type?: unknown }).type);
          const label = formatChartValue(numeric);

          if (metaType === "bar") {
            drawBarValueLabel({
              color: datasetBackgroundColor(dataset, index),
              ctx,
              element,
              fontSize,
              horizontal,
              label,
              outsideColor,
              position,
              value: numeric,
            });
            return;
          }

          if (isPointChartType(metaType)) {
            drawPointValueLabel({
              chartArea: chart.chartArea,
              ctx,
              datasetIndex,
              element,
              fontSize,
              index,
              label,
              lineLike: metaType === "line" || metaType === "radar",
              lineObstacles,
              metaElements: meta.data,
              occupiedLabels,
              outsideColor,
              position,
              pointObstacles,
            });
            return;
          }

          if (
            metaType === "pie" ||
            metaType === "doughnut" ||
            metaType === "polarArea"
          ) {
            drawArcValueLabel({
              color: datasetBackgroundColor(dataset, index),
              ctx,
              element,
              fontSize,
              label,
              outsideColor,
              position,
            });
            return;
          }

          const fallbackPosition =
            typeof element.tooltipPosition === "function"
              ? element.tooltipPosition(true)
              : null;
          if (!fallbackPosition) return;

          ctx.fillStyle =
            metaType === "pie" ||
              metaType === "doughnut" ||
              metaType === "polarArea"
              ? contrastTextColor(
                datasetBackgroundColor(dataset, index),
                outsideColor,
              )
              : outsideColor;
          ctx.fillText(label, (fallbackPosition.x ?? 0), (fallbackPosition.y ?? 0));
        });
      });

      ctx.restore();
    },
  };
}

function drawBarValueLabel({
  color,
  ctx,
  element,
  fontSize,
  horizontal,
  label,
  outsideColor,
  position,
  value,
}: {
  color: string | null;
  ctx: CanvasRenderingContext2D;
  element: unknown;
  fontSize: number;
  horizontal: boolean;
  label: string;
  outsideColor: string;
  position: DataLabelPosition;
  value: number;
}) {
  const bar = asRecord(element);
  const x = readNumber(bar?.x);
  const y = readNumber(bar?.y);
  const base = readNumber(bar?.base);
  const width = Math.abs(readNumber(bar?.width) ?? 0);
  const height = Math.abs(readNumber(bar?.height) ?? 0);
  if (x == null || y == null || base == null) return;

  const textWidth = ctx.measureText(label).width;
  const padding = 5;
  const fitsInside = horizontal
    ? width >= textWidth + padding * 2 && height >= fontSize * 1.35
    : height >= fontSize * 1.65 && width >= textWidth + padding * 2;
  const resolvedPosition =
    position === "outside" || !fitsInside ? "outside" : position;

  if (resolvedPosition !== "outside") {
    ctx.fillStyle = contrastTextColor(color, outsideColor);
    if (horizontal) {
      const direction = value < 0 ? -1 : 1;
      const labelX =
        resolvedPosition === "base"
          ? base + direction * (textWidth / 2 + padding)
          : resolvedPosition === "top"
            ? x - direction * (textWidth / 2 + padding)
            : (x + base) / 2;
      ctx.fillText(label, labelX, y);
      return;
    }

    const direction = value < 0 ? 1 : -1;
    const labelY =
      resolvedPosition === "base"
        ? base + direction * (fontSize / 2 + padding)
        : resolvedPosition === "top"
          ? y - direction * (fontSize / 2 + padding)
          : (y + base) / 2;
    ctx.fillText(
      label,
      x,
      labelY,
    );
    return;
  }

  ctx.fillStyle = outsideColor;
  if (horizontal) {
    const direction = value < 0 ? -1 : 1;
    ctx.fillText(
      label,
      x + direction * (textWidth / 2 + padding),
      y,
    );
    return;
  }

  const direction = value < 0 ? 1 : -1;
  ctx.fillText(label, x, y + direction * (fontSize / 2 + padding));
}

function drawPointValueLabel({
  chartArea,
  ctx,
  datasetIndex,
  element,
  fontSize,
  index,
  label,
  lineLike,
  lineObstacles,
  metaElements,
  occupiedLabels,
  outsideColor,
  position,
  pointObstacles,
}: {
  chartArea: LabelBounds;
  ctx: CanvasRenderingContext2D;
  datasetIndex: number;
  element: unknown;
  fontSize: number;
  index: number;
  label: string;
  lineLike: boolean;
  lineObstacles: LineSegment[];
  metaElements: unknown[];
  occupiedLabels: LabelBounds[];
  outsideColor: string;
  position: DataLabelPosition;
  pointObstacles: LabelBounds[];
}) {
  const point = asRecord(element);
  const x = readNumber(point?.x);
  const y = readNumber(point?.y);
  if (!point || x == null || y == null) return;

  const radius = pointElementRadius(point);
  const textWidth = ctx.measureText(label).width;
  const textHeight = fontSize * 1.15;
  const verticalDirection = lineLike
    ? lineLabelDirection(metaElements, index, datasetIndex)
    : (index + datasetIndex) % 2 === 0
      ? -1
      : 1;
  const verticalOffset = radius + textHeight / 2 + 5;
  const horizontalOffset = radius + textWidth / 2 + 5;

  if (position !== "outside") {
    const candidate =
      position === "base"
        ? { x, y: y + verticalOffset }
        : position === "top"
          ? { x, y: y - verticalOffset }
          : { x, y };
    const bounds = valueLabelBounds(
      candidate.x,
      candidate.y,
      textWidth,
      textHeight,
    );
    const intersectsPoint =
      position !== "mid" &&
      pointObstacles.some((obstacle) => labelBoundsOverlap(bounds, obstacle));
    if (
      labelFitsChartArea(bounds, chartArea) &&
      occupiedLabels.every(
        (occupied) => !labelBoundsOverlap(bounds, occupied),
      ) &&
      !intersectsPoint &&
      lineObstacles.every(
        (segment) => !lineSegmentIntersectsBounds(segment, bounds),
      )
    ) {
      occupiedLabels.push(bounds);
      ctx.fillStyle = outsideColor;
      ctx.fillText(label, candidate.x, candidate.y);
      return;
    }
  }

  const candidates = [
    { x, y: y + verticalDirection * verticalOffset },
    { x, y: y - verticalDirection * verticalOffset },
    { x: x + horizontalOffset, y },
    { x: x - horizontalOffset, y },
    {
      x: x + horizontalOffset,
      y: y + verticalDirection * verticalOffset,
    },
    {
      x: x - horizontalOffset,
      y: y + verticalDirection * verticalOffset,
    },
    {
      x: x + horizontalOffset,
      y: y - verticalDirection * verticalOffset,
    },
    {
      x: x - horizontalOffset,
      y: y - verticalDirection * verticalOffset,
    },
    { x, y: y + verticalDirection * verticalOffset * 1.7 },
    { x, y: y - verticalDirection * verticalOffset * 1.7 },
  ];

  const availableCandidate = candidates
    .map((candidate) => ({
      ...candidate,
      bounds: valueLabelBounds(
        candidate.x,
        candidate.y,
        textWidth,
        textHeight,
      ),
    }))
    .find(
      (candidate) =>
        labelFitsChartArea(candidate.bounds, chartArea) &&
        occupiedLabels.every(
          (occupied) => !labelBoundsOverlap(candidate.bounds, occupied),
        ) &&
        pointObstacles.every(
          (obstacle) => !labelBoundsOverlap(candidate.bounds, obstacle),
        ) &&
        lineObstacles.every(
          (segment) => !lineSegmentIntersectsBounds(segment, candidate.bounds),
        ),
    );
  if (!availableCandidate) return;
  const resolved = availableCandidate;
  const bounds = valueLabelBounds(
    resolved.x,
    resolved.y,
    textWidth,
    textHeight,
  );

  occupiedLabels.push(bounds);
  ctx.fillStyle = outsideColor;
  ctx.fillText(label, resolved.x, resolved.y);
}

function drawArcValueLabel({
  color,
  ctx,
  element,
  fontSize,
  label,
  outsideColor,
  position,
}: {
  color: string | null;
  ctx: CanvasRenderingContext2D;
  element: unknown;
  fontSize: number;
  label: string;
  outsideColor: string;
  position: DataLabelPosition;
}) {
  const arc = asRecord(element);
  const centerX = readNumber(arc?.x);
  const centerY = readNumber(arc?.y);
  const startAngle = readNumber(arc?.startAngle);
  const endAngle = readNumber(arc?.endAngle);
  const innerRadius = Math.max(0, readNumber(arc?.innerRadius) ?? 0);
  const outerRadius = Math.max(innerRadius, readNumber(arc?.outerRadius) ?? 0);

  let point: { x: number; y: number } | null = null;
  if (
    centerX != null &&
    centerY != null &&
    startAngle != null &&
    endAngle != null &&
    outerRadius > 0
  ) {
    const angle = (startAngle + endAngle) / 2;
    const ringWidth = Math.max(1, outerRadius - innerRadius);
    const textHeight = fontSize * 1.15;
    const radius =
      position === "outside"
        ? outerRadius + textHeight / 2 + 7
        : position === "top"
          ? Math.max(innerRadius + textHeight / 2, outerRadius - textHeight / 2 - 5)
          : position === "base"
            ? innerRadius > 0
              ? innerRadius + Math.min(ringWidth * 0.25, textHeight + 5)
              : outerRadius * 0.35
            : innerRadius + ringWidth / 2;
    point = {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
  } else if (typeof arc?.tooltipPosition === "function") {
    point = arc.tooltipPosition(true);
  }

  if (!point) return;
  ctx.fillStyle =
    position === "outside"
      ? outsideColor
      : contrastTextColor(color, outsideColor);
  ctx.fillText(label, point.x, point.y);
}

function isPointChartType(metaType: string | null) {
  return (
    metaType === "line" ||
    metaType === "scatter" ||
    metaType === "bubble" ||
    metaType === "radar"
  );
}

function pointElementRadius(point: RawElement) {
  const options = asRecord(point.options);
  return Math.max(
    0,
    readNumber(options?.radius) ?? readNumber(point.radius) ?? 3,
  );
}

function pointElementBounds(element: unknown): LabelBounds | null {
  const point = asRecord(element);
  const x = readNumber(point?.x);
  const y = readNumber(point?.y);
  if (!point || x == null || y == null) return null;

  const radius = pointElementRadius(point) + 2;
  return {
    bottom: y + radius,
    left: x - radius,
    right: x + radius,
    top: y - radius,
  };
}

function lineLabelDirection(
  elements: unknown[],
  index: number,
  datasetIndex: number,
) {
  const currentY = readNumber(asRecord(elements[index])?.y);
  const previousY = readNumber(asRecord(elements[index - 1])?.y);
  const nextY = readNumber(asRecord(elements[index + 1])?.y);
  if (currentY == null) return datasetIndex % 2 === 0 ? -1 : 1;

  if (previousY != null && nextY != null) {
    if (currentY <= previousY && currentY <= nextY) return -1;
    if (currentY >= previousY && currentY >= nextY) return 1;
  }
  if (nextY != null && previousY == null) return nextY < currentY ? 1 : -1;
  if (previousY != null && nextY == null) {
    return previousY < currentY ? 1 : -1;
  }
  return datasetIndex % 2 === 0 ? -1 : 1;
}

function chartElementPoint(element: unknown) {
  const point = asRecord(element);
  const x = readNumber(point?.x);
  const y = readNumber(point?.y);
  return x == null || y == null ? null : { x, y };
}

function lineSegmentIntersectsBounds(
  segment: LineSegment,
  bounds: LabelBounds,
) {
  if (
    pointInsideBounds(segment.start, bounds) ||
    pointInsideBounds(segment.end, bounds)
  ) {
    return true;
  }

  const topLeft = { x: bounds.left, y: bounds.top };
  const topRight = { x: bounds.right, y: bounds.top };
  const bottomLeft = { x: bounds.left, y: bounds.bottom };
  const bottomRight = { x: bounds.right, y: bounds.bottom };
  return (
    lineSegmentsIntersect(segment.start, segment.end, topLeft, topRight) ||
    lineSegmentsIntersect(segment.start, segment.end, topRight, bottomRight) ||
    lineSegmentsIntersect(segment.start, segment.end, bottomRight, bottomLeft) ||
    lineSegmentsIntersect(segment.start, segment.end, bottomLeft, topLeft)
  );
}

function pointInsideBounds(
  point: { x: number; y: number },
  bounds: LabelBounds,
) {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

function lineSegmentsIntersect(
  firstStart: { x: number; y: number },
  firstEnd: { x: number; y: number },
  secondStart: { x: number; y: number },
  secondEnd: { x: number; y: number },
) {
  if (
    Math.max(firstStart.x, firstEnd.x) < Math.min(secondStart.x, secondEnd.x) ||
    Math.min(firstStart.x, firstEnd.x) > Math.max(secondStart.x, secondEnd.x) ||
    Math.max(firstStart.y, firstEnd.y) < Math.min(secondStart.y, secondEnd.y) ||
    Math.min(firstStart.y, firstEnd.y) > Math.max(secondStart.y, secondEnd.y)
  ) {
    return false;
  }

  const firstA = lineSide(firstStart, firstEnd, secondStart);
  const firstB = lineSide(firstStart, firstEnd, secondEnd);
  const secondA = lineSide(secondStart, secondEnd, firstStart);
  const secondB = lineSide(secondStart, secondEnd, firstEnd);
  return firstA * firstB <= 0 && secondA * secondB <= 0;
}

function lineSide(
  start: { x: number; y: number },
  end: { x: number; y: number },
  point: { x: number; y: number },
) {
  return (
    (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x)
  );
}

function valueLabelBounds(
  x: number,
  y: number,
  width: number,
  height: number,
): LabelBounds {
  const padding = 2;
  return {
    bottom: y + height / 2 + padding,
    left: x - width / 2 - padding,
    right: x + width / 2 + padding,
    top: y - height / 2 - padding,
  };
}

function labelFitsChartArea(bounds: LabelBounds, chartArea: LabelBounds) {
  return (
    bounds.left >= chartArea.left &&
    bounds.right <= chartArea.right &&
    bounds.top >= chartArea.top &&
    bounds.bottom <= chartArea.bottom
  );
}

function labelBoundsOverlap(first: LabelBounds, second: LabelBounds) {
  return !(
    first.right < second.left ||
    first.left > second.right ||
    first.bottom < second.top ||
    first.top > second.bottom
  );
}

function datasetBackgroundColor(dataset: ChartDataset, index: number) {
  const backgroundColor = (dataset as { backgroundColor?: unknown })
    .backgroundColor;
  const color = Array.isArray(backgroundColor)
    ? backgroundColor[index]
    : backgroundColor;
  return typeof color === "string" ? color : null;
}

function contrastTextColor(backgroundColor: string | null, fallback: string) {
  const background = parseChartColor(backgroundColor);
  if (!background) return fallback;

  const [red, green, blue, alpha] = background;
  const composite = [red, green, blue].map(
    (channel) => channel * alpha + 255 * (1 - alpha),
  );
  const backgroundLuminance = relativeLuminance(composite);
  const dark = [16, 24, 40];
  const light = [255, 255, 255];
  const darkContrast = contrastRatio(
    backgroundLuminance,
    relativeLuminance(dark),
  );
  const lightContrast = contrastRatio(
    backgroundLuminance,
    relativeLuminance(light),
  );
  return lightContrast >= darkContrast ? "#FFFFFF" : "#101828";
}

function parseChartColor(
  color: string | null,
): [number, number, number, number] | null {
  if (!color) return null;
  const hex = color.match(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/);
  if (hex) {
    const raw =
      hex[1].length === 3
        ? hex[1]
          .split("")
          .map((character) => character + character)
          .join("")
        : hex[1];
    const value = Number.parseInt(raw, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 1];
  }

  const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;
  const channels = rgb[1].split(",").map((part) => Number(part.trim()));
  if (channels.length < 3 || channels.slice(0, 3).some(Number.isNaN)) {
    return null;
  }
  return [
    clamp(channels[0], 0, 255),
    clamp(channels[1], 0, 255),
    clamp(channels[2], 0, 255),
    clamp(Number.isFinite(channels[3]) ? channels[3] : 1, 0, 1),
  ];
}

function relativeLuminance(channels: number[]) {
  const [red, green, blue] = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(first: number, second: number) {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

const COMPACT_NUMBER_SUFFIXES = [
  "",
  "K",
  "M",
  "B",
  "T",
  "Qa",
  "Qi",
  "Sx",
  "Sp",
  "Oc",
  "No",
  "Dc",
];

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  const absolute = Math.abs(value);
  if (absolute < 1000) {
    return Number.isInteger(value) ? `${value}` : value.toFixed(1).replace(/\.0$/, "");
  }

  let suffixIndex = Math.floor(Math.log10(absolute) / 3);
  if (suffixIndex >= COMPACT_NUMBER_SUFFIXES.length) {
    return value.toExponential(2).replace(/\.?0+e/, "e");
  }

  let scaled = value / 1000 ** suffixIndex;
  let formatted = formatScaledCompactNumber(scaled);
  if (Math.abs(Number(formatted)) >= 1000 && suffixIndex < COMPACT_NUMBER_SUFFIXES.length - 1) {
    suffixIndex += 1;
    scaled = value / 1000 ** suffixIndex;
    formatted = formatScaledCompactNumber(scaled);
  }
  return `${formatted}${COMPACT_NUMBER_SUFFIXES[suffixIndex]}`;
}

function formatScaledCompactNumber(value: number) {
  const absolute = Math.abs(value);
  const decimals = absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2;
  return Number(value.toFixed(decimals)).toString();
}

function formatChartValue(value: number) {
  return formatCompactNumber(value);
}

function formatAxisTick(value: string | number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? formatChartValue(numeric) : String(value);
}

function displayChartCategoryLabel(value: string) {
  return ellipsizeChartText(value, CHART_AXIS_TICK_DISPLAY_MAX_LENGTH);
}

function displayChartLegendLabel(value: string) {
  return ellipsizeChartText(value, CHART_LEGEND_DISPLAY_MAX_LENGTH);
}

function safeChartColor(
  value: string | null | undefined,
  fallback = DEFAULT_CHART_COLORS[0],
) {
  const color = withHash(value) ?? fallback;
  if (
    /^#[0-9A-Fa-f]{3}$/.test(color) ||
    /^#[0-9A-Fa-f]{6}$/.test(color) ||
    /^rgba?\(/i.test(color)
  ) {
    return color;
  }
  return fallback;
}

function withAlpha(color: string, alpha: number) {
  const normalized = safeChartColor(color);
  const hex = normalized.match(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/);
  if (!hex) {
    const rgb = normalized.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
      const channels = rgb[1]
        .split(",")
        .slice(0, 3)
        .map((part) => part.trim());
      return `rgba(${channels.join(", ")}, ${alpha})`;
    }
    return normalized;
  }

  const raw =
    hex[1].length === 3
      ? hex[1].split("").map((char) => char + char).join("")
      : hex[1];
  const int = Number.parseInt(raw, 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}
