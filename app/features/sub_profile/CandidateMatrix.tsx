"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { archetypeDisplayKey } from "@/app/_lib/archetypes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { ArchetypeDef, CandidateRow } from "./ProfileTypes";

export function CandidateMatrix({
  archetypes,
  onNewProfile,
  onEditProfile,
  reloadKey = 0,
}: {
  archetypes: ArchetypeDef[];
  onNewProfile: () => void;
  /** Open the editor for a saved profile cell (same ?edit= flow the roster uses). */
  onEditProfile: (id: string) => void;
  /** Bump to force a refetch (e.g. after a roster delete elsewhere on the tab). */
  reloadKey?: number;
}) {
  const t = useTranslations("profile.matrix");
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
  // dropped from the matrix.
  const columns = useMemo(() => {
    const cols = archetypes.map((a) => ({ id: a.id, label: a.label }));
    const known = new Set(cols.map((c) => c.id));
    const extra = [
      ...new Set((candidates ?? []).map((c) => archetypeDisplayKey(c.archetype)).filter((id) => !known.has(id))),
    ];
    return [...cols, ...extra.map((id) => ({ id, label: id }))];
  }, [archetypes, candidates]);

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
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
          <h2 className="mt-1 font-serif text-h2 text-ink">{t("title")}</h2>
          <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
        </div>
        <button
          type="button"
          onClick={onNewProfile}
          className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:bg-paper"
        >
          <Plus size={15} /> {t("newProfile")}
        </button>
      </header>

      <div className="mt-4">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
        ) : candidates == null ? (
          <div className="h-32 animate-pulse rounded-lg bg-stone-100" aria-hidden />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-paper px-4 py-10 text-center">
            <Users className="h-7 w-7 text-steel" aria-hidden />
            <p className="mt-2 font-semibold text-ink">{t("emptyTitle")}</p>
            <p className="mt-1 max-w-sm text-sm text-steel">
              {t.rich("emptyBody", { b: (chunks) => <strong>{chunks}</strong> })}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full table-fixed divide-y divide-stone-200">
              <thead className="bg-paper">
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.id}
                      scope="col"
                      className="px-3 py-2.5 text-left text-sm font-semibold uppercase tracking-wide text-steel"
                    >
                      {/* Registry columns carry their own label; the synthetic
                          "unrouted"/extra columns (label === id) localize via the enum. */}
                      {c.label === c.id ? enumLabel("archetype", c.id) : c.label}
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
                          <CandidateCell cand={cand} onEditProfile={onEditProfile} />
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

function CandidateCell({ cand, onEditProfile }: { cand: CandidateRow; onEditProfile: (id: string) => void }) {
  const t = useTranslations("profile.matrix");
  // Route by store: a profile opens the editor (the same ?edit= flow, invoked
  // directly since a same-tab query change wouldn't re-fire the mount effect); an
  // analysis opens its Analyze output at /history/<slug>. A cheap source chip marks
  // which store a cell came from — no per-source column explosion.
  const isProfile = cand.source === "profile";
  const cellClass =
    "focus-ring group block w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-left hover:border-coral/50 hover:bg-coral/5";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-semibold text-ink group-hover:text-coral">{cand.name}</span>
        <ScoreBadge score={cand.score} />
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm capitalize text-steel">
          {cand.role ?? "—"}
          {cand.seniority ? ` · ${cand.seniority}` : ""}
        </p>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide ${
            isProfile ? "bg-coral/10 text-coral" : "bg-stone-100 text-steel"
          }`}
        >
          {isProfile ? t("sourceProfile") : t("sourceAnalysis")}
        </span>
      </div>
    </>
  );
  return isProfile ? (
    <button type="button" onClick={() => cand.id && onEditProfile(cand.id)} className={cellClass} title={t("openProfileTitle", { name: cand.name })}>
      {body}
    </button>
  ) : (
    <Link href={`/history/${cand.slug}`} className={cellClass} title={t("openAnalysisTitle", { name: cand.name })}>
      {body}
    </Link>
  );
}
