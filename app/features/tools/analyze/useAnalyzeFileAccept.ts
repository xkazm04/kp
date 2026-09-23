"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { MAX_CV_VARIANTS } from "./AnalyzeTypes";
import {
  planDrop,
  planSingleSlot,
  type DropPlan,
  type DropRefusal,
  type DropTarget,
} from "./analyzeDropRouting";
import type { WindowDrop } from "./useAnalyzeGlobalFileDrag";
import type { AnalyzeFormState } from "./useAnalyzeForm";

/**
 * One refused file as the sentence a recruiter reads: "{name} was not added. {why}".
 * The why comes from a CODE, never a sentence: the two upload codes resolve through
 * `errors.<CODE>` (the same message the server's 400/413 produces, in the reader's
 * language), `cap` and `single-slot` through the analyze catalog.
 */
export function useRefusalText() {
  const t = useTranslations("analyze");
  const errMsg = useErrorMessage();
  return useCallback(
    (refusal: DropRefusal) => {
      const reason =
        refusal.reason === "cap"
          ? t("variantLimitReject", { count: MAX_CV_VARIANTS })
          : refusal.reason === "single-slot"
            ? t("dropSingleSlot")
            : errMsg({ code: refusal.reason }, t("errUploadRejected"));
      return t("dropRefused", { name: refusal.file.name, reason });
    },
    [errMsg, t],
  );
}

/**
 * The Analyze form's intake (challenge-r03 cv-analyze-intake/A): the one place a
 * plan from `planDrop` is APPLIED. The window drop (`route`), every zone picker
 * (`intake`), the sample and pasted CV, and the per-row Replace all arrive here, so
 * a click and a drop cannot diverge, and every file that did not go in is named in
 * `refusals` (rendered once, by AnalyzeForm). Commits go through the setters the form
 * already holds, which write through to the attachment store (analyzeAttachmentStore).
 *
 * The CV hook keeps its own authorities: the content dedupe and the race-safe cap
 * re-check after its hash await. The plan is the pre-check that names reasons.
 */
export function useAnalyzeIntake(state: AnalyzeFormState) {
  const describe = useRefusalText();
  const [refusals, setRefusals] = useState<string[]>([]);
  const { inputs, setters, handlers, library } = state;

  function apply(plan: DropPlan | null): DropPlan | null {
    if (!plan) return null;
    for (const file of plan.cv) void handlers.addCvFile(file);
    if (plan.jd) {
      // The picker's rule, kept by every path: a JD file detaches the saved-JD slug.
      setters.setJobDescriptionFile(plan.jd.file);
      library.setSelectedJdSlug(null);
    }
    if (plan.company) setters.setCompanyFile(plan.company.file);
    setRefusals(plan.refused.map(describe));
    return plan;
  }

  function snapshot() {
    return {
      cvCount: inputs.cvFiles.length,
      maxCv: MAX_CV_VARIANTS,
      hasJdFile: inputs.jobDescriptionFile !== null,
      hasCompanyFile: inputs.companyFile !== null,
    };
  }

  /** A picker selection (or the sample / pasted CV) for one zone. */
  const intake = (zone: DropTarget, files: File[]) => apply(planDrop(zone, files, snapshot()));

  /** The window listener's drop — the zone it resolved, the files, the drag kind. */
  const route = (drop: WindowDrop) => {
    apply(planDrop(drop.zone, drop.files, { ...snapshot(), isFileDrag: drop.isFileDrag }));
  };

  /** Swap one CV variant: a single slot that is, by definition, filled. */
  const replaceCv = (index: number, file: File) => {
    const { slot, refused } = planSingleSlot([file], true);
    if (slot) handlers.replaceCvFile(index, slot.file);
    setRefusals(refused.map(describe));
  };

  /** A refusal that is not about a file's type or size (the sample CV fetch failed). */
  const report = (message: string) => setRefusals([message]);

  return { intake, route, replaceCv, report, refusals };
}
