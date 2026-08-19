"use client";

import { cn } from "@/lib/utils";

interface SplashLoaderProps {
  message?: string;
  className?: string;
}

// Was 3000: a deliberate minimum so the brand animation could play out. With
// no animation left, holding content back for three seconds inside an iframe
// just looks like the host app is stuck.
export const SPLASH_MIN_DURATION_MS = 0;

export function SplashLoader({
  message = "Preparing your workspace",
  className,
}: SplashLoaderProps) {
  // Was a full-screen purple disc that grew over the whole viewport. Inside an
  // iframe that reads as the host app hanging, and it is upstream's brand
  // colour besides, so this is now a quiet neutral placeholder.
  return (
    <main
      aria-busy="true"
      aria-label={message}
      className={cn(
        "flex min-h-[200px] w-full items-center justify-center bg-white",
        className
      )}
      role="status"
    >
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500" />
    </main>
  );
}
