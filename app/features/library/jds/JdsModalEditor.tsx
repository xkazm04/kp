"use client";

import { useMemo, useState } from "react";
import { Check, History, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { TextArea } from "@/app/_components/TextArea";
import type { CoachEdit } from "@/app/features/library/jobs/jobsCoachApply";
import { builderLintFindings } from "./jdsLibrary";
import { JdLintPanel } from "./JdsLintPanel";
import { JdRevisionList } from "./JdsRevisionList";
import { useJdEditor } from "./useJdEditor";
import { JdsModalEditorStagedBanner } from "./JdsModalEditorStagedBanner";

// Direction 1 — "edit where you work": in-place JD editing INSIDE the Ledger's
// detail modal, so a recruiter never has to leave for the public /jds/[slug]
// page to fix wording. It drives the SAME machinery the public JdActions uses —
// now the literal same one: both share `useJdEditor` (PATCH /api/jds/[slug] with
// content-CAS via baseBody + the /revisions history/revert route + the honest
// 401 operator gate). This surface adds the coach staged-suggestion banner and
// the live lint panel (builderLintFindings + JdLintPanel) on top.
//
// Operator gate (branch reality): the PATCH/revert routes are requireOperator-
// gated server-side. In this app "operator" means: open mode (KP_OPERATOR_PASSWORD
// unset) → everyone; password set → any valid NON-demo session. The Ledger only
// renders behind the operator-gated workspace, so a real recruiter here IS the
// operator and the write succeeds. The single way to reach this as a non-operator
// is an anonymous demo session viewing the workspace — that PATCH 401s. There is
// no client-side operator signal (the whole workspace is client-rendered and the
// list API is read-only for this context), so rather than invent a new probe
// endpoint we surface the gate HONESTLY on the 401 (useJdEditor's gate latch): the
// controls latch into a disabled state carrying the reason, never a
// silently-failing button.
export function JdModalEditor({
  slug,
  initialTitle,
  initialBody,
  marketResearch,
  stagedSuggestion,
  onDone,
}: {
  slug: string;
  initialTitle: string;
  initialBody: string;
  // Whether a grounded market-salary band exists — feeds the lint's salaryAvailable
  // suppression exactly as the builder does (the same seam), so a role that carries
  // a band doesn't trip the missing-salary advisory.
  marketResearch: boolean;
  // winnability-apply — when the editor was opened from a coach recommendation, the
  // staged change to surface as a dismissible suggestion banner above the fields.
  // Advisory only: the recruiter makes the wording change themselves and saves
  // through the existing PATCH/CAS path (which re-ingests the linked job).
  stagedSuggestion?: CoachEdit | null;
  // Refresh the detail + leave edit mode (used by a successful save AND the
  // conflict "Reload latest" recovery).
  onDone: () => void;
}) {
  const t = useTranslations("library.tab");
  const [draftTitle, setDraftTitle] = useState(initialTitle);
  const [draftBody, setDraftBody] = useState(initialBody);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  // The ONE shared edit client — fetch / baseBody CAS / 401 gate latch / 409
  // conflict / revisions / revert. A successful save or revert reloads the detail
  // and leaves edit mode (onDone).
  const editor = useJdEditor({
    slug,
    baseBody: initialBody,
    copy: {
      gateReason: t("editGateReason"),
      conflict: t("editConflict"),
      saveError: t("editSaveError"),
      revertError: t("editRevertError"),
    },
    onSaved: onDone,
    onReverted: onDone,
  });

  // Live advisory lint over the edited body — the SAME engine + threshold the
  // builder uses (hidden below the min-body length, so a short draft isn't nagged).
  const lintFindings = useMemo(() => builderLintFindings(draftBody, { marketResearch }), [draftBody, marketResearch]);

  const disabled = editor.busy || editor.gateBlocked;

  return (
    <div className="space-y-3">
      {stagedSuggestion && !suggestionDismissed ? (
        <JdsModalEditorStagedBanner suggestion={stagedSuggestion} onDismiss={() => setSuggestionDismissed(true)} t={t} />
      ) : null}
      <div className="space-y-3 rounded-lg border border-stone-200 bg-paper/40 p-4">
        <label className="block text-sm font-semibold text-steel">
          {t("editTitleLabel")}
          <TextInput
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            disabled={editor.gateBlocked}
            className="mt-1"
          />
        </label>
        <label className="block text-sm font-semibold text-steel">
          {t("editBodyLabel")}
          <TextArea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            disabled={editor.gateBlocked}
            rows={16}
            sizeVariant="sm"
            className="mt-1 font-mono"
          />
        </label>

        {/* The wired lint panel (J1) — the same advisory seam as the builder. */}
        {lintFindings.length > 0 ? <JdLintPanel findings={lintFindings} /> : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => editor.save(draftTitle, draftBody)}
            disabled={disabled}
            title={editor.gateBlocked ? t("editGateReason") : undefined}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
          >
            <Check size={13} aria-hidden /> {editor.busy ? t("editSaving") : t("editSave")}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink"
          >
            <X size={13} aria-hidden /> {t("editCancel")}
          </button>
          <button
            type="button"
            onClick={editor.toggleHistory}
            aria-expanded={editor.historyOpen}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink"
          >
            <History size={13} aria-hidden /> {editor.historyOpen ? t("editHideHistory") : t("editHistory")}
          </button>
          <span className="text-sm text-steel">{t("editLinkedNote")}</span>
        </div>

        {editor.error ? (
          <p role="alert" className="text-sm text-red-700">
            {editor.error}
            {editor.conflict ? (
              <>
                {" "}
                <button type="button" onClick={onDone} className="focus-ring font-semibold text-coral hover:underline">
                  {t("editReload")}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {editor.historyOpen ? (
        <div className="rounded-lg border border-stone-200 bg-paper/40 p-4">
          {editor.revLoading && editor.revisions === null ? (
            <p className="text-sm text-steel">{t("editHistoryLoading")}</p>
          ) : !editor.revisions || editor.revisions.length === 0 ? (
            <p className="text-sm text-steel">{t("editHistoryEmpty")}</p>
          ) : (
            <JdRevisionList
              revisions={editor.revisions}
              reverting={editor.reverting}
              gateBlocked={editor.gateBlocked}
              onRevert={editor.revert}
              gateReason={t("editGateReason")}
              viewLabel={t("editRevisionView")}
              hideLabel={t("editRevisionHide")}
              revertLabel={t("editRevert")}
              revertingLabel={t("editReverting")}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
