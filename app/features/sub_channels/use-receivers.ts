"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChannelWebhookRecord } from "@/app/_lib/db";

export type ReceiverJob = { id: string; title: string };

// Shared receiver data for a webhook-backed channel (email intake, ad forms):
// the channel's receivers + the published jobs (to bind a new one) + revoke.
// Creation lives in the Add modal, which calls reload()/onChanged on success.
export function useReceivers(channel: string, onChanged?: () => void) {
  const [receivers, setReceivers] = useState<ChannelWebhookRecord[] | null>(null);
  const [jobs, setJobs] = useState<ReceiverJob[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  // Did the last revoke FAIL? (channels-i18n-honesty) This used to be an `error` string
  // holding a hardcoded English sentence that no pane ever read — so a failed revoke was
  // indistinguishable from a successful one: the row simply stayed put and nothing said
  // why. The hook reports the fact; the pane renders the localized message.
  const [revokeFailed, setRevokeFailed] = useState(false);

  const load = useCallback(() => {
    fetch("/api/channels/webhooks")
      .then((r) => r.json())
      .then((p) => setReceivers(((p.webhooks as ChannelWebhookRecord[]) ?? []).filter((w) => w.channel === channel)))
      .catch(() => setReceivers([]));
  }, [channel]);

  useEffect(() => {
    load();
    fetch("/api/jobs?limit=200")
      .then((r) => r.json())
      .then((p) => setJobs(((p.jobs ?? []) as ReceiverJob[]).map((j) => ({ id: j.id, title: j.title }))))
      .catch(() => setJobs([]));
  }, [load]);

  const revoke = useCallback(
    async (token: string) => {
      if (revoking) return;
      setRevoking(token);
      setRevokeFailed(false);
      try {
        const r = await fetch(`/api/channels/webhooks/${encodeURIComponent(token)}`, { method: "DELETE" });
        if (!r.ok) throw new Error();
        load();
        onChanged?.();
      } catch {
        setRevokeFailed(true);
      } finally {
        setRevoking(null);
      }
    },
    [revoking, load, onChanged]
  );

  return { receivers, jobs, load, revoke, revoking, revokeFailed };
}

/** A receiver is "live" once it has taken any AUTHENTICATED inbound POST — the one
 *  liveness definition on this surface (see db/channels.ts recordChannelWebhookReceipt).
 *  Proven connectivity, NOT proven leads: a source that reaches the endpoint and then
 *  fails field mapping is live-but-broken, which is exactly the state the recruiter
 *  needs to be able to see. The lead count is `acceptedCount`. */
export function isReceiverLive(h: ChannelWebhookRecord): boolean {
  return h.receivedCount > 0 || Boolean(h.firstReceivedAt);
}
