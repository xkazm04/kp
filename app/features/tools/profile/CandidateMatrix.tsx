"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { ProfileEmptyState } from "./ProfileEmptyStates";
import { CandidateMatrixAtlas } from "./CandidateMatrixAtlas";
import { CandidateMatrixBaseline } from "./CandidateMatrixBaseline";
import { CandidateMatrixLedger } from "./CandidateMatrixLedger";
import { archetypeColumns } from "./candidateMatrixView";
import type { ArchetypeDef, CandidateRow } from "@/app/features/shared/profileTypes";

// PROTOTYPE HOST (/prototype round 1). Owns the fetch, the panel chrome and the
// empty/error states; the three variants below are pure presentation over the same
// (candidates, columns) props, so switching between them cannot change the data.
//
// The problem under test: the baseline is an archetype × candidate TABLE, and every
// candidate routes to exactly one archetype — so the grid is ~94% grey dots and
// orienting in it means scrolling both axes. Both variants remove the horizontal
// axis entirely; they disagree about what replaces it.
//   · Atlas  — the taxonomy as a wrapping MAP of tiles (whole taxonomy in one
//              eyeful, each tile carrying count + cohort shape), one territory
//              expanded at a time.
//   · Ledger — ONE column ruled into sticky archetype sections, with a chip index
//              to jump; everyone visible, continuously, never sideways.
const VARIANTS = ["atlas", "ledger", "baseline"] as const;
type Variant = (typeof VARIANTS)[number];

export function CandidateMatrix({
  archetypes,
  onEditProfile,
  onNewProfile,
  reloadKey = 0,
  archivedArchetypeIds,
}: {
  archetypes: ArchetypeDef[];
  /** Open the editor for a saved profile cell (same ?edit= flow the roster uses). */
  onEditProfile: (id: string) => void;
  /** Create CTA for the EMPTY state only — the always-on create button lives next
   *  to the projection toggle on ProfileTab, reachable from List and Matrix alike. */
  onNewProfile?: () => void;
  /** Bump to force a refetch (e.g. after a roster delete elsewhere on the tab). */
  reloadKey?: number;
  /** Ids of retired archetypes — a retired column with candidates is flagged; an
   *  EMPTY retired column is pruned (no dead all-dots column). */
  archivedArchetypeIds?: readonly string[];
}) {
  const t = useTranslations("profile.matrix");
  const [candidates, setCandidates] = useState<CandidateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variant, setVariant] = useState<Variant>("atlas");

  useEffect(() => {
    let alive = true;
    fetch("/api/profile/candidates")
      .then((r) => r.json())
      .then((p) => {
        if (!alive) return;
        if (p.error) {
          setError(p.error);
        } else {
          // Clear any prior error in the continuation (not synchronously in the
          // effect body) so a successful refetch after a transient failure recovers.
          setError(null);
          setCandidates((p.candidates as CandidateRow[]) ?? []);
        }
      })
      .catch(() => {
        if (alive) setError(t("loadFailed"));
      });
    return () => {
      alive = false;
    };
  }, [t, reloadKey]);

  const columns = useMemo(
    () => archetypeColumns(archetypes, candidates ?? [], archivedArchetypeIds ?? []),
    [archetypes, candidates, archivedArchetypeIds]
  );

  const body = () => {
    if (!candidates) return null;
    const props = { candidates, columns, onEditProfile };
    if (variant === "atlas") return <CandidateMatrixAtlas {...props} />;
    if (variant === "ledger") return <CandidateMatrixLedger {...props} />;
    return <CandidateMatrixBaseline {...props} />;
  };

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      {/* The "Build candidate profile" CTA lives on ProfileTab beside the projection
          toggle — shared by both projections, so no button here. */}
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-h2 text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
      </header>

      <div className="mt-4 space-y-4">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
        ) : candidates == null ? (
          // Tier 2 (docs/design/loading-choreography.md): first fetch in flight — hold the
          // matrix's height, invisible for 150ms. `reloadKey` bumps re-run the effect but
          // never reset `candidates` to null, so a refetch settles silently behind
          // whatever is already on screen.
          <div className="h-32 reveal-quiet" aria-hidden />
        ) : candidates.length === 0 ? (
          <ProfileEmptyState view="matrix" archetypes={archetypes} onNewProfile={onNewProfile} />
        ) : (
          <>
            <SegmentedControl
              label={t("variantLabel")}
              value={variant}
              onChange={setVariant}
              options={VARIANTS.map((v) => ({ value: v, label: t(`variant_${v}` as "variant_atlas") }))}
            />
            {body()}
          </>
        )}
      </div>
    </section>
  );
}
