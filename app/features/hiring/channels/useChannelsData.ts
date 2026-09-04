"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import { sharedGetJson } from "@/app/features/shared/sharedGet";
import { DEFAULT_STAGE_AXIS, stageWithRole, type StageDef } from "@/app/_lib/pipeline-stages";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import type { PipelineEntryView } from "@/app/_lib/db/pipeline";

export type ChannelJob = { id: string; title: string };

/** The list a SETTLED, successful response carries — or `"failed"`.
 *
 *  Never an empty array conjured out of an error. An empty list is a CLAIM on this
 *  surface ("this channel has no receivers", "nothing is published"), and only a 2xx
 *  body that actually carries the array is allowed to make it: every one of these
 *  routes answers `{ webhooks }` / `{ jobs, stats }` / `{ entries, stages }` on success
 *  and `{ error }` on failure, so a missing/non-array key IS the failure — and
 *  `p.jobs ?? []` used to turn it into a confident zero the recruiter could not tell
 *  apart from a genuinely empty workspace. */
export function listFromPayload<T>(payload: unknown, key: string): T[] | "failed" {
  const list = (payload as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(list) ? (list as T[]) : "failed";
}

/** How many candidates are WAITING at the board's entry column.
 *
 *  Resolved by stage ROLE, never by the name "Accepted": the axis is per-workspace
 *  data (pipeline-axis.ts) and a team that composes its own board in Settings → Hiring
 *  gets an entry column with its own minted id. Real intake already files arrivals
 *  through `stageWithRole("entry", …)` (cv-intake.ts, "not at a stage that happens to
 *  be named Accepted"), so matching the literal string here answered "0 waiting" on
 *  exactly the boards that renamed their first column — while the applications piled
 *  up in it. Falls back to the shipped axis when the payload carries no stages. */
export function countWaitingAtEntry(
  entries: readonly PipelineEntryView[],
  stages: readonly StageDef[] | undefined
): number {
  const axis = stages && stages.length > 0 ? stages : DEFAULT_STAGE_AXIS;
  const entryStage = stageWithRole("entry", axis) ?? "Accepted";
  return entries.filter((e) => e.stage === entryStage && e.status === "active").length;
}

type ChannelSource = "webhooks" | "jobs" | "pipeline";

// Shared inbound-integration data for the Channels variants: the active webhooks
// (per-channel status), the OPEN jobs (careers links + webhook binding), and the
// count of candidates waiting at the board's entry column. Follows the shared
// data-changed channel so sim/automation arrivals refresh without a remount.
//
// The three fields start `null` (not `[]`/`0`) so the tab can tell "haven't fetched
// yet" apart from "genuinely empty" (docs/design/loading-choreography.md, tier 2) — a
// re-fetch from useLiveRefresh only ever REPLACES a settled value, never resets it
// back to null, so populated regions never blank on refresh.
//
// A FAILED load is the fourth state that contract needs and used to lose: every branch
// below ended in `?? []` / `?? 0`, so a 500 (or a 401 after the session lapsed, which
// still parses as JSON and never reached the `.catch`) settled the tab on a confident
// empty — "Off", "Nothing published", "Receivers 0", and a first-run brief telling a
// recruiter with live receivers how to set one up. Failure now keeps the last known
// value (or `null`) and raises `loadFailed`, which the tab renders as a retryable
// error affordance — the fourth branch loading-choreography.md asks for.
export function useChannelData() {
  const [webhooks, setWebhooks] = useState<ChannelWebhookRecord[] | null>(null);
  const [jobs, setJobs] = useState<ChannelJob[] | null>(null);
  const [accepted, setAccepted] = useState<number | null>(null);
  // Per SOURCE, so a recovered fetch clears only its own failure — and so nothing has
  // to reset a flag synchronously in the mount effect (react-hooks/set-state-in-effect).
  const [failed, setFailed] = useState<Record<ChannelSource, boolean>>({
    webhooks: false,
    jobs: false,
    pipeline: false,
  });

  // Sharing is OPT-IN (see usePipelineBoardData): `load` doubles as the post-mutation
  // reload (a new receiver, a revoke), which must always hit the network.
  const load = useCallback((opts?: { shared?: boolean; signal?: AbortSignal }) => {
    const shared = { refresh: !opts?.shared };
    const signal = opts?.signal;
    // An abort is the tab unmounting, not a failed source. Marking it failed would
    // paint the retry banner onto a surface that is already leaving — and, worse,
    // settle state on a component React has torn down.
    const mark = (src: ChannelSource, isFailed: boolean) => {
      if (signal?.aborted) return;
      setFailed((f) => (f[src] === isFailed ? f : { ...f, [src]: isFailed }));
    };
    fetch("/api/channels/webhooks", { signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        const list = listFromPayload<ChannelWebhookRecord>(p, "webhooks");
        mark("webhooks", list === "failed");
        if (list !== "failed" && !signal?.aborted) setWebhooks(list);
      })
      .catch(() => mark("webhooks", true));
    // openOnly — the roles a candidate can actually apply to right now (NULL/'published';
    // job-ingest.ts isJobOpenForApplications). The unfiltered read also returned drafts
    // and CLOSED roles, and this list is rendered as "Published roles" + a copyable
    // "apply link": /apply/[id] 404s a draft and answers "this role is closed" for a
    // retired one, so the careers pane was handing recruiters dead links to paste into
    // job posts (and the Add-receiver modal offered binding an inbox to them).
    fetch("/api/jobs?limit=200&openOnly=1", { signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        const list = listFromPayload<ChannelJob>(p, "jobs");
        mark("jobs", list === "failed");
        if (list !== "failed" && !signal?.aborted) setJobs(list.map((j) => ({ id: j.id, title: j.title })));
      })
      .catch(() => mark("jobs", true));
    // sharedGetJson already rejects a non-2xx, so only the body shape is checked here.
    // It deliberately takes NO signal: the request may be shared with another hook on
    // the page, and aborting it on OUR unmount would cancel theirs. Unmounting drops
    // the result instead.
    sharedGetJson<{ entries?: PipelineEntryView[]; stages?: StageDef[] }>("/api/pipeline", shared)
      .then((p) => {
        const entries = listFromPayload<PipelineEntryView>(p, "entries");
        mark("pipeline", entries === "failed");
        if (entries !== "failed" && !signal?.aborted) setAccepted(countWaitingAtEntry(entries, p.stages));
      })
      .catch(() => mark("pipeline", true));
  }, []);
  // The two own fetches are aborted on unmount: switching tabs while /api/jobs (201 KB)
  // is in flight used to leave it running to completion and then settle state on a
  // component that no longer exists.
  useEffect(() => {
    const ac = new AbortController();
    load({ shared: true, signal: ac.signal }); // mount read may ride a sibling's request
    return () => ac.abort();
  }, [load]);
  useLiveRefresh(load);

  return {
    webhooks,
    jobs,
    accepted,
    loadFailed: failed.webhooks || failed.jobs || failed.pipeline,
    reload: load,
  };
}

/** Outcome of the inbound simulator. channels-i18n-honesty: this used to return a
 *  ready-made ENGLISH sentence, which is why the Channels tab could never speak the
 *  recruiter's language here. It now returns DATA and the component renders it through
 *  next-intl.
 *
 *  The refusal carries the machine `code` and the HTTP `status` — never the server's
 *  `error` prose, which the tab rendered verbatim (English, in every locale) three
 *  lines under a comment claiming this surface no longer does that. The code resolves
 *  through `useErrorMessage()`; the status is only there so an uncoded failure can say
 *  which one it was. */
export type InboundSimResult =
  | { ok: true; label: string; score: number; jobTitle: string }
  | { ok: false; reason: "noJob" }
  | { ok: false; reason: "failed"; code: string | null; status: number | null };

// Shared inbound simulator (the "receive a test application" action). The route files
// the applicant into the sim/demo workspace under a `(SIM)`-marked title
// (comms-tenancy-pair), so `jobTitle` is the marked role it actually landed on, not
// the real board for this role.
export async function simulateInbound(jobId: string | undefined): Promise<InboundSimResult> {
  if (!jobId) return { ok: false, reason: "noJob" };
  try {
    const r = await fetch("/api/sim/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
    const p = (await r.json().catch(() => null)) as
      | { label?: unknown; score?: unknown; jobTitle?: unknown; error?: unknown; code?: unknown }
      | null;
    if (!r.ok) return { ok: false, reason: "failed", code: typeof p?.code === "string" ? p.code : null, status: r.status };
    return {
      ok: true,
      label: String(p?.label ?? ""),
      score: Number(p?.score ?? 0),
      jobTitle: String(p?.jobTitle ?? ""),
    };
  } catch {
    // The request never completed — there is no code and no status to report, so the
    // caller's own localized "couldn't run the simulation" is the honest answer. The
    // thrown Error's message was English network prose rendered straight into the tab.
    return { ok: false, reason: "failed", code: null, status: null };
  }
}
