"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RootState } from "@/store/store";
import { useDispatch, useSelector } from "react-redux";
import { OverlayLoader } from "@/components/ui/overlay-loader";
import Wrapper from "@/components/Wrapper";
import OutlineContent from "./OutlineContent";
import EmptyStateView from "./EmptyStateView";
import GenerateButton from "./GenerateButton";

import { TABS } from "../types/index";
import { useOutlineStreaming } from "../hooks/useOutlineStreaming";
import { useOutlineManagement } from "../hooks/useOutlineManagement";
import { usePresentationGeneration } from "../hooks/usePresentationGeneration";
import TemplateSelection from "./TemplateSelection";
import { Separator } from "@/components/ui/separator";
import OutlinePromptBar from "./OutlinePromptBar";
import Chat from "../../presentation/components/Chat";
import { cn } from "@/lib/utils";
import { clearOutlines, setOutlines, setPresentationId } from "@/store/slices/presentationGeneration";
import { setPptGenUploadState } from "@/store/slices/presentationGenUpload";
import { LanguageType, PresentationConfig, ToneType, VerbosityType } from "../../upload/type";
import { PresentationGenerationApi } from "../../services/api/presentation-generation";
import { toast } from "sonner";
import {
  clampSlideCountValue,
  limitOutlines,
  parseLimitedSlideCount,
} from "@/utils/presentationLimits";
import { sanitizeAnalyticsError } from "@/utils/analytics";
import { MixpanelEvent, trackEvent } from "@/utils/mixpanel";
import { Sparkles, X } from "lucide-react";

const DEFAULT_OUTLINE_CONFIG: PresentationConfig = {
  slides: null,
  language: LanguageType.Auto,
  prompt: "",
  tone: ToneType.Default,
  verbosity: VerbosityType.Standard,
  instructions: "",
  includeTableOfContents: false,
  includeTitleSlide: false,
  webSearch: false,
};

const normalizeOutlineConfig = (
  config: PresentationConfig
): PresentationConfig => ({
  ...config,
  slides: config.slides ? clampSlideCountValue(config.slides) || null : null,
});

const getDocumentPaths = (files: unknown): string[] => {
  if (!Array.isArray(files)) {
    return [];
  }

  return files
    .flat()
    .map((file) =>
      file && typeof file === "object" && "file_path" in file
        ? (file as { file_path?: unknown }).file_path
        : null
    )
    .filter((filePath): filePath is string => typeof filePath === "string");
};

const getOutlinesFromResponse = (outline: any): { content: string }[] => {
  const slides = outline?.slides;
  if (!Array.isArray(slides)) {
    return [];
  }

  return limitOutlines(slides.map((slide) => {
    const content = slide?.content;
    if (typeof content === "string") {
      return { content };
    }
    if (content == null) {
      return { content: "" };
    }
    return { content: String(content) };
  }));
};

const OutlinePage: React.FC = () => {
  const dispatch = useDispatch();
  const { presentation_id, outlines } = useSelector(
    (state: RootState) => state.presentationGeneration
  );
  const { config: savedConfig, files } = useSelector(
    (state: RootState) => state.pptGenUpload
  );

  const [activeTab, setActiveTab] = useState<string>(TABS.LAYOUTS);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [draftConfig, setDraftConfig] = useState<PresentationConfig>(
    savedConfig ? normalizeOutlineConfig(savedConfig) : DEFAULT_OUTLINE_CONFIG
  );
  const [isRegeneratingOutline, setIsRegeneratingOutline] = useState(false);
  const [hasOutlineStreamFinished, setHasOutlineStreamFinished] =
    useState(false);
  const [isMobileAssistantOpen, setIsMobileAssistantOpen] = useState(false);
  const mobileAssistantTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileAssistantCloseRef = useRef<HTMLButtonElement | null>(null);

  // Custom hooks
  const streamState = useOutlineStreaming(
    presentation_id,
    activeTab === TABS.OUTLINE
  );
  const { handleDragEnd, handleAddSlide } = useOutlineManagement(outlines);
  const { loadingState, handleSubmit } = usePresentationGeneration(
    presentation_id,
    outlines,
    selectedTemplateId,
    setActiveTab
  );

  const documentPaths = useMemo(() => getDocumentPaths(files), [files]);
  const outlineControlsBusy =
    isRegeneratingOutline || streamState.isLoading || streamState.isStreaming;
  const hasSelectedTemplate = selectedTemplateId !== null;
  const isOutlineReady =
    hasSelectedTemplate && hasOutlineStreamFinished && !outlineControlsBusy;
  const isOutlineAssistantVisible =
    activeTab === TABS.OUTLINE && isOutlineReady;
  const isRegenerateDisabled =
    !hasSelectedTemplate || (activeTab === TABS.OUTLINE && !isOutlineReady);
  const outlineStreamFinished =
    activeTab === TABS.OUTLINE &&
    !outlineControlsBusy &&
    (outlines.length > 0 || streamState.statusMessage === "Outline ready");

  const closeMobileAssistant = useCallback(() => {
    setIsMobileAssistantOpen(false);
    window.requestAnimationFrame(() => {
      mobileAssistantTriggerRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (!isMobileAssistantOpen) return;
    mobileAssistantCloseRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileAssistant();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeMobileAssistant, isMobileAssistantOpen]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const closeDrawerOnDesktop = () => {
      if (desktopQuery.matches) {
        setIsMobileAssistantOpen(false);
      }
    };

    closeDrawerOnDesktop();
    desktopQuery.addEventListener("change", closeDrawerOnDesktop);
    return () =>
      desktopQuery.removeEventListener("change", closeDrawerOnDesktop);
  }, []);

  useEffect(() => {
    if (!isOutlineAssistantVisible) {
      setIsMobileAssistantOpen(false);
    }
  }, [isOutlineAssistantVisible]);

  useEffect(() => {
    if (savedConfig) {
      setDraftConfig(normalizeOutlineConfig(savedConfig));
    }
  }, [savedConfig]);

  useEffect(() => {
    setHasOutlineStreamFinished(false);
  }, [presentation_id]);

  useEffect(() => {
    if (!presentation_id || !hasSelectedTemplate) {
      setHasOutlineStreamFinished(false);
      return;
    }

    if (outlineStreamFinished) {
      setHasOutlineStreamFinished(true);
    }
  }, [hasSelectedTemplate, outlineStreamFinished, presentation_id]);

  const handleTabChange = (tab: string) => {
    if (tab === TABS.OUTLINE) {
      if (!hasSelectedTemplate) {
        toast.error("Please select a template first");
        return;
      }

      if (!isOutlineReady) {
        return;
      }
    }

    if (streamState.isStreaming) {
      return;
    }
    setActiveTab(tab);

  };

  const handleConfigChange = (key: keyof PresentationConfig, value: unknown) => {
    const nextValue =
      key === "slides" && typeof value === "string"
        ? clampSlideCountValue(value)
        : value;
    setDraftConfig((previous) => ({
      ...previous,
      [key]: nextValue,
    }));
  };

  const handleTemplateSelectId = useCallback(
    (templateId: string) => {
      setSelectedTemplateId(templateId);
      setActiveTab(TABS.OUTLINE);
    },
    []
  );

  const handleRegenerateOutline = useCallback(async () => {
    if (outlineControlsBusy) {
      return;
    }

    if (!hasSelectedTemplate) {
      toast.error("Please select a template first");
      return;
    }

    if (activeTab === TABS.OUTLINE && !isOutlineReady) {
      return;
    }

    if (!draftConfig.language) {
      toast.error("Please select language");
      return;
    }

    if (documentPaths.length > 0 && draftConfig.language === LanguageType.Auto) {
      toast.error("Please choose a language before regenerating from documents");
      return;
    }

    if (!draftConfig.prompt.trim() && documentPaths.length === 0) {
      toast.error("No Prompt or Document Provided");
      return;
    }

    setIsRegeneratingOutline(true);
    setHasOutlineStreamFinished(false);
    trackEvent(MixpanelEvent.TemplateV2_Outline_Regeneration_Started, {
      presentation_id,
      template_id: selectedTemplateId,
      prompt_present: draftConfig.prompt.trim().length > 0,
      document_count: documentPaths.length,
      slide_count: parseLimitedSlideCount(draftConfig.slides),
      language: draftConfig.language,
      tone: draftConfig.tone,
      verbosity: draftConfig.verbosity,
      web_search: !!draftConfig.webSearch,
      include_title_slide: !!draftConfig.includeTitleSlide,
      include_table_of_contents: !!draftConfig.includeTableOfContents,
    });
    try {
      const createResponse = await PresentationGenerationApi.createPresentation({
        content: draftConfig.prompt ?? "",
        n_slides: parseLimitedSlideCount(draftConfig.slides),
        file_paths: documentPaths,
        language: draftConfig.language ?? "",
        tone: draftConfig.tone,
        verbosity: draftConfig.verbosity,
        instructions: draftConfig.instructions || null,
        include_table_of_contents: !!draftConfig.includeTableOfContents,
        include_title_slide: !!draftConfig.includeTitleSlide,
        web_search: !!draftConfig.webSearch,
      });

      dispatch(setPptGenUploadState({ config: draftConfig, files }));
      dispatch(clearOutlines());
      dispatch(setPresentationId(createResponse.id));
      trackEvent(MixpanelEvent.TemplateV2_Outline_Regeneration_Completed, {
        old_presentation_id: presentation_id,
        new_presentation_id: createResponse.id,
        template_id: selectedTemplateId,
      });
      setActiveTab(TABS.OUTLINE);
    } catch (error: any) {
      console.error("Error regenerating outline", error);
      trackEvent(MixpanelEvent.TemplateV2_Outline_Regeneration_Failed, {
        presentation_id,
        template_id: selectedTemplateId,
        error_message: sanitizeAnalyticsError(
          error,
          "Failed to regenerate outline"
        ),
      });
      toast.error("Outline Error", {
        description: error.message || "Failed to regenerate outline.",
      });
    } finally {
      setIsRegeneratingOutline(false);
    }
  }, [
    activeTab,
    dispatch,
    documentPaths,
    draftConfig,
    files,
    hasSelectedTemplate,
    isOutlineReady,
    outlineControlsBusy,
    presentation_id,
    selectedTemplateId,
  ]);

  const handleOutlineChanged = useCallback(async () => {
    if (!presentation_id) {
      return;
    }

    const outline = await PresentationGenerationApi.getOutlines(presentation_id);
    dispatch(setOutlines(getOutlinesFromResponse(outline)));
  }, [dispatch, presentation_id]);

  const handleBeforeOutlineChatSend = useCallback(async () => {
    if (!presentation_id) {
      return;
    }

    await PresentationGenerationApi.updateOutlines(presentation_id, outlines);
  }, [outlines, presentation_id]);

  if (!presentation_id) {
    return <EmptyStateView />;
  }


  return (
    <div className="min-h-screen bg-[#F8F7FB] pb-9 font-syne">

      <OverlayLoader
        show={loadingState.isLoading}
        text={loadingState.message}
        showProgress={loadingState.showProgress}
        duration={loadingState.duration}
      />

      <Wrapper className="relative flex w-full flex-col px-5 sm:px-10 lg:px-20">
        <div className="w-full mx-auto">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="flex w-full flex-col">
            <div
              className={cn(
                "w-full gap-5",
                isOutlineAssistantVisible
                  ? "grid lg:grid-cols-[minmax(0,1fr)_375px]"
                  : "block"
              )}
            >
              <div className="min-w-0">
                <div className="pb-7 pt-2">
                  <OutlinePromptBar
                    config={draftConfig}
                    disabled={outlineControlsBusy}
                    isBusy={outlineControlsBusy}
                    regenerateDisabled={isRegenerateDisabled}
                    onConfigChange={handleConfigChange}
                    onRegenerate={handleRegenerateOutline}
                  />
                </div>

                <div className="mb-6">
                  <TabsList className="h-auto w-fit rounded-full border border-[#EDEEEF] bg-white p-1.5 shadow-sm">
                    <TabsTrigger
                      value={TABS.LAYOUTS}
                      className="relative rounded-full px-5 py-2 text-xs font-medium text-[#2D2D2D] shadow-none data-[state=active]:bg-[#F4F3FF] data-[state=active]:text-[#7E3AF2] data-[state=active]:shadow-none"
                    >
                      Select Template
                    </TabsTrigger>
                    <Separator orientation="vertical" className="mx-1 h-6" />
                    <TabsTrigger
                      value={TABS.OUTLINE}
                      disabled={!isOutlineReady}
                      className={cn(
                        "rounded-full px-5 py-2 text-xs font-medium text-[#2D2D2D] shadow-none data-[state=active]:bg-[#F4F3FF] data-[state=active]:text-[#7E3AF2] data-[state=active]:shadow-none",
                        !isOutlineReady && "cursor-not-allowed opacity-50"
                      )}
                    >
                      Outline & Content
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value={TABS.OUTLINE} className="mt-0 pb-24">
                  <OutlineContent
                    outlines={outlines}
                    isLoading={streamState.isLoading}
                    isStreaming={streamState.isStreaming}
                    activeSlideIndex={streamState.activeSlideIndex}
                    highestActiveIndex={streamState.highestActiveIndex}
                    statusMessage={streamState.statusMessage}
                    onDragEnd={handleDragEnd}
                    onAddSlide={handleAddSlide}
                  />
                </TabsContent>

                <TabsContent value={TABS.LAYOUTS} className="mt-0">
                  <TemplateSelection
                    presentationId={presentation_id}
                    selectedTemplateId={selectedTemplateId}
                    onSelectTemplateId={handleTemplateSelectId}
                  />
                </TabsContent>
              </div>

              {isOutlineAssistantVisible && (
                <>
                  <button
                    type="button"
                    aria-label="Close AI Assistant"
                    onClick={closeMobileAssistant}
                    className={cn(
                      "inset-0 z-[60] bg-black/35 lg:hidden",
                      isMobileAssistantOpen ? "fixed" : "hidden"
                    )}
                  />

                  <aside
                    id="outline-mobile-assistant"
                    role={isMobileAssistantOpen ? "dialog" : undefined}
                    aria-label={isMobileAssistantOpen ? "AI Assistant" : undefined}
                    aria-modal={isMobileAssistantOpen ? true : undefined}
                    className={cn(
                      "h-screen w-[calc(100vw-16px)] max-w-[375px] flex-col overflow-hidden border border-[#EDEEEF] bg-white shadow-[-12px_0_32px_rgba(16,24,40,0.18)] lg:sticky lg:top-[92px] lg:z-auto lg:flex lg:h-[calc(100vh-105px)] lg:w-auto lg:max-w-none lg:shadow-none",
                      isMobileAssistantOpen
                        ? "fixed inset-y-0 right-0 z-[70] flex"
                        : "hidden"
                    )}
                  >
                    <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#EDEEEF] px-4 lg:hidden">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#101323]">
                        <Sparkles className="h-4 w-4 text-[#7A5AF8]" aria-hidden="true" />
                        AI Assistant
                      </div>
                      <button
                        ref={mobileAssistantCloseRef}
                        type="button"
                        aria-label="Close AI Assistant"
                        onClick={closeMobileAssistant}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[#667085] transition hover:bg-[#F6F6F9] hover:text-[#101323] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A5AF8]"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="min-h-0 flex-1">
                      <Chat
                        key={presentation_id}
                        presentationId={presentation_id}
                        variant="outline"
                        useEditorLayout
                        onBeforeSend={handleBeforeOutlineChatSend}
                        onPresentationChanged={handleOutlineChanged}
                      />
                    </div>
                  </aside>
                </>
              )}
            </div>
          </Tabs>

          <div
            className={cn(
              "fixed z-50 flex items-center gap-2",
              isOutlineAssistantVisible
                ? "bottom-8 left-[39%] -translate-x-[38%]"
                : "bottom-[26px] right-[26px]"
            )}
          >
            <div className="min-w-0 flex-1 lg:flex-none">
              <GenerateButton
                loadingState={loadingState}
                streamState={streamState}
                selectedTemplateId={selectedTemplateId}
                onSubmit={handleSubmit}
              />
            </div>

            {isOutlineAssistantVisible && (
              <button
                ref={mobileAssistantTriggerRef}
                type="button"
                aria-controls="outline-mobile-assistant"
                aria-expanded={isMobileAssistantOpen}
                aria-label="Open AI Assistant"
                onClick={() => setIsMobileAssistantOpen(true)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-full border border-white/70 text-sm font-semibold text-[#101323] shadow-[0_8px_24px_rgba(74,58,155,0.24)] transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A5AF8] focus-visible:ring-offset-2 sm:w-auto sm:px-4 lg:hidden"
                style={{
                  background:
                    "linear-gradient(270deg, #D5CAFC 2.4%, #E3D2EB 27.88%, #F4DCD3 69.23%, #FDE4C2 100%)",
                }}
              >
                <Sparkles className="h-4 w-4 text-[#7A5AF8]" aria-hidden="true" />
                <span className="hidden sm:inline">AI Assistant</span>
              </button>
            )}
          </div>
        </div>



      </Wrapper>
    </div>
  );
};

export default OutlinePage;
