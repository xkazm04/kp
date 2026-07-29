"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/shell/tabs";
import { ProfileEmptyState } from "./ProfileEmptyStates";
import { ProfileRosterRow } from "./ProfileRosterRow";
import type { RosterProfile, StaleMap } from "./ProfileRosterTypes";
import type { ArchetypeDef } from "@/app/features/shared/profileTypes";

// The roster of SAVED candidate profiles — previously listed nowhere, so a saved
// profile could only be reached by a pipeline deep link. Each row carries the three
// actions a recruiter needs on a profile: Edit (reuses the ?edit= editor flow via
// the parent), Match (deep-links to the Match tab with this profile preselected +
// auto-run), and a confirm-guarded Delete (the unused DELETE /api/profile, now wired).
export function ProfileRoster({
  onEdit,
  onChanged,
  archivedArchetypeIds,
  archetypes,
  onNewProfile,
}: {
  /** Open the editor for this profile id (parent reuses the ?edit= flow). */
  onEdit: (id: string) => void;
  /** Fired after a delete so sibling views (the matrix) can refetch. */
  onChanged?: () => void;
  /** Ids of retired archetypes — a profile routed to one still works but is flagged. */
  archivedArchetypeIds?: readonly string[];
  /** The live archetype registry — read only by the first-run empty state. */
  archetypes?: ArchetypeDef[];
  /** Open the editor in create mode (the empty state's primary action). */
  onNewProfile?: () => void;
}) {
  const t = useTranslations("profile.roster");
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
          // Tier 2 (docs/LOADING_CHOREOGRAPHY.md): first fetch in flight, nothing to
          // show yet — hold the roster's height and stay invisible for 150ms so a
          // fast response never flashes. A later refetch (a delete) never returns
          // here: it prunes `profiles` locally instead of resetting it to null.
          <div className="h-24 reveal-quiet" aria-hidden />
        ) : profiles.length === 0 ? (
          <ProfileEmptyState view="list" archetypes={archetypes ?? []} onNewProfile={onNewProfile} />
        ) : (
          <ul className="animate-arrive-in divide-y divide-stone-100">
            {profiles.map((p) => (
              <ProfileRosterRow
                key={p.id}
                p={p}
                staleInfo={stale[p.id]}
                isArchivedArchetype={Boolean(p.archetype && archivedSet.has(p.archetype))}
                confirming={confirmingId === p.id}
                busy={busyId === p.id}
                onEdit={onEdit}
                onMatch={runMatch}
                onRebuild={rebuild}
                onStartDelete={setConfirmingId}
                onCancelDelete={() => setConfirmingId(null)}
                onConfirmDelete={remove}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
