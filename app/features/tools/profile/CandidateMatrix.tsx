"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { archetypeDisplayKey } from "@/app/_lib/archetypes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { ArchetypeDef, CandidateRow } from "@/app/features/shared/profileTypes";
import { ProfileEmptyState } from "./ProfileEmptyStates";
import { CandidateMatrixCell } from "./CandidateMatrixCell";

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
  /** Ids of retired archetypes — mirrors the roster: a retired column with
   *  candidates is flagged; an EMPTY retired column is pruned (no dead all-dots
   *  column). */
  archivedArchetypeIds?: readonly string[];
}) {
  const t = useTranslations("profile.matrix");
  // Reuse the roster's exact "retired" vocabulary so the marking reads identically
  // across both candidate projections.
  const tr = useTranslations("profile.roster");
  const enumLabel = useEnumLabel();
  const [candidates, setCandidates] = useState<CandidateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Columns = the registry archetypes, plus any archetype that appears on a
  // candidate but isn't (or no longer is) in the registry — mapped through
  // archetypeDisplayKey so the fail-closed "unknown" sentinel folds into a single
  // honest "Unrouted" column instead of a raw "unknown" one, and no candidate is
  // dropped from the matrix. Retired archetypes still score, so a retired column
  // that HAS candidates stays (flagged); an EMPTY one is pruned as dead chrome.
  const columns = useMemo(() => {
    const archived = new Set(archivedArchetypeIds ?? []);
    const usedKeys = new Set((candidates ?? []).map((c) => archetypeDisplayKey(c.archetype)));
    const cols = archetypes
      .filter((a) => !archived.has(a.id) || usedKeys.has(a.id))
      .map((a) => ({ id: a.id, label: a.label, archived: archived.has(a.id) }));
    const known = new Set(cols.map((c) => c.id));
    const extra = [
      ...new Set((candidates ?? []).map((c) => archetypeDisplayKey(c.archetype)).filter((id) => !known.has(id))),
    ];
    return [...cols, ...extra.map((id) => ({ id, label: id, archived: false }))];
  }, [archetypes, candidates, archivedArchetypeIds]);

  // Sort by column order then score desc, so each candidate's single filled cell
  // clusters under its archetype column and reads as a grouped block.
  const rows = useMemo(() => {
    if (!candidates) return [];
    const order = new Map(columns.map((c, i) => [c.id, i]));
    return [...candidates].sort(
      (a, b) =>
        (order.get(archetypeDisplayKey(a.archetype)) ?? 99) - (order.get(archetypeDisplayKey(b.archetype)) ?? 99) ||
        (b.score ?? -1) - (a.score ?? -1)
    );
  }, [candidates, columns]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      {/* The "Build candidate profile" CTA moved up to ProfileTab, beside the
          projection toggle — shared by both projections, so no button here. */}
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-h2 text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
      </header>

      <div className="mt-4">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
        ) : candidates == null ? (
          // Tier 2 (docs/design/loading-choreography.md): first fetch in flight — hold the
          // matrix's height, invisible for 150ms. `reloadKey` bumps re-run the
          // effect but never reset `candidates` to null, so a refetch settles
          // silently behind whatever is already on screen.
          <div className="h-32 reveal-quiet" aria-hidden />
        ) : rows.length === 0 ? (
          <ProfileEmptyState view="matrix" archetypes={archetypes} onNewProfile={onNewProfile} />
        ) : (
          <div className="animate-arrive-in overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full table-fixed divide-y divide-stone-200">
              <thead className="bg-paper">
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.id}
                      scope="col"
                      className="px-3 py-2.5 text-left text-sm font-semibold uppercase tracking-wide text-steel"
                    >
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {/* Registry columns carry their own label; the synthetic
                            "unrouted"/extra columns (label === id) localize via the enum. */}
                        <span>{c.label === c.id ? enumLabel("archetype", c.id) : c.label}</span>
                        {c.archived ? (
                          <span
                            className="rounded-full bg-stone-200 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-steel"
                            title={tr("retiredArchetypeTitle")}
                          >
                            {tr("retiredArchetype")}
                          </span>
                        ) : null}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((cand) => (
                  <tr key={cand.key} className="align-top">
                    {columns.map((c) => (
                      <td key={c.id} className="px-3 py-2">
                        {c.id === archetypeDisplayKey(cand.archetype) ? (
                          <CandidateMatrixCell cand={cand} onEditProfile={onEditProfile} />
                        ) : (
                          <span className="text-stone-300">{"·"}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
