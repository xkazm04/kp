"use client";

// The "Define need" sub-tab: intake form + the reality-reflection analysis
// panel side by side, split out of DevTab.tsx.
import { NeedForm } from "./DevNeedForm";
import { AnalysisView } from "./DevAnalysisView";
import type { ComponentProps } from "react";

export function DevTabDefineView({
  needForm,
  analysisView,
}: {
  needForm: ComponentProps<typeof NeedForm>;
  analysisView: ComponentProps<typeof AnalysisView>;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_1fr]">
      {/* intake */}
      <NeedForm {...needForm} />

      {/* reality reflection */}
      <AnalysisView {...analysisView} />
    </div>
  );
}
