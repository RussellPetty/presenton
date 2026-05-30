"use client";

import Wrapper from "@/components/Wrapper";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { trackEvent, MixpanelEvent } from "@/utils/mixpanel";
import { ArrowLeft, ChevronRight } from "lucide-react";

const PATHS_WITH_HEADER_BACK = [
  "/upload",
  "/outline",
  "/documents-preview",
  "/template-preview",
] as const;

function pathMatches(pathname: string | null, base: string) {
  return pathname === base || pathname?.startsWith(`${base}/`) === true;
}

const Header = () => {
  const pathname = usePathname();
  const showHeaderBack = PATHS_WITH_HEADER_BACK.some((p) => pathMatches(pathname, p));

  const backToUpload =
    pathMatches(pathname, "/outline") || pathMatches(pathname, "/documents-preview");
  const backToTemplates = pathMatches(pathname, "/template-preview");

  const backHref = backToUpload ? "/upload" : backToTemplates ? "/templates" : "/dashboard";
  const isLibrary = backHref === "/dashboard";
  const backLabel = isLibrary ? "Go to Library" : "Back";

  return (
    <div className="w-full   sticky top-0 z-50 py-7 "
      style={{
        background: "linear-gradient(180deg, #FFF 0%, rgba(255, 255, 255, 0.00) 110.67%)",

      }}
    >
      <Wrapper className="px-5 sm:px-10 lg:px-20">
        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-3" />
          <div className="flex items-center">
            {showHeaderBack ? (
              <Link
                href={backHref}
                style={{
                  background:
                    "linear-gradient(270deg, #D5CAFC 2.4%, #E3D2EB 27.88%, #F4DCD3 69.23%, #FDE4C2 100%)",
                }}
                className="w-fit rounded-[28px] flex items-center justify-center gap-1.5 py-3 px-5 text-[#101323] font-syne font-semibold text-xs animate-glow-pulse"
                onClick={() =>
                  trackEvent(MixpanelEvent.Navigation, { from: pathname, to: backHref })
                }
              >
                {!isLibrary && (
                  <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden />
                )}
                <span>{backLabel}</span>
                {isLibrary && (
                  <ChevronRight className="!w-5 !h-5 shrink-0" aria-hidden />
                )}
              </Link>
            ) : null}
          </div>
        </div>
      </Wrapper>
    </div>
  );
};

export default Header;
