"use client";

import { useEffect, type RefObject } from "react";

import { loadChartBrowserRuntime } from "@/lib/chart-browser";

export function useSmartChartInjection({
  html,
  instanceId,
  containerRef,
}: {
  html: string;
  instanceId: string;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const container = containerRef.current;
      if (!container || !html) return;

      try {
        const { Chart } = await loadChartBrowserRuntime();
        if (cancelled) return;

        container.querySelectorAll<HTMLCanvasElement>("canvas").forEach((canvas) => {
          Chart.getChart(canvas)?.destroy();
        });
        document
          .querySelectorAll(`script[data-smart-chart-instance="${instanceId}"]`)
          .forEach((script) => script.remove());

        container.querySelectorAll<HTMLScriptElement>("script").forEach((source) => {
          if (!source.textContent?.trim()) return;

          const script = document.createElement("script");
          script.dataset.smartChartInstance = instanceId;
          script.textContent = `
            try {
              (function () {
                var root = document.querySelector('[data-smart-slide-instance="${instanceId}"]');
                if (!root) return;
                var scopedDocument = Object.create(document);
                scopedDocument.querySelector = root.querySelector.bind(root);
                scopedDocument.querySelectorAll = root.querySelectorAll.bind(root);
                scopedDocument.getElementById = function (id) {
                  try {
                    return root.querySelector('#' + CSS.escape(id));
                  } catch (_) {
                    return null;
                  }
                };
                (function (document) {
                  ${source.textContent}
                })(scopedDocument);
              })();
            } catch (error) {
              console.error('Smart slide chart failed to render', error);
            }
          `;
          document.body.appendChild(script);
        });
      } catch (error) {
        console.error("Could not initialize Smart slide charts", error);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document
        .querySelectorAll(`script[data-smart-chart-instance="${instanceId}"]`)
        .forEach((script) => script.remove());
    };
  }, [containerRef, html, instanceId]);
}
