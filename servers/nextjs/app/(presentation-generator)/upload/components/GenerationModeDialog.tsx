"use client";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export type GenerationMode = "standard" | "smart";

type GenerationModeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (mode: GenerationMode) => void;
};

export default function GenerationModeDialog({
  open,
  onOpenChange,
  onSelect,
}: GenerationModeDialogProps) {
  const selectMode = (mode: GenerationMode) => {
    onSelect(mode);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideDefaultClose
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        }}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-[850px] gap-0 overflow-y-auto border border-[#EDEEEF] bg-white p-0 sm:rounded-[40px]"
      >
        <div className="sticky top-0 z-10 border-b border-[#EDEEEF] bg-[#F9FAFB] px-4 py-4 sm:px-8">
          <DialogTitle className="text-xl font-medium tracking-[-0.2px] text-[#808080]">
            Select Mode
          </DialogTitle>
          <DialogClose className="absolute right-4 top-5 sm:right-8">
            <X className="h-5 w-5 text-[#808080]" />
          </DialogClose>
        </div>

        <div className="p-3 sm:p-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <div className="pb-2.5">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-[18px] border border-[#EDEEEF] bg-white">
                  <video
                    src="/Standard.mp4"
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
              <div className="rounded-[20px] border border-[#EBE9FE] bg-[#F4F3FF] px-3.5 pb-5 pt-3.5">
                <div className="flex items-center justify-between border-b border-[#EBE9FE] pb-3.5">
                  <p className="text-xl font-medium text-[#333333]">Standard</p>
                  <p className="text-[10px] font-medium text-[#6938EF]">
                    Fixed layout
                  </p>
                </div>
                <p className="mb-2 py-1.5 text-base font-medium text-[#666666]">
                  A rigid, predefined layout with fixed structure, ensuring
                  consistency, clarity, and predictable results.
                </p>
                <Button
                  type="button"
                  className="rounded-[80px] bg-[#7A5AF8] px-5 text-base font-medium text-white shadow-none hover:bg-[#6938EF]/90"
                  onClick={() => selectMode("standard")}
                >
                  Select Standard
                </Button>
              </div>
            </div>

            <div>
              <div className="pb-2.5">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-[18px] border border-[#EDEEEF] bg-white">
                  <video
                    src="/Smart.mp4"
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
              <div className="rounded-[20px] border border-[#EBE9FE] bg-[#F4F3FF] px-3.5 pb-5 pt-3.5">
                <div className="flex items-center justify-between border-b border-[#EBE9FE] pb-3.5">
                  <p className="text-xl font-medium text-[#333333]">Smart</p>
                  <p className="text-[10px] font-medium text-[#6938EF]">
                    Flexible layout
                  </p>
                </div>
                <p className="mb-2 py-1.5 text-base font-medium text-[#666666]">
                  A smart adaptive layout with flexible structure, balancing
                  consistency and content.
                </p>
                <Button
                  type="button"
                  className="h-auto min-h-10 rounded-[80px] px-5 text-base font-medium text-[#101323] shadow-none"
                  style={{
                    background:
                      "linear-gradient(270deg, #D5CAFC 2.4%, #E3D2EB 27.88%, #F4DCD3 69.23%, #FDE4C2 100%)",
                  }}
                  onClick={() => selectMode("smart")}
                >
                  Select Smart
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
