"use client";

import { useCallback, useMemo, useState } from "react";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";

export type ReceiverJob = { id: string; title: string };

// Per-channel receiver state for the email-intake and ad-forms panes: the
// channel's slice of the receivers list, plus revoke. Creation lives in the Add
// modal, which calls reload()/onChanged on success.
//
// It does NOT fetch. It used to: on mount it re-requested `/api/channels/webhooks`
// and `/api/jobs?limit=200` — both of which the TAB (useChannelData) had already
// loaded before it could render the pane that mounts this hook. That was ~202 KB
// re-downloaded on every switch to Email intake or Ad forms (the jobs list alone
// is 201 KB), and worse, it created a second source of truth for the same two
// lists: a revoke refreshed one copy and left the other's counts stale until
// something else happened to reload it. The tab now owns both lists and hands
// them down; this hook owns only what is genuinely per-pane.
export function useReceivers({
  channel,
  webhooks,
  reload,
  onChanged,
}: {
  channel: string;
  /** Every channel's receivers, or null while the tab's first fetch is in flight. */
  webhooks: ChannelWebhookRecord[] | null;
  /** Re-read the tab-level lists (after a revoke/create). */
  reload: () => void;
  onChanged?: () => void;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);
  // Did the last revoke FAIL? (channels-i18n-honesty) This used to be an `error` string
  // holding a hardcoded English sentence that no pane ever read — so a failed revoke was
  // indistinguishable from a successful one: the row simply stayed put and nothing said
  // why. The hook reports the fact; the pane renders the localized message.
  const [revokeFailed, setRevokeFailed] = useState(false);

  // null (not []) while the tab's fetch is in flight, so the panes keep telling
  // "haven't loaded yet" apart from "genuinely no receivers" — the same contract
  // the local fetch used to provide.
  const receivers = useMemo(
    () => (webhooks === null ? null : webhooks.filter((w) => w.channel === channel)),
    [webhooks, channel]
  );

  const revoke = useCallback(
    async (token: string) => {
      if (revoking) return;
      setRevoking(token);
      setRevokeFailed(false);
      try {
        const r = await fetch(`/api/channels/webhooks/${encodeURIComponent(token)}`, { method: "DELETE" });
        if (!r.ok) throw new Error();
        reload();
        onChanged?.();
      } catch {
        setRevokeFailed(true);
      } finally {
        setRevoking(null);
      }
    },
    [revoking, reload, onChanged]
  );

  return { receivers, load: reload, revoke, revoking, revokeFailed };
}

/** A receiver is "live" once it has taken any AUTHENTICATED inbound POST — the one
 *  liveness definition on this surface (see db/channels.ts recordChannelWebhookReceipt).
 *  Proven connectivity, NOT proven leads: a source that reaches the endpoint and then
 *  fails field mapping is live-but-broken, which is exactly the state the recruiter
 *  needs to be able to see. The lead count is `acceptedCount`. */
export function isReceiverLive(h: ChannelWebhookRecord): boolean {
  return h.receivedCount > 0 || Boolean(h.firstReceivedAt);
}
