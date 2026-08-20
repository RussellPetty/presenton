import React, { forwardRef } from "react";
import type { Slide } from "../../types/slide";
import { V1ContentRender } from "../../components/V1ContentRender";
import {
  getSlideDimensions,
  type PresentationAspectRatio,
} from "../utils/slideAspectRatio";

interface SlideThumbnailCardProps extends React.HTMLAttributes<HTMLDivElement> {
  slide: Slide;
  index: number;
  selected: boolean;
  aspectRatio?: PresentationAspectRatio;
}

const SCALE = 0.061;

export const SlideThumbnailCard = forwardRef<
  HTMLDivElement,
  SlideThumbnailCardProps
>(({ slide, index, selected, aspectRatio = "16:9", className = "", style, ...props }, ref) => {
  const dimensions = getSlideDimensions(aspectRatio);
  return (
    <div
      ref={ref}
      style={{
        backgroundColor: "var(--card-color, #ffffff)",
        borderColor: selected ? "#5141e5" : "var(--stroke, #e5e7eb)",
        ...style,
      }}
      className={`cursor-pointer border relative p-1.5 rounded-[12px] overflow-hidden transition-all duration-200 ${
        selected ? "border-[#BDB4FE]" : "border-[#EDEEEF]"
      } ${className}`}
      {...props}
    >
      <p className="pointer-events-none absolute -left-1 top-1/2 z-50 flex h-[18px] min-w-[18px] -translate-y-1/2 items-center justify-center rounded-full border border-[#EDEEEF] bg-white px-1 text-[10px] font-medium text-[#191919] shadow-sm">
        {index + 1}
      </p>

      <div
        className="relative"
        style={{
          height: `${dimensions.height * SCALE}px`,
          overflow: "hidden",
          backgroundColor: "var(--background-color, #ffffff)",
        }}
      >
        <div
          className="absolute top-0 left-0 rounded-[10px] overflow-hidden pointer-events-none"
          style={{
            width: 1280,
            height: dimensions.height,
            transformOrigin: "top left",
            transform: `scale(${SCALE})`,
            backgroundColor: "var(--background-color, #ffffff)",
          }}
        >
          <div
            className="absolute left-0"
            style={{
              top: dimensions.contentOffsetY,
              width: 1280,
              height: 720,
            }}
          >
            <V1ContentRender slide={slide} isEditMode={true} />
          </div>
        </div>
      </div>
    </div>
  );
});

SlideThumbnailCard.displayName = "SlideThumbnailCard";
