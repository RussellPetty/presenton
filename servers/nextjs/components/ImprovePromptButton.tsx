"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { notify } from "@/components/ui/sonner";

interface ImprovePromptButtonProps {
  /** Current prompt text to improve. */
  prompt: string;
  /** Called with the improved prompt when the rewrite succeeds. */
  onImproved: (improvedPrompt: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Sparkle button that sends the currently typed prompt to an LLM, which rewrites
 * it into a clearer, better-structured presentation prompt and replaces the text.
 */
export function ImprovePromptButton({
  prompt,
  onImproved,
  disabled = false,
  className = "",
}: ImprovePromptButtonProps) {
  const [loading, setLoading] = useState(false);

  const trimmed = prompt.trim();
  const canImprove = !disabled && !loading && trimmed.length > 0;

  const handleClick = async () => {
    if (!canImprove) return;
    setLoading(true);
    try {
      const res = await fetch("/api/improve-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.improvedPrompt) {
        notify.error(
          "Couldn't improve prompt",
          data?.error || "Please try again in a moment."
        );
        return;
      }
      onImproved(data.improvedPrompt as string);
    } catch (err) {
      console.error("Improve prompt error:", err);
      notify.error(
        "Couldn't improve prompt",
        "Please check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canImprove}
      title={
        trimmed.length === 0
          ? "Type an idea first, then improve it with AI"
          : "Improve my prompt with AI"
      }
      aria-label="Improve my prompt with AI"
      data-testid="improve-prompt-button"
      className={`inline-flex items-center gap-1.5 h-[30px] rounded-full px-3 text-xs font-medium font-syne transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5141E5]/30 ${
        canImprove
          ? "text-[#5141E5] bg-[#5141E5]/[0.07] hover:bg-[#5141E5]/[0.14] ring-1 ring-inset ring-[#5141E5]/20 cursor-pointer"
          : "text-gray-300 ring-1 ring-inset ring-slate-100 cursor-not-allowed"
      } ${className}`}
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
      )}
      <span>{loading ? "Improving…" : "Improve"}</span>
    </button>
  );
}

export default ImprovePromptButton;
