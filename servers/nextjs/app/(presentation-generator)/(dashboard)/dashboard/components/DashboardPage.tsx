"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";

import {
  DashboardApi,
  type PresentationResponse,
} from "@/app/(presentation-generator)/services/api/dashboard";
import { PresentationGrid } from "@/app/(presentation-generator)/(dashboard)/dashboard/components/PresentationGrid";
import { LegacyPresentationsTable } from "@/app/(presentation-generator)/(dashboard)/dashboard/components/LegacyPresentationsTable";
import Link from "next/link";
import Image from "next/image";
import { trackEvent, MixpanelEvent } from "@/utils/mixpanel";
import { usePathname } from "next/navigation";

const GITHUB_REPOSITORY_URL = "https://github.com/presenton/presenton";
const DISCORD_INVITE_URL = "https://discord.com/invite/9ZsKKxudNE";
const APP_UPDATE_URL = "https://presenton.ai/download";

const actionCardBase =
  "absolute aspect-[16/9] h-[46.238px] w-[82.201px] rounded-[4.474px] border border-white/50 bg-cover bg-center bg-no-repeat shadow-[0_8px_18px_rgba(16,24,40,0.18)] transition-all duration-500 ease-out opacity-100 translate-y-0 scale-100";

const dashboardHeaderPill =
  "inline-flex shrink-0 items-center justify-center rounded-full text-[#191919] transition-colors hover:bg-[#F8F8FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A5AF8] focus-visible:ring-offset-2";

const dashboardHeaderAsset = (name: string) => `/dashboard-header/${name}`;
const dashboardBodyAsset = (name: string) => `/dashboard-body/${name}`;

const DashboardHeaderDivider = () => (
  <span className="relative h-5 w-px shrink-0" aria-hidden="true">
    <Image
      src={dashboardHeaderAsset("divider.svg")}
      alt=""
      width={20}
      height={1}
      className="absolute left-1/2 top-1/2 h-px w-5 max-w-none -translate-x-1/2 -translate-y-1/2 rotate-90"
    />
  </span>
);

const DashboardBodyDivider = () => (
  <span className="relative h-5 w-px shrink-0" aria-hidden="true">
    <Image
      src={dashboardBodyAsset("divider.svg")}
      alt=""
      width={20}
      height={1}
      className="absolute left-1/2 top-1/2 h-px w-5 max-w-none -translate-x-1/2 -translate-y-1/2 rotate-90"
    />
  </span>
);

const FloatingActionCards = () => (
  <div className="pointer-events-none absolute right-[14px] top-[-36px] z-0 block h-[64px] w-[158px]">
    <div
      className={`${actionCardBase} left-0 top-0 border-none group-hover/action:-translate-x-2 group-hover/action:-rotate-3 group-focus-visible/action:-translate-x-2 group-focus-visible/action:-rotate-3`}
      style={{
        backgroundImage: "url('/create_presentation_card_3.png')",
      }}
    />
    <div
      className={`${actionCardBase} left-[39px] top-1 z-10 border-none group-hover/action:-translate-y-1 group-hover/action:scale-105 group-focus-visible/action:-translate-y-1 group-focus-visible/action:scale-105`}
      style={{
        backgroundImage: "url('/create_presentation_card_2.png')",
      }}
    />
    <div
      className={`${actionCardBase} left-[76px] top-0 border-none group-hover/action:translate-x-2 group-hover/action:rotate-3 group-focus-visible/action:translate-x-2 group-focus-visible/action:rotate-3`}
      style={{
        backgroundImage: "url('/create_presentation_card_1.png')",
      }}
    />
  </div>
);

const GridViewIcon = () => (
  <Image
    src={dashboardBodyAsset("grid.svg")}
    alt=""
    width={16}
    height={16}
    className="h-4 w-4 shrink-0"
    aria-hidden="true"
  />
);

const ListViewIcon = () => (
  <Image
    src={dashboardBodyAsset("list.svg")}
    alt=""
    width={16}
    height={16}
    className="h-4 w-4 shrink-0"
    aria-hidden="true"
  />
);

function formatGitHubStars(stars: number) {
  if (stars >= 1_000_000) {
    return `${(stars / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (stars >= 1_000) {
    return `${(stars / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return stars.toLocaleString();
}

function DashboardHeader() {
  const pathname = usePathname();
  const [githubStars, setGithubStars] = useState<string | null>(null);
  const [isElectronApp, setIsElectronApp] = useState(false);

  useEffect(() => {
    setIsElectronApp(Boolean(window.electron));

    let isMounted = true;

    async function fetchGitHubStars() {
      try {
        const response = await fetch("/api/github-stars");
        if (!response.ok) return;
        const data = (await response.json()) as { stars?: number };
        if (isMounted && typeof data.stars === "number") {
          setGithubStars(formatGitHubStars(data.stars));
        }
      } catch {
        if (isMounted) setGithubStars(null);
      }
    }

    void fetchGitHubStars();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <header className="sticky top-0 z-50 ml-7 mr-[9px] flex h-[105px] items-center justify-between border-b border-[#EDEEEF] bg-white px-1 max-lg:h-auto max-lg:min-h-[105px] max-lg:flex-col max-lg:items-start max-lg:gap-4 max-lg:py-5">
      <div className="flex w-[504.392px] max-w-full shrink-0 items-center gap-3.5 max-xl:w-auto">
        <h1 className="whitespace-nowrap font-syne text-[22px] font-medium leading-normal tracking-[-0.66px] text-[#101323]">
          Dashboard
        </h1>
      </div>

      <div className="max-w-full overflow-x-auto hide-scrollbar lg:overflow-visible">
        <div className="flex h-[42.24px] w-max max-w-none items-center gap-3 rounded-full pl-3">
          <div className="flex h-[42.24px] items-center gap-[18px] rounded-[32px] border border-[#EDEEEF] bg-white px-3 py-1">
            <Link
              href="/settings"
              className={`${dashboardHeaderPill} h-[26.1px] gap-1.5 p-1.5`}
              onClick={() =>
                trackEvent(MixpanelEvent.Navigation, {
                  from: pathname,
                  to: "/settings",
                  source: "dashboard_header_settings",
                })
              }
            >
              <span className="flex h-[34.1px] w-[39.777px] shrink-0 items-center">
                <span className="relative z-10 h-[22px] w-[22px] shrink-0 overflow-hidden rounded-full border-[1.238px] border-[#EDEEEF] bg-white">
                  <Image
                    src={dashboardHeaderAsset("provider-openai.png")}
                    alt=""
                    aria-hidden="true"
                    width={224}
                    height={224}
                    className="h-full w-full rounded-full object-cover"
                  />
                </span>
                <span className="relative -ml-[4.4px] h-[22px] w-[22.177px] shrink-0 overflow-hidden rounded-full border-[1.238px] border-[#EDEEEF] bg-white">
                  <Image
                    src={dashboardHeaderAsset("provider-presenton.png")}
                    alt=""
                    aria-hidden="true"
                    width={1200}
                    height={630}
                    className="absolute left-[-70.06%] top-[-13.68%] h-[126.76%] w-[239.52%] max-w-none"
                  />
                </span>
              </span>
              <span className="font-syne text-sm font-medium leading-[17.6px] tracking-[0.56px]">
                Settings
              </span>
            </Link>

            <DashboardHeaderDivider />

            <Link
              href={GITHUB_REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              className={`${dashboardHeaderPill} h-[29.6px] gap-[8.8px] p-1.5`}
              onClick={() =>
                trackEvent(MixpanelEvent.Navigation, {
                  from: pathname,
                  to: GITHUB_REPOSITORY_URL,
                  source: "dashboard_header_github",
                })
              }
            >
              <Image
                src={dashboardHeaderAsset("github.svg")}
                alt=""
                aria-hidden="true"
                width={18}
                height={18}
                className="h-[17.6px] w-[17.6px] shrink-0"
              />
              <span className="flex items-center gap-[6.6px] font-syne text-sm font-normal leading-normal tracking-[-0.14px] text-[#191919]">
                <span>Star</span>
                <Image
                  src={dashboardHeaderAsset("dot.svg")}
                  alt=""
                  aria-hidden="true"
                  width={3}
                  height={3}
                  className="h-[2.2px] w-[2.2px] shrink-0"
                />
                <span className="min-w-[30px] text-xs font-medium tracking-[-0.12px]">
                  {githubStars ?? "--"}
                </span>
              </span>
            </Link>

            <DashboardHeaderDivider />

            <Link
              href={DISCORD_INVITE_URL}
              target="_blank"
              rel="noreferrer"
              className={`${dashboardHeaderPill} h-[29.6px] gap-[8.8px] p-1.5`}
              onClick={() =>
                trackEvent(MixpanelEvent.Navigation, {
                  from: pathname,
                  to: DISCORD_INVITE_URL,
                  source: "dashboard_header_discord",
                })
              }
            >
              <Image
                src={dashboardHeaderAsset("discord.svg")}
                alt=""
                aria-hidden="true"
                width={18}
                height={18}
                className="h-[17.6px] w-[17.6px] shrink-0"
              />
              <span className="font-syne text-sm font-normal leading-normal tracking-[-0.14px] text-[#191919]">
                Join Discord
              </span>
            </Link>
          </div>

          {isElectronApp && (
            <Link
              href={APP_UPDATE_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Update Presenton"
              title="Update Presenton"
              className="relative flex h-[42.24px] w-[42.24px] shrink-0 items-center justify-center rounded-full border-[1.32px] border-[#D9D6FE] bg-[#FAFAFF] transition-colors hover:bg-[#F3F0FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A5AF8] focus-visible:ring-offset-2"
              onClick={() =>
                trackEvent(MixpanelEvent.Navigation, {
                  from: pathname,
                  to: APP_UPDATE_URL,
                  source: "dashboard_header_update_app",
                  app_version: window.env?.APP_VERSION,
                })
              }
            >
              <Image
                src={dashboardHeaderAsset("update-arrow.svg")}
                alt=""
                aria-hidden="true"
                width={16}
                height={16}
                className="h-4 w-4 -rotate-90"
              />
              <Image
                src={dashboardHeaderAsset("update-badge.svg")}
                alt=""
                aria-hidden="true"
                width={14}
                height={14}
                className="absolute left-[26.44px] top-[-2.32px] h-[13.2px] w-[13.2px]"
              />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

const DashboardPage: React.FC = () => {
  const pathname = usePathname();
  const [presentations, setPresentations] = useState<PresentationResponse[]>([]);
  const [legacyPresentations, setLegacyPresentations] = useState<
    PresentationResponse[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deckSortDirection, setDeckSortDirection] = useState<"desc" | "asc">(
    "asc"
  );
  const [deckViewMode, setDeckViewMode] = useState<"grid" | "list">("grid");

  const sortedPresentations = useMemo(() => {
    return [...presentations].sort((a, b) => {
      const comparison = (a.title || "").localeCompare(b.title || "", undefined, {
        sensitivity: "base",
      });
      return deckSortDirection === "asc" ? comparison : -comparison;
    });
  }, [presentations, deckSortDirection]);

  const sortedLegacyPresentations = useMemo(
    () =>
      [...legacyPresentations].sort((a, b) =>
        (a.title || "").localeCompare(b.title || "", undefined, {
          sensitivity: "base",
        })
      ),
    [legacyPresentations]
  );

  const fetchPresentations = useCallback(async () => {
    let fetchedCount = 0;
    let hasError = false;
    try {
      setIsLoading(true);
      setError(null);
      const [supported, legacy] = await Promise.all([
        DashboardApi.getPresentations("v2-standard"),
        DashboardApi.getPresentations("v1-standard", { includeSlides: false }),
      ]);
      fetchedCount = supported.length + legacy.length;
      setPresentations(supported);
      setLegacyPresentations(legacy);
    } catch {
      hasError = true;
      setError(null);
      setPresentations([]);
      setLegacyPresentations([]);
    } finally {
      trackEvent(MixpanelEvent.Dashboard_Page_Viewed, {
        pathname,
        presentation_count: fetchedCount,
        load_failed: hasError,
      });
      setIsLoading(false);
    }
  }, [pathname]);

  useEffect(() => {
    void fetchPresentations();
  }, [fetchPresentations]);

  const removePresentation = (presentationId: string) => {
    setPresentations((prev) => prev.filter((p) => p.id !== presentationId));
    setLegacyPresentations((prev) =>
      prev.filter((p) => p.id !== presentationId)
    );
  };

  const removeLegacyPresentations = (presentationIds: string[]) => {
    const deletedIds = new Set(presentationIds);
    setLegacyPresentations((prev) =>
      prev.filter((presentation) => !deletedIds.has(presentation.id))
    );
  };

  return (
    <div className="relative min-h-screen w-full pb-10">
      <DashboardHeader />
      <section className="relative z-10 overflow-visible pb-0 pl-3 pr-3 pt-[17px] sm:pl-6 sm:pr-[9px]">
        <h2 className="w-full font-syne text-[16px] font-medium leading-[normal] text-[#191919]">
          Actions
        </h2>
        <Link
          href="/upload"
          onClick={() =>
            trackEvent(MixpanelEvent.Dashboard_New_Presentation_Clicked, {
              pathname,
              source: "dashboard_actions_card",
            })
          }
          className="group/action relative z-50 mt-[18px] block w-[304.5px] max-w-full cursor-pointer overflow-visible rounded-[10.8px] bg-white outline-none focus-visible:ring-2 focus-visible:ring-[#7A5AF8] focus-visible:ring-offset-4"
          aria-label="Create presentation"
        >
          <FloatingActionCards />

          <img
            src="/create_presentation_bg.png"
            alt="Background of the create presentation card"
            className="relative z-10 h-[89.983px] w-[304.5px] max-w-full rounded-[10.8px] bg-white object-cover"
          />
          <span className="absolute inset-0 z-20 flex items-center justify-center text-center font-syne text-sm font-medium text-[#191919]">
            Create Presentation
          </span>
        </Link>
      </section>
      <section className="relative z-10 mt-[46px] pl-3 pr-3 sm:pl-6 sm:pr-[9px]">
        <div className="mb-[14px] flex items-center justify-between gap-4">
          <h2 className="font-syne text-[16px] font-medium leading-[normal] text-[#191919]">
            Decks
          </h2>
          <div className="flex items-center gap-[17px]">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded font-manrope text-[13px] font-medium leading-normal tracking-[-0.39px] text-[#191919] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A5AF8]"
              title="Toggle alphabetical deck order"
              aria-label={`Sort decks ${deckSortDirection === "asc" ? "Z to A" : "A to Z"}`}
              onClick={() =>
                setDeckSortDirection((current) =>
                  current === "asc" ? "desc" : "asc"
                )
              }
            >
              {deckSortDirection === "asc" ? "A to Z" : "Z to A"}
              <Image
                src={dashboardBodyAsset("sort.svg")}
                alt=""
                width={14}
                height={14}
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
            <DashboardBodyDivider />
            <div className="flex items-center rounded-[4px] border border-[#EDEEEF] p-1">
              <button
                type="button"
                onClick={() => setDeckViewMode("grid")}
                aria-label="Grid view"
                aria-pressed={deckViewMode === "grid"}
                className={`flex items-center rounded px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A5AF8] ${deckViewMode === "grid" ? "bg-[#F6F6F9]" : "hover:bg-[#FAFAFC]"}`}
              >
                <GridViewIcon />
              </button>
              <button
                type="button"
                onClick={() => setDeckViewMode("list")}
                aria-label="List view"
                aria-pressed={deckViewMode === "list"}
                className={`flex items-center rounded px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A5AF8] ${deckViewMode === "list" ? "bg-[#F6F6F9]" : "hover:bg-[#FAFAFC]"}`}
              >
                <ListViewIcon />
              </button>
            </div>
          </div>
        </div>
        <PresentationGrid
          presentations={sortedPresentations}
          viewMode={deckViewMode}
          isLoading={isLoading}
          error={error}
          onPresentationDeleted={removePresentation}
          onPresentationDuplicated={(presentation) =>
            setPresentations((prev) => [presentation, ...prev])
          }
        />
      </section>
      {!isLoading && sortedLegacyPresentations.length > 0 && (
        <div className="relative z-10 mt-[46px] px-3 sm:px-6">
          <LegacyPresentationsTable
            presentations={sortedLegacyPresentations}
            onPresentationsDeleted={removeLegacyPresentations}
          />
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
