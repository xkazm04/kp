"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { useErrorMessage } from "@/app/_lib/use-error-message";

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
  const t = useTranslations("channels");
  // Refusals resolve from the machine `code`, never the server's English `error` —
  // app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [revoking, setRevoking] = useState<string | null>(null);
  // WHY the last revoke failed, already localized — or null when the last one worked.
  // (channels-i18n-honesty made this a boolean, because a failed revoke used to be
  // indistinguishable from a successful one: the row simply stayed put and nothing said
  // why. It is a MESSAGE now because revoke is no longer only "the store said no":
  // /perfect wave 27 gated it on `org:manage` and throttled it per IP, so a recruiter
  // seat and a burst are two distinct, actionable outcomes that a single "Couldn't
  // remove it" sentence would flatten back into a shrug.)
  const [revokeFailed, setRevokeFailed] = useState<string | null>(null);

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
      setRevokeFailed(null);
      try {
        const r = await fetch(`/api/channels/webhooks/${encodeURIComponent(token)}`, { method: "DELETE" });
        if (!r.ok) {
          const p = (await r.json().catch(() => null)) as { code?: string; error?: string } | null;
          setRevokeFailed(errMsg(p, t("add.removeFailed")));
          return;
        }
        reload();
        onChanged?.();
      } catch {
        // The request never completed (offline, aborted): no code, no body — the
        // localized generic is the only honest answer.
        setRevokeFailed(t("add.removeFailed"));
      } finally {
        setRevoking(null);
      }
    },
    [revoking, reload, onChanged, errMsg, t]
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
