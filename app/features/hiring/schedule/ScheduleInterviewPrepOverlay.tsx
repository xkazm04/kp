"use client";

// The prep modal's "AI interview questions for this candidate" section (spark
// interview-kit-template, WP-C): the job interview kit this candidate's interview runs
// on, this candidate's own CV probes on top of it, and the recruiter's per-candidate
// OVERLAY — drop, rewrite or add a question for THIS candidate only.
//
// Rendered only when the role has a kit. Every edit is saved at once (the whole overlay,
// serialized — useScheduleInterviewPrepOverlay), because the prep modal has no Save
// button and the checklist beside it autosaves too; a Regenerate keeps it (the key is
// human-owned, interview-prep-run.ts mergeRegeneratedPrep).
import { useState } from "react";
import { ListChecks, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_GHOST, CHIP_QUIET, META_LABEL } from "@/app/_components/ui/recipes";
import { KIT_OVERLAY_CV_PROBES_ASKED, KIT_OVERLAY_MAX_ADDED, KIT_OVERLAY_MAX_TEXT_CHARS } from "@/app/_lib/interview-kit-overlay";
import { KIT_MAX_MUST_ASKS, type KitOverlay } from "@/app/_lib/interview-kit-types";
import type { PrepKitView } from "@/app/_lib/interview-prep-kit";
import {
  canAddToOverlay,
  canMarkAddedMustAsk,
  overlayAdd,
  overlayDrop,
  overlayEdit,
  overlayPatchAdded,
  overlayPruneStale,
  overlayRemoveAdded,
  overlayRestore,
  overlayRevert,
  type OverlayGroup,
} from "./scheduleInterviewPrepOverlayModel";
import { OverlayAddForm, OverlayRowItem } from "./ScheduleInterviewPrepOverlayRow";
import { useScheduleInterviewPrepOverlay } from "./useScheduleInterviewPrepOverlay";
import type { Prep } from "./scheduleInterviewPrepTypes";

/** Which group's add form is open: a competency id, or LOOSE for "a question of your own". */
const LOOSE = "__loose__";

export function PrepKitOverlay({ entryId, kit, prep }: { entryId: string; kit: PrepKitView | null; prep: Prep | null }) {
  const o = useScheduleInterviewPrepOverlay(entryId, kit, prep);
  const { t, overlay, view, apply } = o;
  const tk = useTranslations("jobs.kit");
  const [adding, setAdding] = useState<string | null>(null);
  if (!kit || !view) return null;

  const canAdd = canAddToOverlay(overlay);
  const mustAskOpen = (id: string | null) => canMarkAddedMustAsk(overlay, view.keptKitMustAsks, id);
  const add = (competencyId: string | null) => (text: string, mustAsk: boolean) => {
    apply(overlayAdd(overlay, { competencyId, text, mustAsk }));
    setAdding(null);
  };

  const groupTitle = (g: OverlayGroup) =>
    g.kind === "cv" ? t("cvTitle") : g.kind === "loose" ? t("looseTitle") : g.title?.trim() || t("untitled");

  const rowsOf = (g: OverlayGroup, patch: (next: KitOverlay) => void) =>
    g.rows.map((row) => (
      <OverlayRowItem
        key={row.id}
        row={row}
        canMarkMustAsk={mustAskOpen(row.id)}
        onDrop={() => patch(overlayDrop(overlay, row.id))}
        onRestore={() => patch(overlayRestore(overlay, row.id))}
        onEdit={(text) => patch(overlayEdit(overlay, row.id, text, row.original ?? ""))}
        onRevert={() => patch(overlayRevert(overlay, row.id))}
        onRemoveAdded={() => patch(overlayRemoveAdded(overlay, row.id))}
        onPatchAdded={(p) => patch(overlayPatchAdded(overlay, row.id, p))}
        t={t}
      />
    ));

  const addControl = (key: string, competencyId: string | null, label: string) =>
    adding === key ? (
      <OverlayAddForm canMarkMustAsk={mustAskOpen(null)} onAdd={add(competencyId)} onCancel={() => setAdding(null)} t={t} />
    ) : (
      <button
        type="button"
        onClick={() => setAdding(key)}
        disabled={!canAdd}
        title={canAdd ? undefined : t("addFull", { max: KIT_OVERLAY_MAX_ADDED })}
        className={`${BTN_GHOST} px-2 py-1 text-sm`}
      >
        <Plus size={13} className="text-coral" aria-hidden /> {label}
      </button>
    );

  const hasLoose = view.groups.some((g) => g.kind === "loose");

  return (
    <section aria-label={t("title")} className="space-y-3">
      <p className={`${META_LABEL} flex items-center gap-1.5 tracking-wide`}>
        <ListChecks size={13} aria-hidden /> {t("title")}
      </p>
      <p className="text-sm text-steel">
        {t("intro", { version: kit.version })} {kit.pinned ? t("pinnedNote") : t("publishedNote")}
      </p>

      {view.groups.map((g) => (
        <div key={g.id} className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">{groupTitle(g)}</span>
            {g.weight !== null ? <span className={CHIP_QUIET}>{tk(`weight.${g.weight}`)}</span> : null}
          </div>
          {g.kind === "cv" ? <p className="text-sm text-steel">{t("cvIntro", { max: KIT_OVERLAY_CV_PROBES_ASKED })}</p> : null}
          <ul className="space-y-1.5">{rowsOf(g, apply)}</ul>
          {g.kind === "competency"
            ? addControl(g.id, g.id, t("addHere"))
            : g.kind === "loose"
              ? addControl(LOOSE, null, t("addLoose"))
              : null}
        </div>
      ))}
      {!hasLoose ? addControl(LOOSE, null, t("addLoose")) : null}

      <p className="text-sm text-steel nums">
        {t("addedMeta", { count: overlay.added.length, max: KIT_OVERLAY_MAX_ADDED })}
        {" · "}
        {t("mustAskMeta", {
          count: view.keptKitMustAsks + overlay.added.filter((a) => a.mustAsk).length,
          max: KIT_MAX_MUST_ASKS,
        })}
      </p>

      {o.problems.length > 0 ? (
        <ul role="alert" className="space-y-0.5 text-sm text-coral">
          {o.problems.map((p) => (
            <li key={p}>{t(`problems.${p}`, { max: p === "too_many_added" ? KIT_OVERLAY_MAX_ADDED : p === "text_too_long" ? KIT_OVERLAY_MAX_TEXT_CHARS : KIT_MAX_MUST_ASKS })}</li>
          ))}
        </ul>
      ) : null}

      {view.staleRefs > 0 ? (
        <p className="text-sm text-steel">
          {t("stale", { count: view.staleRefs })}{" "}
          <button type="button" onClick={() => apply(overlayPruneStale(overlay, view))} className="focus-ring font-semibold text-coral underline">
            {t("clearStale")}
          </button>
        </p>
      ) : null}

      <p aria-live="polite" className="text-sm">
        {o.saveState === "saving" ? (
          <span className="text-steel">{t("saving")}</span>
        ) : o.saveState === "failed" && o.saveError ? (
          <span className="text-coral">{o.saveError}</span>
        ) : o.saveState === "saved" ? (
          <span className="text-moss">{t("saved")}</span>
        ) : null}
      </p>
      <p className="text-sm text-steel">{t("regenerateNote")}</p>
    </section>
  );
}
