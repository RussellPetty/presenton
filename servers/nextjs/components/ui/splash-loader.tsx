"use client";

import { useLayoutEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface SplashLoaderProps {
  message?: string;
  className?: string;
}

export const SPLASH_MIN_DURATION_MS = 3000;

const SPLASH_ANIMATION_MS = 2600;

let splashSessionStartedAt: number | null = null;
let splashMaskReadyPromise: Promise<void> | null = null;

function markSplashSessionStart(): number {
  if (splashSessionStartedAt === null) {
    splashSessionStartedAt = Date.now();
  }
  return splashSessionStartedAt;
}

function getSplashAnimationDelayMs(): number {
  const elapsed = Date.now() - markSplashSessionStart();
  return -Math.min(elapsed, SPLASH_ANIMATION_MS);
}

export function SplashLoader({
  message = "Preparing your workspace",
  className,
}: SplashLoaderProps) {
  const [animationDelayMs, setAnimationDelayMs] = useState(0);

  useLayoutEffect(() => {
    setAnimationDelayMs(getSplashAnimationDelayMs());

  }, []);

  const containerStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2147483000,
    display: "flex",
    minHeight: "100vh",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    background: "#ffffff",
  };

  const surfaceStyle: CSSProperties = {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "142vmax",
    height: "142vmax",
    borderRadius: "50%",
    background: "#7a5af8",
    transform: "translate3d(-50%, -50%, 0) scale(0.001)",
    animation: `app-splash-surface-grow ${SPLASH_ANIMATION_MS}ms linear ${animationDelayMs}ms both`,
    willChange: "transform",
    backfaceVisibility: "hidden",
  };



  return (
    <main
      aria-busy="true"
      aria-label={message}
      className={cn("app-splash-loader", className)}
      role="status"
      style={containerStyle}
    >
      <div
        className="app-splash-surface"
        aria-hidden="true"
        style={surfaceStyle}
      />
      {/* White-label: the upstream wordmark used to be masked in here. The
          embedding app owns the branding, so the splash is just the surface. */}
    </main>
  );
}
