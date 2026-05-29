"use client";

import { useState } from "react";
import { FileText, Plus, UploadCloud, X } from "lucide-react";
import { formatFileSize } from "./AnalyzeApi";
import { useGlobalFileDrag } from "./useGlobalFileDrag";

export function AnalyzeProfileInput({
  files,
  onAdd,
  onReplace,
  onRemove,
  maxVariants,
}: {
  files: File[];
  onAdd: (file: File) => void;
  onReplace: (index: number, file: File) => void;
  onRemove: (index: number) => void;
  maxVariants: number;
}) {
  const [isOverDropzone, setIsOverDropzone] = useState(false);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const isWindowDragging = useGlobalFileDrag(onAdd);

  async function loadSample() {
    if (isLoadingSample) return;
    setIsLoadingSample(true);
    try {
      const response = await fetch("/samples/sample-cv.txt");
      if (!response.ok) return;
      const blob = await response.blob();
      const file = new File([blob], "sample-cv.txt", { type: "text/plain" });
      onAdd(file);
    } finally {
      setIsLoadingSample(false);
    }
  }

  if (files.length === 0) {
    const isActive = isWindowDragging || isOverDropzone;
    return (
      <>
        <label
          htmlFor="profile-file-0"
          onDragEnter={(event) => {
            event.preventDefault();
            setIsOverDropzone(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsOverDropzone(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsOverDropzone(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsOverDropzone(false);
            const file = event.dataTransfer.files?.[0];
            if (file) onAdd(file);
          }}
          className={`flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-lg border px-3 text-center transition-colors ${
            isActive
              ? "border-solid border-coral bg-coral/5"
              : "border-dashed border-stone-300 bg-white hover:border-coral"
          }`}
        >
          <UploadCloud className={`h-5 w-5 ${isActive ? "text-coral" : "text-steel"}`} aria-hidden />
          <span className="mt-1 max-w-full truncate text-xs font-semibold text-ink">
            {isActive ? "Drop CV here" : "Drop CV or click"}
          </span>
          <span className="text-[10px] text-steel">PDF · DOCX · TXT · MD up to 8 MB</span>
        </label>
        <input
          id="profile-file-0"
          type="file"
          accept=".pdf,.docx,.txt,.md"
          className="sr-only"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) onAdd(next);
            event.target.value = "";
          }}
        />
        <p className="mt-2 text-center text-[11px] text-steel">
          New here?{" "}
          <button
            type="button"
            onClick={loadSample}
            disabled={isLoadingSample}
            className="focus-ring rounded font-semibold text-coral underline-offset-2 hover:underline disabled:opacity-60"
          >
            {isLoadingSample ? "Loading sample…" : "Try sample CV"}
          </button>
        </p>
      </>
    );
  }

  const canAddMore = files.length < maxVariants;

  return (
    <div className="space-y-2">
      {files.map((file, index) => (
        <div
          key={`${file.name}-${index}`}
          className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2 py-1.5"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-steel" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ink">
              {files.length > 1 ? (
                <span className="text-coral">Variant {String.fromCharCode(65 + index)}: </span>
              ) : null}
              {file.name}
            </p>
            <p className="text-[10px] text-steel">{formatFileSize(file.size)}</p>
          </div>
          <label
            htmlFor={`profile-file-${index}`}
            className="focus-ring inline-flex h-7 cursor-pointer items-center justify-center rounded-md border border-stone-300 bg-white px-1.5 text-[10px] font-semibold text-ink hover:bg-stone-50"
            title="Replace"
          >
            Replace
          </label>
          <input
            id={`profile-file-${index}`}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="sr-only"
            onChange={(event) => {
              const next = event.target.files?.[0];
              if (next) onReplace(index, next);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label={
              files.length > 1
                ? `Remove variant ${String.fromCharCode(65 + index)}`
                : "Remove file"
            }
            className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-stone-300 bg-white text-ink hover:bg-stone-50"
            title="Remove"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      ))}
      {canAddMore ? (
        <>
          <label
            htmlFor={`profile-file-${files.length}`}
            className={`focus-ring flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-2 py-2 text-xs font-medium text-ink transition-colors ${
              isWindowDragging
                ? "border-coral bg-coral/5"
                : "border-stone-300 bg-white hover:border-coral hover:bg-paper"
            }`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add variant ({files.length}/{maxVariants})
          </label>
          <input
            id={`profile-file-${files.length}`}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="sr-only"
            onChange={(event) => {
              const next = event.target.files?.[0];
              if (next) onAdd(next);
              event.target.value = "";
            }}
          />
        </>
      ) : (
        <p className="text-[10px] text-steel">Variant limit reached.</p>
      )}
    </div>
  );
}

