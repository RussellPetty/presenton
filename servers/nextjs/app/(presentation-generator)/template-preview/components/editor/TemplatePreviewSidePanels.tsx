"use client";

import React, { type FormEvent } from "react";
import {
  ArrowUp,
  Edit3,
  Image as ImageIcon,
  Info,
  Minus,
  Plus,
  Sparkles,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Density, PanelMode, SchemaField } from "./templatePreviewUtils";

export const TEMPLATE_PREVIEW_AI_ASSISTANT_ENABLED = false;

export function ToolRail({
  activePanel,
  onPanelChange,
}: {
  activePanel: PanelMode;
  onPanelChange: (panel: PanelMode) => void;
}) {
  const navItems: Array<{
    id: PanelMode;
    label: string;
    Icon: LucideIcon;
    hidden?: boolean;
  }> = [
    {
      id: "ai",
      label: "AI",
      Icon: Sparkles,
      hidden: !TEMPLATE_PREVIEW_AI_ASSISTANT_ENABLED,
    },
    { id: "schema", label: "Schema", Icon: Edit3 },
  ];

  return (
    <div className="hidden w-[70px] shrink-0 flex-col items-center bg-[#FEFEFF] pt-2 lg:flex">
      {navItems.map(({ id, label, Icon, hidden }, index) => {
        const active = activePanel === id;

        return (
          <React.Fragment key={id}>
            {index > 0 && !navItems[index - 1]?.hidden ? (
              <div className="my-[19px] h-px w-[30px] bg-[#EDEEEF]" />
            ) : null}
            <button
              className={cn(
                "flex h-[104px] w-[58px] flex-col items-center justify-center gap-[7px] rounded-[10px] text-[12px] font-medium transition-colors",
                hidden && "hidden",
                active
                  ? "bg-[rgba(244,243,255,0.6)] text-[#7A5AF8]"
                  : "text-[#191919] hover:bg-[#F8F8FA]",
              )}
              onClick={() => onPanelChange(id)}
              type="button"
            >
              <span
                className={cn(
                  "flex h-[30px] w-[30px] items-center justify-center rounded-[8px]",
                  active
                    ? "bg-white shadow-[0_4px_8px_rgba(16,24,40,0.08)]"
                    : "bg-transparent",
                )}
              >
                <Icon className="h-[14px] w-[14px]" />
              </span>
              {label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function AiPanel({
  prompt,
  onPromptChange,
  onSubmit,
}: {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
}) {
  const quickPrompts = ["Make it shorter", "Make it more engaging"];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <aside className="relative hidden w-[299px] shrink-0 overflow-hidden bg-[#FEFEFF] lg:flex lg:flex-col">
      <div className="pointer-events-none absolute left-[22px] top-[100px] h-[390px] w-[260px] rounded-full bg-[radial-gradient(circle_at_52%_47%,rgba(83,177,253,0.28)_0%,rgba(217,214,254,0.35)_38%,rgba(255,255,255,0)_72%)] blur-[30px]" />

      <div className="relative flex min-h-0 flex-1 flex-col px-3 pb-6 pt-[132px]">
        <div className="flex flex-1 items-start justify-center pt-[58px] text-center">
          <p className="text-[22.68px] font-normal leading-[24.3px] tracking-[-0.4536px] text-[#4C4C4C]">
            What can I do
            <br />
            for your deck today?
          </p>
        </div>

        <form className="mt-auto" onSubmit={submit}>
          <div className="rounded-[8px] border border-[#EDEEEF] bg-white p-[10px] shadow-none">
            <Textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              placeholder={"Ask anything.\nType / to get Quick prompts."}
              className="min-h-[79px] resize-none border-0 bg-transparent p-0 text-[14px] font-normal leading-[18px] text-[#191919] shadow-none placeholder:text-[#999999] focus-visible:ring-0"
            />
            <div className="mt-2 flex h-[28px] items-center justify-between">
              <div className="flex items-center gap-[6px]">
                <button
                  type="button"
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-full border border-[#EDEEEF] text-[#191919]"
                  title="Add"
                >
                  <Plus className="h-[14px] w-[14px]" />
                </button>
                <button
                  type="button"
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-full border border-[#EDEEEF] text-[#191919]"
                  title="AI options"
                >
                  <Sparkles className="h-[13px] w-[13px] text-[#7A5AF8]" />
                </button>
                <button
                  type="button"
                  className="flex h-[28px] items-center gap-[6px] rounded-full border border-[#EDEEEF] px-[10px] text-[12px] font-medium text-[#191919]"
                >
                  <Sparkles className="h-[13px] w-[13px] text-[#7A5AF8]" />
                  Prompt
                </button>
              </div>
              <button
                type="submit"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EFEFF2] text-[#191919] disabled:text-[#9A9A9A]"
                disabled={!prompt.trim()}
                title="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </form>

        <div className="mt-[13px] flex flex-wrap gap-[8px]">
          {quickPrompts.map((quickPrompt) => (
            <button
              key={quickPrompt}
              className="h-[28px] rounded-full border border-[#EDEEEF] bg-white px-[12px] text-[12px] font-medium text-[#666666] transition-colors hover:bg-[#F7F6F9]"
              onClick={() => onPromptChange(quickPrompt)}
              type="button"
            >
              {quickPrompt}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function DensitySelector({
  density,
  onDensityChange,
}: {
  density: Density;
  onDensityChange: (density: Density) => void;
}) {
  const options: Exclude<Density, "">[] = ["Low", "Medium", "High"];

  return (
    <div className="mt-[12px] grid grid-cols-3 gap-[8px]">
      {options.map((option) => (
        <button
          key={option}
          className={cn(
            "h-[30px] rounded-[6px] border text-[14px] font-normal transition-colors",
            density === option
              ? "border-[#D9D6FE] bg-[#F8F6FF] text-[#7A5AF8]"
              : "border-[#EDEEEF] bg-white text-[#191919] hover:bg-[#F8F8F8]",
          )}
          onClick={() => onDensityChange(option)}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function SchemaPanel({
  density,
  fields,
  openFieldId,
  onConstraintChange,
  onDensityChange,
  onFieldChange,
  onOpenFieldChange,
}: {
  density: Density;
  fields: SchemaField[];
  openFieldId: string;
  onConstraintChange: (
    field: SchemaField,
    constraint: "min" | "max",
    value: string,
  ) => void;
  onDensityChange: (density: Density) => void;
  onFieldChange: (field: SchemaField, value: string) => void;
  onOpenFieldChange: (fieldId: string) => void;
}) {
  return (
    <aside className="hidden w-[299px] shrink-0 bg-[#FEFEFF] lg:flex lg:flex-col">
      <div className="px-3 pt-[33px]">
        <h2 className="text-[18px] font-medium text-[#101323]">
          Schema Editor
        </h2>
        <p className="mt-[18px] text-[14px] font-normal text-[#191919]">
          Content Density
        </p>
        <DensitySelector density={density} onDensityChange={onDensityChange} />
        <div className="mt-[10px] flex min-h-[62px] gap-[10px] rounded-[6px] bg-[#F3F6FB] px-[16px] py-[10px] text-[12px] leading-[14px] text-[#5F6470]">
          <Info className="mt-[2px] h-[14px] w-[14px] shrink-0 text-[#1F5FBF]" />
          <p>
            Generate realistic content to test how your slide adapts to
            different text lengths.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-[40px]">
        {fields.length === 0 ? (
          <div className="rounded-[6px] border border-dashed border-[#DCDCE1] px-4 py-8 text-center text-[13px] text-[#808080]">
            No editable schema fields were found for this layout.
          </div>
        ) : (
          <div className="space-y-[8px]">
            {fields.map((field) => (
              <SchemaFieldRow
                key={field.id}
                field={field}
                isOpen={openFieldId === field.id}
                onChange={(value) => onFieldChange(field, value)}
                onConstraintChange={(constraint, value) =>
                  onConstraintChange(field, constraint, value)
                }
                onToggle={() =>
                  onOpenFieldChange(openFieldId === field.id ? "" : field.id)
                }
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function SchemaFieldRow({
  field,
  isOpen,
  onChange,
  onConstraintChange,
  onToggle,
}: {
  field: SchemaField;
  isOpen: boolean;
  onChange: (value: string) => void;
  onConstraintChange: (constraint: "min" | "max", value: string) => void;
  onToggle: () => void;
}) {
  const Icon = field.type === "image" ? ImageIcon : Type;
  const typeLabel =
    field.type === "text-list"
      ? "List"
      : field.type === "image"
        ? "Image"
        : "String";

  return (
    <div className="space-y-[3px]">
      <div className="flex h-[30px] items-center">
        <button
          className="flex h-[12px] w-[14px] shrink-0 items-center justify-center rounded-[2px] border border-[#D9D9DE] bg-[#F7F8FA] text-[#808080]"
          onClick={onToggle}
          type="button"
        >
          {isOpen ? (
            <Minus className="h-[10px] w-[10px]" />
          ) : (
            <Plus className="h-[10px] w-[10px]" />
          )}
        </button>
        <span className="h-px w-[14.5px] shrink-0 bg-[#D9D9DE]" />
        <button
          className={cn(
            "flex h-[30px] min-w-0 flex-1 items-center gap-[8px] rounded-[4px] border bg-[#FEFEFF] px-[10px] text-left transition-colors",
            isOpen
              ? "border-[#D9D6FE] text-[#191919]"
              : "border-[#EDEEEF] text-[#191919] hover:bg-[#F8F8F8]",
          )}
          onClick={onToggle}
          type="button"
        >
          <Icon className="h-[14px] w-[14px] shrink-0 text-[#7A5AF8]" />
          <span className="min-w-0 truncate text-[14px] font-normal tracking-[0.56px]">
            {field.label}
          </span>
          {field.maxChars ? (
            <span
              className="shrink-0 text-[12px] font-normal tracking-[0.48px] text-[#808080]"
              style={{ fontFamily: "Outfit, var(--font-syne), sans-serif" }}
            >
              ({field.maxChars} Characters)
            </span>
          ) : null}
        </button>
      </div>

      {isOpen ? (
        <div className="ml-[28.5px] flex flex-col gap-[2px]">
          <div className="flex h-[30px] items-center gap-[8px] rounded-[4px] border border-[#E7E8EC] bg-[#FEFEFF] px-[10px] text-[14px] font-normal tracking-[0.56px] text-[#17181E]">
            <span className="text-[16px] leading-none text-[#808080]">#</span>
            <span>Type</span>
            <span className="ml-auto text-[#191919]">{typeLabel}</span>
          </div>
          {field.type !== "image" ? (
            <>
              <label className="flex h-[30px] items-center rounded-[4px] border border-[#E7E8EC] bg-[#FEFEFF] px-[10px] text-[14px] font-normal tracking-[0.56px] text-[#17181E]">
                <span>Min Chars</span>
                <input
                  className="ml-auto h-[24px] w-[76px] rounded-[4px] border border-transparent bg-transparent text-right text-[#191919] outline-none transition-colors focus:border-[#D9D6FE] focus:bg-[#F8F6FF]"
                  min={0}
                  onChange={(event) =>
                    onConstraintChange("min", event.target.value)
                  }
                  type="number"
                  value={field.minChars ?? ""}
                />
              </label>
              <label className="flex h-[30px] items-center rounded-[4px] border border-[#E7E8EC] bg-[#FEFEFF] px-[10px] text-[14px] font-normal tracking-[0.56px] text-[#17181E]">
                <span>Max Chars</span>
                <input
                  className="ml-auto h-[24px] w-[76px] rounded-[4px] border border-transparent bg-transparent text-right text-[#191919] outline-none transition-colors focus:border-[#D9D6FE] focus:bg-[#F8F6FF]"
                  min={0}
                  onChange={(event) =>
                    onConstraintChange("max", event.target.value)
                  }
                  type="number"
                  value={field.maxChars ?? ""}
                />
              </label>
            </>
          ) : null}
          <label className="flex flex-col gap-[6px] rounded-[4px] border border-[#E7E8EC] bg-[#FEFEFF] px-[10px] py-[8px] text-[14px] font-normal tracking-[0.56px] text-[#17181E]">
            <span>{field.type === "image" ? "Prompt" : "Content"}</span>
            {field.type === "image" ? (
              <input
                className="h-[30px] rounded-[4px] border border-[#E7E8EC] bg-white px-[8px] text-[13px] tracking-normal text-[#191919] outline-none transition-colors focus:border-[#D9D6FE]"
                onChange={(event) => onChange(event.target.value)}
                value={field.value}
              />
            ) : (
              <textarea
                className="min-h-[72px] resize-y rounded-[4px] border border-[#E7E8EC] bg-white px-[8px] py-[6px] text-[13px] leading-[17px] tracking-normal text-[#191919] outline-none transition-colors focus:border-[#D9D6FE]"
                onChange={(event) => onChange(event.target.value)}
                value={field.value}
              />
            )}
          </label>
        </div>
      ) : null}
    </div>
  );
}
