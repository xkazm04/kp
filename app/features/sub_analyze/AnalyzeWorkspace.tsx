"use client";

import { useState } from "react";
import { AnalyzeTab } from "./AnalyzeTab";
import { HistoryTab } from "@/app/features/sub_history/HistoryTab";

// Consolidates the v1 deep-analysis tool and its saved-runs list into one
// surface with a segmented switch, so they occupy a single sidebar slot.
export function AnalyzeWorkspace({ initialMode = "new" }: { initialMode?: "new" | "history" }) {
  const [mode, setMode] = useState<"new" | "history">(initialMode);
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1 shadow-panel">
        {(["new", "history"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`focus-ring h-9 rounded-md px-4 text-sm font-semibold transition-colors ${
              mode === m ? "bg-ink text-white" : "text-steel hover:bg-paper hover:text-ink"
            }`}
          >
            {m === "new" ? "New analysis" : "History"}
          </button>
        ))}
      </div>
      {mode === "new" ? <AnalyzeTab /> : <HistoryTab />}
    </div>
  );
}
