"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, RefreshCw, Trash2, Users, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Meter } from "@/app/_components/Meter";
import { scoreTone } from "@/app/_lib/format";
import { archetypeDisplayKey } from "@/app/_lib/archetypes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { buildUrl } from "@/app/features/tabs";

// A saved v2 intake profile, as GET /api/profile lists it (ProfileRow, denormalized
// columns off the profiles table).
type RosterProfile = {
  id: string;
  label: string;
  archetype: string | null;
  role_family: string | null;
  completeness: number | null;
};

// profile id → the newer same-CV analysis that makes it stale (GET /api/profile
// `stale`). Present ONLY for profiles with source lineage AND a newer analysis;
// a hand-built profile never appears here (no badge, no chrome).
type StaleMap = Record<string, { newerSlug: string; newerAnalyzedAt: string }>;

// The roster of SAVED candidate profiles — previously listed nowhere, so a saved
// profile could only be reached by a pipeline deep link. Each row carries the three
// actions a recruiter needs on a profile: Edit (reuses the ?edit= editor flow via
// the parent), Match (deep-links to the Match tab with this profile preselected +
// auto-run), and a confirm-guarded Delete (the unused DELETE /api/profile, now wired).
export function ProfileRoster({
  onEdit,
  onChanged,
  archivedArchetypeIds,
}: {
  /** Open the editor for this profile id (parent reuses the ?edit= flow). */
  onEdit: (id: string) => void;
  /** Fired after a delete so sibling views (the matrix) can refetch. */
  onChanged?: () => void;
  /** Ids of retired archetypes — a profile routed to one still works but is flagged. */
  archivedArchetypeIds?: readonly string[];
}) {
  const t = useTranslations("profile.roster");
  const enumLabel = useEnumLabel();
  const router = useRouter();
  const [profiles, setProfiles] = useState<RosterProfile[] | null>(null);
  const [stale, setStale] = useState<StaleMap>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const archivedSet = new Set(archivedArchetypeIds ?? []);

  const load = useCallback(() => {
    let alive = true;
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => {
        if (!alive) return;
        if (p.error) setError(p.error);
        else {
          setProfiles((p.profiles as RosterProfile[]) ?? []);
          setStale((p.stale as StaleMap) ?? {});
        }
      })
      .catch(() => {
        if (alive) setError(t("loadFailed"));
      });
    return () => {
      alive = false;
    };
  }, [t]);

  useEffect(() => load(), [load]);

  const runMatch = (id: string) => router.push(buildUrl({ tab: "match", profile: id }, ""));

  // Rebuild-from-latest: open the editor prefilled from the NEWER same-CV analysis,
  // re-pointing THIS profile (rebuild=<id> ⇒ an in-place update, not a duplicate).
  // The recruiter reviews and saves; the saved profile carries the new lineage and
  // its staleness clears.
  const rebuild = (id: string, newerSlug: string) =>
    router.push(buildUrl({ tab: "profile", fromAnalysis: newerSlug, rebuild: id }, ""));

  const remove = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/profile?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) {
        const payload = await r.json().catch(() => null);
        throw new Error((payload as { error?: string } | null)?.error ?? t("deleteFailed"));
      }
      setConfirmingId(null);
      // Optimistic local prune, then tell the matrix to refetch.
      setProfiles((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("deleteFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-h2 text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
      </header>

      <div className="mt-4">
        {error ? (
          <p role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-base text-red-700">
            {error}
          </p>
        ) : null}
        {profiles == null ? (
          <div className="h-24 animate-pulse rounded-lg bg-stone-100" aria-hidden />
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-paper px-4 py-8 text-center">
            <Users className="h-7 w-7 text-steel" aria-hidden />
            <p className="mt-2 font-semibold text-ink">{t("emptyTitle")}</p>
            <p className="mt-1 max-w-sm text-sm text-steel">{t("emptyBody")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {profiles.map((p) => {
              const pct = Math.round((p.completeness ?? 0) * 100);
              const staleInfo = stale[p.id];
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-ink">{p.label}</span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-steel">
                        {enumLabel("archetype", archetypeDisplayKey(p.archetype))}
                      </span>
                      {p.archetype && archivedSet.has(p.archetype) ? (
                        <span
                          className="rounded-full bg-stone-200 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-steel"
                          title={t("retiredArchetypeTitle")}
                        >
                          {t("retiredArchetype")}
                        </span>
                      ) : null}
                      {p.role_family ? (
                        <span className="text-sm text-steel">{enumLabel("family", p.role_family)}</span>
                      ) : null}
                      {staleInfo ? (
                        // Neutral (amber, mapped in both themes) staleness flag: a newer
                        // CV analysis exists than the one this profile was built from.
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-amber-800"
                          title={t("staleTitle", { date: new Date(staleInfo.newerAnalyzedAt).toLocaleDateString() })}
                        >
                          <RefreshCw size={11} aria-hidden /> {t("staleBadge")}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Meter value={pct} tone={scoreTone(pct)} className="h-1.5 w-32" aria-label={t("completenessAria", { pct })} />
                      <span className="text-sm text-steel">{t("completenessPct", { pct })}</span>
                    </div>
                  </div>

                  {confirmingId === p.id ? (
                    <span className="animate-fade-in inline-flex items-center gap-1.5" role="group" aria-label={t("deleteGroupAria", { name: p.label })}>
                      <span className="text-sm font-semibold text-red-700">{t("deletePrompt")}</span>
                      <button
                        type="button"
                        onClick={() => remove(p.id)}
                        disabled={busyId === p.id}
                        className="focus-ring rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        {busyId === p.id ? t("deleting") : t("deleteConfirm")}
                      </button>
                      <button
                        type="button"
                        autoFocus
                        onClick={() => setConfirmingId(null)}
                        className="focus-ring rounded-md px-2.5 py-1 text-sm font-semibold text-steel hover:bg-stone-100"
                      >
                        {t("cancel")}
                      </button>
                    </span>
                  ) : (
                    <div className="flex items-center gap-1">
                      {staleInfo ? (
                        <button
                          type="button"
                          onClick={() => rebuild(p.id, staleInfo.newerSlug)}
                          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                          title={t("rebuildTitle", { name: p.label })}
                        >
                          <RefreshCw size={14} /> {t("rebuild")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => runMatch(p.id)}
                        className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-ink hover:border-coral/40 hover:text-coral"
                        title={t("matchTitle", { name: p.label })}
                      >
                        <Zap size={14} /> {t("match")}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(p.id)}
                        className="focus-ring rounded-md p-1.5 text-steel hover:bg-stone-100 hover:text-ink"
                        title={t("editTitle", { name: p.label })}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(p.id)}
                        className="focus-ring rounded-md p-1.5 text-steel hover:bg-red-50 hover:text-red-700"
                        title={t("deleteTitle", { name: p.label })}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
