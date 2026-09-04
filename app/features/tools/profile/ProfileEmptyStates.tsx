"use client";

/**
 * Profile tab — first-run empty states, prototyped as directional variants.
 *
 * The Profile tab projects ONE candidate population two ways (ProfileTab's
 * List | Matrix toggle), and each projection is empty for a different reason:
 *
 *   List   — "no candidate profile RECORD has been saved yet"
 *   Matrix — "nothing has been ROUTED into the archetypes yet, so there is
 *             nothing to cross-compare"
 *
 * A direction here is one mental model that answers BOTH, not two unrelated
 * illustrations. Two are on offer behind a local switcher (baseline default):
 *
 *   dossier — the profile as an OBJECT. A record card and the archetype
 *             pigeonholes it gets filed into. List shows the shape of the card
 *             that is missing; Matrix shows the recruiter's OWN archetypes
 *             standing empty, so the missing ingredient reads as asymmetric
 *             (the drawers exist, the cards don't).
 *   supply  — the profile as an OUTPUT. One production route,
 *             CV analysis → saved record → archetype routing → comparison,
 *             with the stage that has run dry marked. List and Matrix are the
 *             SAME rail with a different current node.
 *
 * Glyphs are /motionize traces (profileRosterGlyph, profileMatrixGlyph); every
 * fill resolves through MotionizedGlyph's brand-token snap, so no hex reaches
 * this file and both themes come free.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Plus } from "lucide-react";
import { Meter } from "@/app/_components/Meter";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { GLYPH_SIZE } from "@/app/_components/glyph/glyphSizes";
import { PROFILE_ROSTER_GLYPH } from "@/app/_components/glyph/glyphs/profileRosterGlyph";
import { PROFILE_MATRIX_GLYPH } from "@/app/_components/glyph/glyphs/profileMatrixGlyph";
import {
  BTN_PRIMARY,
  CARD_PAD,
  CHIP_QUIET,
  EYEBROW,
  INTRO,
  META_LABEL,
  PANEL,
  PANEL_SUNKEN,
  TITLE_DISPLAY,
} from "@/app/_components/ui/recipes";
import { buildTabSwitchUrl, type WorkspaceTabId } from "@/app/features/shell/tabs";
import type { ArchetypeDef } from "@/app/features/shared/profileTypes";

/* ────────────────────────────── shared plumbing ───────────────────────────── */

/** Which projection is asking. Both share one mental model. */
export type ProfileEmptyView = "list" | "matrix";

export type ProfileEmptyProps = {
  /** The live archetype registry — the Matrix's columns, already defined by the user. */
  archetypes: ArchetypeDef[];
  /** Open the profile editor in create mode. */
  onNewProfile?: () => void;
};

/** Navigate upstream exactly the way ChainEmptyState does. */
function ChainLink({ tab, label }: { tab: WorkspaceTabId; label: string }) {
  const router = useRouter();
  const search = useSearchParams();
  return (
    <button
      type="button"
      onClick={() => router.push(buildTabSwitchUrl(tab, search.toString()))}
      className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
    >
      {label} <ArrowRight size={13} aria-hidden />
    </button>
  );
}

/** The one "build a profile" action, shared by every variant that offers it. */
function BuildProfileButton({ onNewProfile, label }: { onNewProfile?: () => void; label: string }) {
  if (!onNewProfile) return null;
  return (
    <button type="button" onClick={onNewProfile} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
      <Plus size={15} aria-hidden /> {label}
    </button>
  );
}

/* ─────────────────── the record card and the drawers it files into ────────── */

function SpecimenCard() {
  const t = useTranslations("profile");
  return (
    <div className={`${PANEL} ${CARD_PAD} mx-auto max-w-md text-left opacity-70`} aria-hidden>
      <p className={META_LABEL}>{t("empty.specimenLabel")}</p>
      <div className="mt-3 flex items-center gap-3">
        <span className="h-9 w-9 shrink-0 rounded-full bg-coral/20" />
        <div className="min-w-0 flex-1">
          <span className="block h-3 w-32 rounded-full bg-stone-200" />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={CHIP_QUIET}>{t("empty.chipArchetype")}</span>
            <span className={CHIP_QUIET}>{t("empty.chipRoleFamily")}</span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Meter value={0} tone="null" className="h-1.5 w-32" />
        <span className="text-sm text-steel">{t("roster.completenessPct", { pct: 0 })}</span>
      </div>
    </div>
  );
}

function DossierList({ onNewProfile }: ProfileEmptyProps) {
  const t = useTranslations("profile");
  return (
    <div className={`${PANEL_SUNKEN} p-8 text-center`}>
      <MotionizedGlyph
        data={PROFILE_ROSTER_GLYPH.data}
        viewBox={PROFILE_ROSTER_GLYPH.viewBox}
        className={`mx-auto ${GLYPH_SIZE.xl}`}
        entrance="staggered-draw"
      />
      <p className={`${EYEBROW} mt-4`}>{t("roster.eyebrow")}</p>
      <h3 className={`${TITLE_DISPLAY} mt-1`}>{t("empty.listTitle")}</h3>
      <p className={`${INTRO} mx-auto mt-2 max-w-lg`}>{t("empty.listBody")}</p>
      <div className="mt-6">
        <SpecimenCard />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <BuildProfileButton onNewProfile={onNewProfile} label={t("empty.listCta")} />
        <ChainLink tab="analyze" label={t("empty.listCtaAnalyze")} />
      </div>
    </div>
  );
}

/** One archetype column, standing open and empty. */
function Pigeonhole({ label }: { label: string }) {
  const t = useTranslations("profile");
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-white/50 px-3 py-4 text-center">
      <p className="truncate text-sm font-semibold text-ink">{label}</p>
      <p className="mt-2 text-sm text-steel">{t("empty.filed", { count: 0 })}</p>
    </div>
  );
}

function DossierMatrix({ archetypes, onNewProfile }: ProfileEmptyProps) {
  const t = useTranslations("profile");
  const live = archetypes.filter((a) => !a.archived);
  const shown = live.slice(0, 4);
  const rest = live.length - shown.length;
  return (
    <div className={`${PANEL_SUNKEN} p-8 text-center`}>
      <MotionizedGlyph
        data={PROFILE_MATRIX_GLYPH.data}
        viewBox={PROFILE_MATRIX_GLYPH.viewBox}
        className={`mx-auto ${GLYPH_SIZE.xl}`}
        entrance="staggered-draw"
      />
      <p className={`${EYEBROW} mt-4`}>{t("matrix.title")}</p>
      <h3 className={`${TITLE_DISPLAY} mt-1`}>{t("empty.matrixTitle")}</h3>
      <p className={`${INTRO} mx-auto mt-2 max-w-lg`}>
        {live.length > 0 ? t("empty.matrixBodyDefined", { count: live.length }) : t("empty.matrixBodyNone")}
      </p>
      {shown.length > 0 ? (
        <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((a) => (
            <Pigeonhole key={a.id} label={a.label} />
          ))}
        </div>
      ) : null}
      {rest > 0 ? <p className="mt-2 text-sm text-steel">{t("empty.moreArchetypes", { count: rest })}</p> : null}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <BuildProfileButton onNewProfile={onNewProfile} label={t("empty.matrixCta")} />
        <ChainLink tab="analyze" label={t("empty.matrixCtaAnalyze")} />
      </div>
    </div>
  );
}

// Indexed maps, NOT functions returning components — calling a component factory
/**
 * Rendered by BOTH empty branches (ProfileRoster and CandidateMatrix) so one
 * mental model answers both projections.
 */
export function ProfileEmptyState({ view, ...props }: ProfileEmptyProps & { view: ProfileEmptyView }) {
  return view === "list" ? <DossierList {...props} /> : <DossierMatrix {...props} />;
}
