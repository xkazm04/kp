"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/app/features/live-refresh";
import type { ChannelWebhookRecord, PipelineEntryView } from "@/app/_lib/db";

export type ChannelJob = { id: string; title: string };

// Shared inbound-integration data for the Channels variants: the active webhooks
// (per-channel status), the published jobs (careers links + webhook binding), and
// the count of candidates waiting at Accepted. Follows the shared data-changed
// channel so sim/automation arrivals refresh without a remount.
export function useChannelData() {
  const [webhooks, setWebhooks] = useState<ChannelWebhookRecord[]>([]);
  const [jobs, setJobs] = useState<ChannelJob[]>([]);
  const [accepted, setAccepted] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch("/api/channels/webhooks")
      .then((r) => r.json())
      .then((p) => setWebhooks((p.webhooks as ChannelWebhookRecord[]) ?? []))
      .catch(() => undefined);
    fetch("/api/jobs?limit=200")
      .then((r) => r.json())
      .then((p) => setJobs(((p.jobs ?? []) as ChannelJob[]).map((j) => ({ id: j.id, title: j.title }))))
      .catch(() => undefined);
    fetch("/api/pipeline")
      .then((r) => r.json())
      .then((p) => {
        const entries = (p.entries as PipelineEntryView[]) ?? [];
        setAccepted(entries.filter((e) => e.stage === "Accepted" && e.status === "active").length);
      })
      .catch(() => setAccepted(0));
  }, []);
  useEffect(() => load(), [load]);
  useLiveRefresh(load);

  return { webhooks, jobs, accepted, reload: load };
}

// Shared inbound simulator (the "receive a test application" action). Returns a
// note the caller renders; refreshes channel data on success.
export async function simulateInbound(jobId: string | undefined): Promise<{ text: string; ok: boolean }> {
  if (!jobId) return { text: "Create a job first — inbound applications need a role to land on.", ok: false };
  try {
    const r = await fetch("/api/sim/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
    const p = await r.json();
    if (!r.ok) throw new Error(p.error ?? "Couldn't receive a test application.");
    return { text: `Received ${p.label} — matched at ${p.score}. Now in the pipeline at Accepted.`, ok: true };
  } catch (e) {
    return { text: e instanceof Error ? e.message : "Couldn't receive a test application.", ok: false };
  }
}
