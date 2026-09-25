"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, Radar } from "lucide-react";
import { Tooltip } from "@/app/_components/Tooltip";
import { BTN_PRIMARY, NOTICE } from "@/app/_components/ui/recipes";
import type { JobseekerProfile, JobseekerSource } from "@/app/_lib/jobseeker/types";
import { FailureNotice } from "./FailureNotice";
import { euresCountries } from "./feedModel";
import { callJson, type ApiFailure, type SourcesPayload } from "./sourcesApi";
import type { ScanTaskState } from "./useScanTask";

// "One click to first results" — the door out of the `no_sources` empty state.
//
// A seeker who has just imported a CV is three pages from a scored feed: pick a source,
// switch it on, run a scan. EURES is the one source that needs none of that deliberation
// — tier A, the European Labour Authority's own vacancy API, rights-clean with an
// attribution line and NO acknowledgement (sources-catalog.json) — so one button can
// legitimately do the whole chain.
//
// IDEMPOTENT by construction: the sources list is read FIRST and an existing EURES row
// is enabled rather than duplicated (POST /api/jobseeker/sources creates a row every
// time it is called; there is no upsert). Already enabled = straight to the scan.
//
// THE PARENT IS TOLD LAST. `onEnabled()` flips the feed's chain, and the feed unmounts
// this empty state with it — so calling it before the scan settles takes this button's
// own progress line, its `startError` and its Retry off the screen mid-run, and the
// EURES-specific Retry can never be reached. It is therefore fired when the scan TASK
// reaches a terminal state (not merely when `scan.start()` resolves — that only means
// the POST returned a task id, with the whole scan still ahead), and never at all when
// the start itself failed: then the notice and its Retry are the only thing left to act
// on. The source stays enabled on the server either way, and the chain is idempotent,
// so a Retry re-runs it safely.
//
// TRUTHFUL COPY: the EURES search takes location codes from the seeker's OWN
// preferences (adapters/eures.ts: `ctx.preferences.countries`), and an empty list is a
// query for nothing. When no country is set the button says which one it will search
// and WRITES it, so the sentence on the button is what the scan actually does; the link
// beside it goes to the preferences that own the choice.

const EURES_CATALOG_ID = "eures";
const EURES_ADAPTER = "eures";

export function EnableEuresButton({
  countries,
  scan,
  onEnabled,
  onProfileSaved,
}: {
  /** `preferences.countries` as the server read them (may be empty). */
  countries: string[];
  scan: ScanTaskState & { start(): Promise<void> };
  /** The chain just gained an enabled source: the caller re-reads the feed. */
  onEnabled(): void;
  /** The countries this door wrote onto the profile, so the caller's copy of the
   *  preferences is the one the server holds (a later direct edit replaces lists). */
  onProfileSaved?(profile: JobseekerProfile): void;
}) {
  const t = useTranslations("me.jobs.empty.no_sources");
  const tScan = useTranslations("me.jobs.scan");
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  // This button started a scan, and the parent has not been told yet.
  const startedRef = useRef(false);
  const notifiedRef = useRef(false);
  // Kept current in an effect, not during render: the watcher below must call the
  // latest callback without re-arming on every render.
  const onEnabledRef = useRef(onEnabled);
  useEffect(() => {
    onEnabledRef.current = onEnabled;
  });

  const wanted = euresCountries(countries);
  const defaulted = countries.filter((c) => c.trim()).length === 0;
  const label = wanted.map((c) => c.toUpperCase()).join(", ");
  const busy = working || scan.starting || scan.active;
  const progress = scan.progressTotal > 0 ? tScan("progress", { done: scan.progressDone, total: scan.progressTotal }) : scan.progressMsg;

  const enable = async () => {
    // The busy-state contract: one submit at a time, and the scan's own window counts.
    if (busy) return;
    setWorking(true);
    setFailure(null);
    try {
      const list = await callJson<SourcesPayload>("/api/jobseeker/sources");
      if (!list.ok) {
        setFailure(list.fail);
        return;
      }
      let source: JobseekerSource | null = list.body.sources.find((s) => s.adapter === EURES_ADAPTER) ?? null;
      if (!source) {
        const created = await callJson<{ source: JobseekerSource }>("/api/jobseeker/sources", { method: "POST", body: JSON.stringify({ catalogId: EURES_CATALOG_ID }) });
        if (!created.ok) {
          setFailure(created.fail);
          return;
        }
        source = created.body.source;
      }
      if (defaulted) {
        // Written BEFORE the scan, so the first run searches the country the button named.
        const saved = await callJson<JobseekerProfile>("/api/jobseeker/profile", { method: "PUT", body: JSON.stringify({ preferences: { countries: wanted } }) });
        if (!saved.ok) {
          setFailure(saved.fail);
          return;
        }
        onProfileSaved?.(saved.body);
      }
      // A PAUSED EURES is enabled but not scanned: the door resumes it, or the scan
      // below finds no source and the same empty state comes straight back.
      if (!source.enabled || source.pausedReason) {
        const body = source.pausedReason ? { resume: true } : { enabled: true };
        const patched = await callJson<{ source: JobseekerSource }>(`/api/jobseeker/sources/${encodeURIComponent(source.id)}`, { method: "PATCH", body: JSON.stringify(body) });
        if (!patched.ok) {
          setFailure(patched.fail);
          return;
        }
      }
      startedRef.current = true;
      await scan.start();
    } finally {
      setWorking(false);
    }
  };

  // The scan settled: the lines this button owns have said everything they can, so the
  // chain is reported and the empty state may go. `scan.status` is null while no task
  // id exists — which is exactly the "the POST was refused" case, where `startError`
  // and its Retry stay on screen instead.
  useEffect(() => {
    if (!startedRef.current || notifiedRef.current) return;
    if (!scan.status || scan.starting || scan.active) return;
    notifiedRef.current = true;
    onEnabledRef.current();
  }, [scan.status, scan.starting, scan.active]);

  return (
    <div className="space-y-2">
      {/* THE EXPLANATION RIDES ON THE CONTROL (surface-doctrine §1). The two-clause
          paragraph under this button — what EURES is, that it is rights-clean, which
          countries the first scan will read — was the longest sentence on an empty
          state whose whole job is to name ONE next step. It is the button's tooltip
          now: reachable on hover AND on focus, costing no layout. Only the link out to
          the preferences that own the country choice stays in the flow, because a
          destination cannot live inside a label surface. */}
      <Tooltip label={defaulted ? t("euresDefault", { countries: label }) : t("euresNote", { countries: label })} side="bottom">
        <button type="button" className={`${BTN_PRIMARY} h-10 gap-2 px-4`} disabled={busy} aria-busy={busy || undefined} onClick={() => void enable()}>
          {busy ? <Loader2 size={15} aria-hidden className="animate-spin" /> : <Radar size={15} aria-hidden />}
          {scan.starting || scan.active ? tScan("running") : t("euresCta", { countries: label })}
        </button>
      </Tooltip>
      <p className="text-sm text-steel">
        <Link href="/me#s-want" className="focus-ring rounded underline">
          {t("euresPrefs")}
        </Link>
      </p>
      {busy && progress ? (
        <p className={`${NOTICE("info")} px-3 py-1.5 text-sm`} role="status">
          {progress}
        </p>
      ) : null}
      {scan.unreachable ? (
        <p className={`${NOTICE("amber")} px-3 py-1.5 text-sm`} role="status">
          {tScan("unreachable")}
        </p>
      ) : null}
      {scan.startError ? <FailureNotice failure={scan.startError} fallback={tScan("startError")} onRetry={() => void scan.start()} retrying={busy} /> : null}
      {failure ? <FailureNotice failure={failure} fallback={t("euresError")} onRetry={() => void enable()} retrying={busy} /> : null}
    </div>
  );
}
