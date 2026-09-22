"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, KeyRound, RefreshCw } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_PRIMARY, META_LABEL } from "@/app/_components/ui/recipes";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { receiverHealth } from "./receiverHealth";
import { canSavePull, interpretPullResponse, pullPatchBody } from "./receiverPullForm";

// THE PULL HALF of the selected receiver (L0 — docs/concepts/local-first-edge.md §3.1),
// edited where the problem is seen. A receiver is push-only until it has a pull URL;
// with one, the clock also asks the source what arrived while this machine was off.
// The server has projected pullUrl / hasPullSecret / lastPullAt / lastPullError on
// every row of the receivers list for a while; nothing rendered them, and the only
// editor was a curl against PATCH /api/channels/webhooks.
//
// Modelled on ChannelsEdgeCard (endpoint + write-only secret): the bearer is never
// shown, a typed URL is not overwritten by an arriving list, and a failing pull is
// headlined as a localized sentence with the raw machine string shown as CODE-STYLED
// DATA beside it — `HTTP 502` is not a sentence in any of the four languages.
// All form logic lives in receiverPullForm.ts (node:test-able).
export function ReceiverPullCard({
  receiver,
  onSaved,
}: {
  receiver: ChannelWebhookRecord;
  /** Re-read the tab lists after a successful save. */
  onSaved: () => void;
}) {
  const t = useTranslations("channels.pull");
  const errMsg = useErrorMessage();
  const rel = useRelativeTime();
  const [url, setUrl] = useState(receiver.pullUrl ?? "");
  const [secret, setSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const touched = useRef(false);

  // An arriving list (live refresh, a save's reload) updates the field only while the
  // recruiter has not started typing (the Edge/Relay card rule).
  useEffect(() => {
    if (!touched.current) setUrl(receiver.pullUrl ?? "");
  }, [receiver.pullUrl]);

  const health = receiverHealth(receiver);
  const fields = { url, secret, clearSecret };
  const record = { pullUrl: receiver.pullUrl, hasPullSecret: receiver.hasPullSecret };
  const saveable = canSavePull(record, fields, busy);

  const save = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/channels/webhooks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pullPatchBody(receiver.token, { url, secret, clearSecret })),
      });
      const outcome = interpretPullResponse(r.status, await r.json().catch(() => null));
      if (outcome.ok) {
        touched.current = false;
        setSecret("");
        setClearSecret(false);
        setNote({ ok: true, text: t("saved") });
        onSaved();
      } else {
        setNote({ ok: false, text: errMsg(outcome, t("saveFailed")) });
      }
    } catch {
      // Never reached the server: no code to resolve, the localized generic is honest.
      setNote({ ok: false, text: t("saveFailed") });
    } finally {
      setBusy(false);
    }
  }, [receiver.token, url, secret, clearSecret, t, errMsg, onSaved]);

  const idUrl = `pull-url-${receiver.token}`;
  const idSecret = `pull-secret-${receiver.token}`;
  const idClear = `pull-clear-${receiver.token}`;

  return (
    <section aria-label={t("title")} className="rounded-lg border border-stone-200 bg-paper/50 p-4">
      <div className="flex min-h-[2rem] flex-wrap items-center gap-2">
        <span aria-hidden className="inline-grid h-8 w-8 place-items-center rounded-lg border border-stone-200 bg-white text-steel">
          <RefreshCw size={15} />
        </span>
        <h3 className="font-semibold text-ink">{t("title")}</h3>
        {receiver.pullUrl ? (
          <Badge
            tone={health.verdict === "pullFailing" ? "critical" : "positive"}
            icon={health.verdict === "pullFailing" ? AlertTriangle : undefined}
            label={health.verdict === "pullFailing" ? t("statusFailing") : t("statusOn")}
          />
        ) : (
          <Badge tone="neutral" label={t("statusOff")} />
        )}
        {receiver.pullUrl && receiver.hasPullSecret ? <Badge tone="info" icon={KeyRound} label={t("secretSet")} /> : null}
      </div>
      <p className="mt-1.5 max-w-2xl text-sm text-steel">{t("intro")}</p>

      {health.verdict === "pullFailing" ? (
        <p role="status" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="font-semibold">{t("failingTitle")}</span>{" "}
          {health.detail ? <code className="rounded bg-white px-1 text-xs text-ink">{health.detail}</code> : null}
          <span className="mt-1 block text-steel">{t("failingHint")}</span>
        </p>
      ) : null}
      {health.verdict === "reachedNoLeads" ? (
        <p className="mt-3 rounded-md border border-dashed border-amber-300 bg-white px-3 py-2 text-sm text-steel">
          {t("reachedNoLeadsHint")}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor={idUrl} className={`${META_LABEL} block`}>
            {t("urlLabel")}
          </label>
          <TextInput
            id={idUrl}
            value={url}
            onChange={(e) => {
              touched.current = true;
              setUrl(e.target.value);
            }}
            placeholder="https://…"
            sizeVariant="sm"
            className="mt-1 w-full"
          />
        </div>
        <div className="min-w-0 flex-1 basis-52">
          <label htmlFor={idSecret} className={`${META_LABEL} block`}>
            {t("secretLabel")}
          </label>
          <TextInput
            id={idSecret}
            type="password"
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
              if (e.target.value !== "") setClearSecret(false);
            }}
            placeholder={receiver.hasPullSecret ? t("secretKeepPlaceholder") : t("secretPlaceholder")}
            sizeVariant="sm"
            className="mt-1 w-full"
          />
        </div>
        <button type="button" onClick={save} disabled={!saveable} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
          {t("save")}
        </button>
      </div>

      {receiver.hasPullSecret ? (
        <label htmlFor={idClear} className="mt-2 inline-flex items-center gap-2 text-sm text-steel">
          <input
            id={idClear}
            type="checkbox"
            checked={clearSecret}
            disabled={secret !== ""}
            onChange={(e) => setClearSecret(e.target.checked)}
            className="focus-ring h-4 w-4 rounded border-stone-300 accent-coral"
          />
          {t("clearSecret")}
        </label>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-steel">
        <span>
          {receiver.pullUrl
            ? receiver.lastPullAt
              ? t("lastPull", { time: rel(receiver.lastPullAt) })
              : t("neverPulled")
            : t("pushOnly")}
        </span>
        {url.trim() === "" && receiver.pullUrl ? <span className="text-coral">{t("disableWarning")}</span> : null}
        {note ? (
          <span role="status" aria-live="polite" className={`text-sm font-medium ${note.ok ? "text-moss" : "text-coral"}`}>
            {note.text}
          </span>
        ) : null}
      </div>
    </section>
  );
}
