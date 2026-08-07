"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, RefreshCw, Sparkles } from "lucide-react";

import SmartHtmlSlide from "../../components/SmartHtmlSlide";
import {
  CommunityPresentationApi,
  type CommunityPresentation,
} from "../../services/api/community";

export default function CommunityReferencePicker({
  selectedId,
  onSelect,
}: {
  selectedId: number | null;
  onSelect: (presentation: CommunityPresentation | null) => void;
}) {
  const [items, setItems] = useState<CommunityPresentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    CommunityPresentationApi.list(controller.signal)
      .then((response) => setItems(response.results ?? []))
      .catch((requestError) => {
        if ((requestError as Error)?.name !== "AbortError") setError(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  };

  useEffect(load, []);

  return (
    <section className="rounded-xl border border-[#E7E4F4] bg-[#FAF9FF] p-3 min-[1800px]:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#29243D]">
            <Sparkles className="h-4 w-4 text-[#6C55D9]" />
            Community design reference
          </div>
          <p className="mt-1 text-xs text-[#777184]">
            Optional. Smart mode follows the selected deck&apos;s visual language.
          </p>
        </div>
        {selectedId !== null && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="shrink-0 rounded-full border border-[#DCD7EE] bg-white px-3 py-1 text-xs text-[#5E5870] hover:bg-[#F3F0FB]"
          >
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex h-24 items-center justify-center text-[#6C55D9]">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <button
          type="button"
          onClick={load}
          className="flex h-24 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#DCD7EE] text-xs text-[#6C55D9]"
        >
          <RefreshCw className="h-4 w-4" /> Retry community references
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {items.map((item) => {
            const selected = selectedId === item.id;
            const preview = item.slides?.find((slide) => slide.trim());
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(selected ? null : item)}
                className={`overflow-hidden rounded-lg border bg-white text-left transition ${
                  selected
                    ? "border-[#6C55D9] ring-2 ring-[#6C55D9]/20"
                    : "border-[#E5E2EC] hover:border-[#A99AE5]"
                }`}
              >
                <div className="relative aspect-video overflow-hidden bg-[#F0EEF5]">
                  {preview ? (
                    <SmartHtmlSlide html={preview} fonts={item.fonts} />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[10px] text-[#918B9A]">
                      Preview unavailable
                    </span>
                  )}
                  {selected && (
                    <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#6C55D9] text-white shadow">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-semibold text-[#29243D]">
                    {item.title?.trim() || "Untitled presentation"}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-[#898391]">
                    by {item.created_by?.trim() || "Presenton community"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
