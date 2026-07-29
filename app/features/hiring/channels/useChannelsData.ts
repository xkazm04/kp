"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import type { ChannelWebhookRecord, PipelineEntryView } from "@/app/_lib/db";

export type ChannelJob = { id: string; title: string };

// Shared inbound-integration data for the Channels variants: the active webhooks
// (per-channel status), the published jobs (careers links + webhook binding), and
// the count of candidates waiting at Accepted. Follows the shared data-changed
// channel so sim/automation arrivals refresh without a remount.
//
// The three fields start `null` (not `[]`/`0`) so the tab can tell "haven't fetched
// yet" apart from "genuinely empty" (docs/LOADING_CHOREOGRAPHY.md, tier 2) — a
// re-fetch from useLiveRefresh only ever REPLACES a settled value, never resets it
// back to null, so populated regions never blank on refresh.
export function useChannelData() {
  const [webhooks, setWebhooks] = useState<ChannelWebhookRecord[] | null>(null);
  const [jobs, setJobs] = useState<ChannelJob[] | null>(null);
  const [accepted, setAccepted] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch("/api/channels/webhooks")
      .then((r) => r.json())
      .then((p) => setWebhooks((p.webhooks as ChannelWebhookRecord[]) ?? []))
      .catch(() => setWebhooks((w) => w ?? []));
    fetch("/api/jobs?limit=200")
      .then((r) => r.json())
      .then((p) => setJobs(((p.jobs ?? []) as ChannelJob[]).map((j) => ({ id: j.id, title: j.title }))))
      .catch(() => setJobs((j) => j ?? []));
    fetch("/api/pipeline")
      .then((r) => r.json())
      .then((p) => {
        const entries = (p.entries as PipelineEntryView[]) ?? [];
        setAccepted(entries.filter((e) => e.stage === "Accepted" && e.status === "active").length);
      })
      .catch(() => setAccepted((a) => a ?? 0));
  }, []);
  useEffect(() => load(), [load]);
  useLiveRefresh(load);

  return { webhooks, jobs, accepted, reload: load };
}

/** Outcome of the inbound simulator. channels-i18n-honesty: this used to return a
 *  ready-made ENGLISH sentence, which is why the Channels tab could never speak the
 *  recruiter's language here. It now returns DATA and the component renders it through
 *  next-intl. A server-side `message` (an honest, specific refusal like "No available
 *  applicant.") is passed through rather than flattened into a generic failure. */
export type InboundSimResult =
  | { ok: true; label: string; score: number; jobTitle: string }
  | { ok: false; reason: "noJob" }
  | { ok: false; reason: "failed"; message: string | null };

// Shared inbound simulator (the "receive a test application" action). The route files
// the applicant into the sim/demo workspace under a `(SIM)`-marked title
// (comms-tenancy-pair), so `jobTitle` is the marked role it actually landed on, not
// the real board for this role.
export async function simulateInbound(jobId: string | undefined): Promise<InboundSimResult> {
  if (!jobId) return { ok: false, reason: "noJob" };
  try {
    const r = await fetch("/api/sim/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
    const p = (await r.json().catch(() => null)) as
      | { label?: unknown; score?: unknown; jobTitle?: unknown; error?: unknown }
      | null;
    if (!r.ok) return { ok: false, reason: "failed", message: typeof p?.error === "string" ? p.error : null };
    return {
      ok: true,
      label: String(p?.label ?? ""),
      score: Number(p?.score ?? 0),
      jobTitle: String(p?.jobTitle ?? ""),
    };
  } catch (e) {
    return { ok: false, reason: "failed", message: e instanceof Error ? e.message : null };
  }
}
