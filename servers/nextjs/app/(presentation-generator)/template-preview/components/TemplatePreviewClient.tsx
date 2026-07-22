"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { notify } from "@/components/ui/sonner";
import type { TemplateV2Layout } from "@/components/slide-editor/importing/template-v2-import";
import { normalizeBackendAssetUrls } from "@/utils/api";
import TemplateService from "../../services/api/template";
import { useTemplateDetails } from "../../hooks/useTemplateDetails";
import { useFontLoader as loadFontAssets } from "../../hooks/useFontLoad";
import { DeleteTemplateDialog } from "./editor/DeleteTemplateDialog";
import { EditorActionBar } from "./editor/EditorActionBar";
import { ResponsiveSlideFrame } from "./editor/ResponsiveSlideFrame";
import { TemplateEditorHeader } from "./editor/TemplateEditorHeader";
import {
  AiPanel,
  SchemaPanel,
  TEMPLATE_PREVIEW_AI_ASSISTANT_ENABLED,
  ToolRail,
} from "./editor/TemplatePreviewSidePanels";
import {
  TemplatePreviewErrorState,
  TemplatePreviewLoadingState,
  TemplatePreviewNotFoundState,
} from "./editor/TemplatePreviewStates";
import { ThumbnailStrip } from "./editor/ThumbnailStrip";
import {
  cloneLayout,
  collectSchemaFields,
  extractCreatedLayouts,
  readLayoutId,
  updateLayoutSchemaConstraint,
  updateLayoutSchemaField,
  type Density,
  type HistoryAvailability,
  type HistoryCommand,
  type PanelMode,
  type SchemaField,
  type UnknownRecord,
} from "./editor/templatePreviewUtils";
import {
  ANALYTICS_EVENTS,
  bucketTextLength,
  countWords,
  getPresentationErrorProperties,
  getUserSendTimeProperties,
  track,
  useAnalyticsPageView,
} from "./editor/templatePreviewAnalytics";

type GroupLayoutPreviewProps = {
  useKonvaTemplateV2Preview?: boolean;
};

const GroupLayoutPreview = ({
  useKonvaTemplateV2Preview = true,
}: GroupLayoutPreviewProps) => {
  void useKonvaTemplateV2Preview;

  const searchParams = useSearchParams();
  const router = useRouter();
  const templateId =
    searchParams.get("templateV2Id") || searchParams.get("id") || "";

  const { template, layouts, fonts, loading, error } =
    useTemplateDetails(templateId);
  const [editableLayouts, setEditableLayouts] = useState<TemplateV2Layout[]>([]);
  const [activeLayoutIndex, setActiveLayoutIndex] = useState(0);
  const [activePanel, setActivePanel] = useState<PanelMode>("schema");
  const [density, setDensity] = useState<Density>("");
  const [prompt, setPrompt] = useState("");
  const [openFieldId, setOpenFieldId] = useState("");
  const [templateNameDraft, setTemplateNameDraft] = useState("Template");
  const [savedTemplateName, setSavedTemplateName] = useState("Template");
  const [historyCommand, setHistoryCommand] = useState<HistoryCommand | null>(
    null,
  );
  const [historyAvailability, setHistoryAvailability] =
    useState<HistoryAvailability>({
      canUndo: false,
      canRedo: false,
    });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReconstructing, setIsReconstructing] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);
  const loadOutcomeTrackedRef = useRef(false);

  useAnalyticsPageView(() => {
    track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_PAGE_VIEWED, {
      page_path: "/template-preview",
      template_id: templateId || undefined,
      has_template_id: Boolean(templateId),
    });
  });

  useEffect(() => {
    loadOutcomeTrackedRef.current = false;
  }, [templateId]);

  useEffect(() => {
    if (loading || loadOutcomeTrackedRef.current) return;
    loadOutcomeTrackedRef.current = true;

    if (error || !template) {
      track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_LOAD_FAILED, {
        template_id: templateId || undefined,
        reason: !templateId ? "template_id_missing" : "template_not_available",
        ...getPresentationErrorProperties(error),
      });
      return;
    }

    track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_LOADED, {
      template_id: templateId,
      template_source: template.is_default ? "default" : "custom",
      layout_count: layouts.length,
      can_edit: true,
    });
  }, [error, layouts.length, loading, template, templateId]);

  useEffect(() => {
    const existingScript = document.querySelector(
      'script[src*="tailwindcss.com"]',
    );
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://cdn.tailwindcss.com";
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if (!fonts || typeof fonts !== "object") return;
    loadFontAssets(fonts as Record<string, string>);
  }, [fonts]);

  useEffect(() => {
    setEditableLayouts(layouts);
    setActiveLayoutIndex(0);
    setOpenFieldId("");
    setHistoryAvailability({ canUndo: false, canRedo: false });
    setHistoryCommand(null);
    setHasUnsavedChanges(false);
    setIsDeleteDialogOpen(false);
    setIsDeletingTemplate(false);
  }, [layouts, templateId]);

  useEffect(() => {
    const nextName = template?.name?.trim() || "Template";
    setTemplateNameDraft(nextName);
    setSavedTemplateName(nextName);
  }, [template?.name, templateId]);

  const canEditTemplate = Boolean(template);
  const activeLayout = editableLayouts[activeLayoutIndex] ?? null;
  const activeLayoutId = activeLayout
    ? readLayoutId(activeLayout, activeLayoutIndex)
    : "slide-1";
  const activeLayoutToken = templateId
    ? `${templateId}:${activeLayoutId}`
    : activeLayoutId;
  const schemaFields = useMemo(
    () => (activeLayout ? collectSchemaFields(activeLayout) : []),
    [activeLayout],
  );

  useEffect(() => {
    if (schemaFields.length === 0) {
      setOpenFieldId("");
      return;
    }
    setOpenFieldId((current) =>
      current && schemaFields.some((field) => field.id === current)
        ? current
        : schemaFields[0].id,
    );
  }, [schemaFields]);

  useEffect(() => {
    setHistoryCommand(null);
    setHistoryAvailability({ canUndo: false, canRedo: false });
  }, [activeLayoutIndex]);

  const copyActiveLayoutId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(activeLayoutToken);
      track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_LAYOUT_ID_COPIED, {
        template_id: templateId,
        layout_index: activeLayoutIndex,
      });
      notify.success("Copied", "Template layout ID copied.");
    } catch {
      notify.error("Copy failed", activeLayoutToken);
    }
  }, [activeLayoutIndex, activeLayoutToken, templateId]);

  const commitTemplateName = useCallback(async () => {
    if (!templateId || !template) return;
    if (!canEditTemplate) {
      setTemplateNameDraft(savedTemplateName);
      return;
    }

    const nextName = templateNameDraft.trim() || "Untitled Template";
    if (nextName !== templateNameDraft) {
      setTemplateNameDraft(nextName);
    }
    if (nextName === savedTemplateName) return;

    setHasUnsavedChanges(true);
  }, [
    canEditTemplate,
    savedTemplateName,
    template,
    templateId,
    templateNameDraft,
  ]);

  const cancelTemplateNameEdit = useCallback(() => {
    setTemplateNameDraft(savedTemplateName);
  }, [savedTemplateName]);

  const updateActiveLayout = useCallback(
    (layout: TemplateV2Layout) => {
      if (!canEditTemplate) return;
      setEditableLayouts((currentLayouts) =>
        currentLayouts.map((currentLayout, index) =>
          index === activeLayoutIndex ? layout : currentLayout,
        ),
      );
      setHasUnsavedChanges(true);
    },
    [activeLayoutIndex, canEditTemplate],
  );

  const handleSchemaFieldChange = useCallback(
    (field: SchemaField, value: string) => {
      if (!activeLayout) return;
      const updatedLayout = updateLayoutSchemaField(activeLayout, field, value);
      updateActiveLayout(
        field.type === "image"
          ? normalizeBackendAssetUrls(updatedLayout)
          : updatedLayout,
      );
      track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_SCHEMA_CHANGED, {
        template_id: templateId,
        layout_index: activeLayoutIndex,
        change_type: "field",
        field_id: field.id,
      });
    },
    [activeLayout, activeLayoutIndex, templateId, updateActiveLayout],
  );

  const handleSchemaConstraintChange = useCallback(
    (field: SchemaField, constraint: "min" | "max", value: string) => {
      if (!activeLayout) return;
      updateActiveLayout(
        updateLayoutSchemaConstraint(activeLayout, field, constraint, value),
      );
      track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_SCHEMA_CHANGED, {
        template_id: templateId,
        layout_index: activeLayoutIndex,
        change_type: "constraint",
        constraint,
        field_id: field.id,
      });
    },
    [activeLayout, activeLayoutIndex, templateId, updateActiveLayout],
  );

  const runHistoryCommand = useCallback((action: "undo" | "redo") => {
    setHistoryCommand({ action, token: Date.now() });
    track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_HISTORY_ACTION, {
      template_id: templateId,
      layout_index: activeLayoutIndex,
      action,
    });
  }, [activeLayoutIndex, templateId]);

  const duplicateActiveLayout = useCallback(() => {
    if (!canEditTemplate || !activeLayout) return;
    const duplicated = cloneLayout(activeLayout) as UnknownRecord;
    const nextId = `${activeLayoutId}-copy`;
    duplicated.id = nextId;
    setEditableLayouts((currentLayouts) => {
      const nextLayouts = [...currentLayouts];
      nextLayouts.splice(
        activeLayoutIndex + 1,
        0,
        duplicated as TemplateV2Layout,
      );
      return nextLayouts;
    });
    setActiveLayoutIndex((index) => index + 1);
    setHasUnsavedChanges(true);
    track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_LAYOUT_DUPLICATED, {
      template_id: templateId,
      layout_index: activeLayoutIndex,
      layout_count_before: editableLayouts.length,
      layout_count_after: editableLayouts.length + 1,
    });
  }, [
    activeLayout,
    activeLayoutId,
    activeLayoutIndex,
    canEditTemplate,
    editableLayouts.length,
    templateId,
  ]);

  const moveActiveLayout = useCallback(
    (direction: -1 | 1) => {
      const nextIndex = activeLayoutIndex + direction;
      if (!canEditTemplate) return;
      if (nextIndex < 0 || nextIndex >= editableLayouts.length) return;
      setEditableLayouts((currentLayouts) => {
        const nextLayouts = [...currentLayouts];
        const [layout] = nextLayouts.splice(activeLayoutIndex, 1);
        if (!layout) return currentLayouts;
        nextLayouts.splice(nextIndex, 0, layout);
        return nextLayouts;
      });
      setActiveLayoutIndex(nextIndex);
      setHasUnsavedChanges(true);
      track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_LAYOUT_MOVED, {
        template_id: templateId,
        from_index: activeLayoutIndex,
        to_index: nextIndex,
        layout_count: editableLayouts.length,
      });
    },
    [activeLayoutIndex, canEditTemplate, editableLayouts.length, templateId],
  );

  const deleteActiveLayout = useCallback(() => {
    if (!canEditTemplate) return;
    if (editableLayouts.length <= 1) {
      notify.warning(
        "Cannot delete slide",
        "A template needs at least one layout.",
      );
      return;
    }

    setEditableLayouts((currentLayouts) =>
      currentLayouts.filter((_, index) => index !== activeLayoutIndex),
    );
    setActiveLayoutIndex((index) =>
      Math.max(0, Math.min(index, editableLayouts.length - 2)),
    );
    setHasUnsavedChanges(true);
    track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_LAYOUT_DELETED, {
      template_id: templateId,
      layout_index: activeLayoutIndex,
      layout_count_before: editableLayouts.length,
      layout_count_after: editableLayouts.length - 1,
    });
  }, [activeLayoutIndex, canEditTemplate, editableLayouts.length, templateId]);

  const reconstructActiveLayout = useCallback(async () => {
    if (!canEditTemplate || !templateId || !activeLayout || isReconstructing) {
      return;
    }

    setIsReconstructing(true);
    const startedAt = Date.now();
    track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_LAYOUT_RECONSTRUCT_REQUESTED, {
      template_id: templateId,
      layout_index: activeLayoutIndex,
    });
    try {
      const response = await TemplateService.createTemplateLayout({
        template_id: templateId,
        index: activeLayoutIndex,
      });
      const createdLayout = extractCreatedLayouts(response).find(
        (item) => item.index === activeLayoutIndex,
      );
      if (!createdLayout) {
        throw new Error("No reconstructed layout was returned.");
      }

      updateActiveLayout(normalizeBackendAssetUrls(createdLayout.layout));
      notify.success(
        "Slide reconstructed",
        `Slide ${activeLayoutIndex + 1} was reconstructed. Save to keep it.`,
      );
      track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_LAYOUT_RECONSTRUCTED, {
        template_id: templateId,
        layout_index: activeLayoutIndex,
        duration_ms: Date.now() - startedAt,
      });
    } catch (reconstructError) {
      notify.error(
        "Failed to reconstruct slide",
        reconstructError instanceof Error
          ? reconstructError.message
          : "Something went wrong while reconstructing this slide.",
      );
      track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_LAYOUT_RECONSTRUCT_FAILED, {
        template_id: templateId,
        layout_index: activeLayoutIndex,
        duration_ms: Date.now() - startedAt,
        ...getPresentationErrorProperties(reconstructError),
      });
    } finally {
      setIsReconstructing(false);
    }
  }, [
    activeLayout,
    activeLayoutIndex,
    canEditTemplate,
    isReconstructing,
    templateId,
    updateActiveLayout,
  ]);

  const submitAiPrompt = useCallback(() => {
    if (!canEditTemplate) return;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;
    setPrompt("");
    track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_USER_PROMPT_SENT, {
      page_path: "/template-preview",
      action: "ai_prompt",
      template_id: templateId,
      layout_index: activeLayoutIndex,
      prompt_length_bucket: bucketTextLength(trimmedPrompt),
      prompt_word_count: countWords(trimmedPrompt),
      ...getUserSendTimeProperties(),
    });
    track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_AI_PROMPT_CAPTURED, {
      template_id: templateId,
      layout_index: activeLayoutIndex,
      prompt_length_bucket: bucketTextLength(trimmedPrompt),
      prompt_word_count: countWords(trimmedPrompt),
    });
    notify.success("Prompt captured", "Use Re-Construct when you are ready.");
  }, [activeLayoutIndex, canEditTemplate, prompt, templateId]);

  const saveTemplate = useCallback(async () => {
    if (
      !canEditTemplate ||
      !templateId ||
      !template ||
      editableLayouts.length === 0
    ) {
      return;
    }

    setIsSaving(true);
    const startedAt = Date.now();
    track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_TEMPLATE_SAVE_REQUESTED, {
      template_id: templateId,
      layout_count: editableLayouts.length,
      had_unsaved_changes: hasUnsavedChanges,
    });
    try {
      const nextTemplateName = templateNameDraft.trim() || "Untitled Template";
      if (nextTemplateName !== templateNameDraft) {
        setTemplateNameDraft(nextTemplateName);
      }

      await TemplateService.updateTemplateLayouts(templateId, {
        layouts: editableLayouts.map((layout, index) => ({ index, layout })),
      });

      if (nextTemplateName !== savedTemplateName) {
        await TemplateService.updateTemplateMetadata(templateId, {
          name: nextTemplateName,
          description: template.description,
        });
      }

      setHasUnsavedChanges(false);
      setSavedTemplateName(nextTemplateName);
      notify.success(
        "Changes saved",
        "Template JSON was updated.",
      );
      track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_TEMPLATE_SAVED, {
        template_id: templateId,
        layout_count: editableLayouts.length,
        duration_ms: Date.now() - startedAt,
      });
    } catch (saveError) {
      notify.error(
        "Failed to save template",
        saveError instanceof Error
          ? saveError.message
          : "Something went wrong while saving the template.",
      );
      track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_TEMPLATE_SAVE_FAILED, {
        template_id: templateId,
        layout_count: editableLayouts.length,
        duration_ms: Date.now() - startedAt,
        ...getPresentationErrorProperties(saveError),
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    canEditTemplate,
    editableLayouts,
    hasUnsavedChanges,
    savedTemplateName,
    template,
    templateId,
    templateNameDraft,
  ]);

  const openDeleteTemplateDialog = useCallback(() => {
    if (!templateId || template?.is_default) return;
    setIsDeleteDialogOpen(true);
    track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_TEMPLATE_DELETE_REQUESTED, {
      template_id: templateId,
      layout_count: editableLayouts.length,
    });
  }, [editableLayouts.length, template?.is_default, templateId]);

  const confirmDeleteTemplate = useCallback(async () => {
    if (!templateId || template?.is_default || isDeletingTemplate) return;

    setIsDeletingTemplate(true);
    const startedAt = Date.now();
    try {
      const result = await TemplateService.deleteTemplate(templateId);
      if (result.success) {
        setIsDeleteDialogOpen(false);
        notify.success(
          "Template deleted",
          "The template was deleted successfully.",
        );
        track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_TEMPLATE_DELETED, {
          template_id: templateId,
          duration_ms: Date.now() - startedAt,
        });
        router.push("/templates");
        return;
      }

      notify.error(
        "Could not delete template",
        result.message || "Something went wrong while deleting the template.",
      );
      track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_TEMPLATE_DELETE_FAILED, {
        template_id: templateId,
        duration_ms: Date.now() - startedAt,
        error_code: "delete_rejected",
      });
    } catch (deleteError) {
      notify.error(
        "Could not delete template",
        deleteError instanceof Error
          ? deleteError.message
          : "Something went wrong while deleting the template.",
      );
      track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_TEMPLATE_DELETE_FAILED, {
        template_id: templateId,
        duration_ms: Date.now() - startedAt,
        ...getPresentationErrorProperties(deleteError),
      });
    } finally {
      setIsDeletingTemplate(false);
    }
  }, [isDeletingTemplate, router, template?.is_default, templateId]);

  if (!templateId) {
    return (
      <TemplatePreviewNotFoundState onBack={() => router.push("/templates")} />
    );
  }

  if (loading) {
    return <TemplatePreviewLoadingState />;
  }

  if (error) {
    return (
      <TemplatePreviewErrorState
        error={error}
        onBack={() => router.push("/templates")}
      />
    );
  }

  if (!template) {
    return (
      <TemplatePreviewNotFoundState onBack={() => router.push("/templates")} />
    );
  }

  return (
    <div className="flex h-screen min-h-[764px] flex-col overflow-hidden bg-[#FBFBFA] font-syne text-[#191919]">
      <TemplateEditorHeader
        activeLayoutToken={activeLayoutToken}
        canEdit={canEditTemplate}
        canRedo={historyAvailability.canRedo}
        canUndo={historyAvailability.canUndo}
        canDelete={!template.is_default}
        hasUnsavedChanges={hasUnsavedChanges}
        isSaving={isSaving}
        templateName={templateNameDraft}
        onBack={() => router.push("/templates")}
        onCopy={copyActiveLayoutId}
        onDelete={openDeleteTemplateDialog}
        onTemplateNameCancel={cancelTemplateNameEdit}
        onTemplateNameChange={setTemplateNameDraft}
        onTemplateNameCommit={commitTemplateName}
        onRedo={() => runHistoryCommand("redo")}
        onSave={saveTemplate}
        onUndo={() => runHistoryCommand("undo")}
      />

      <main className="flex min-h-0 flex-1  overflow-hidden bg-[#FBFBFA]">
        <section className="flex min-w-0 flex-1 gap-1 flex-col bg-[#FBFBFA]">
          {editableLayouts.length === 0 || !activeLayout ? (
            <div className="flex flex-1 items-center justify-center text-sm text-[#696969]">
              No layouts available for this template.
            </div>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col mb-2">
                <ResponsiveSlideFrame
                  activeLayoutIndex={activeLayoutIndex}
                  canEdit={canEditTemplate}
                  fonts={fonts}
                  historyCommand={historyCommand}
                  isGenerating={isReconstructing}
                  layout={activeLayout}
                  onHistoryAvailabilityChange={setHistoryAvailability}
                  onLayoutChange={updateActiveLayout}
                />
              </div>

              {canEditTemplate ? (
                <EditorActionBar
                  canDeleteSlide={editableLayouts.length > 1}
                  canMoveLeft={activeLayoutIndex > 0}
                  canMoveRight={activeLayoutIndex < editableLayouts.length - 1}
                  isReconstructing={isReconstructing}
                  onCopy={copyActiveLayoutId}
                  onDelete={deleteActiveLayout}
                  onDuplicate={duplicateActiveLayout}
                  onMoveLeft={() => moveActiveLayout(-1)}
                  onMoveRight={() => moveActiveLayout(1)}
                  onReconstruct={reconstructActiveLayout}
                />
              ) : null}

              <ThumbnailStrip
                activeLayoutIndex={activeLayoutIndex}
                fonts={fonts}
                layouts={editableLayouts}
                templateId={templateId}
                onSelect={(nextIndex) => {
                  track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_LAYOUT_SELECTED, {
                    template_id: templateId,
                    layout_index: nextIndex,
                    previous_layout_index: activeLayoutIndex,
                    layout_count: editableLayouts.length,
                  });
                  setActiveLayoutIndex(nextIndex);
                }}
              />
            </>
          )}
        </section>

        {canEditTemplate ? (
          <>
            <ToolRail
              activePanel={activePanel}
              onPanelChange={(nextPanel) => {
                track(ANALYTICS_EVENTS.TEMPLATE_PREVIEW_PANEL_SELECTED, {
                  template_id: templateId,
                  panel: nextPanel,
                  previous_panel: activePanel,
                });
                setActivePanel(nextPanel);
              }}
            />
            {activePanel === "schema" ||
            !TEMPLATE_PREVIEW_AI_ASSISTANT_ENABLED ? (
              <SchemaPanel
                density={density}
                fields={schemaFields}
                openFieldId={openFieldId}
                onConstraintChange={handleSchemaConstraintChange}
                onDensityChange={setDensity}
                onFieldChange={handleSchemaFieldChange}
                onOpenFieldChange={setOpenFieldId}
              />
            ) : (
              <AiPanel
                prompt={prompt}
                onPromptChange={setPrompt}
                onSubmit={submitAiPrompt}
              />
            )}
          </>
        ) : null}
      </main>

      <DeleteTemplateDialog
        isDeleting={isDeletingTemplate}
        open={isDeleteDialogOpen}
        templateName={
          templateNameDraft.trim() || template?.name || "this template"
        }
        onConfirm={confirmDeleteTemplate}
        onOpenChange={setIsDeleteDialogOpen}
      />
    </div>
  );
};

export default GroupLayoutPreview;
