"use client";

// The drawer's voice 1st-round-screen panel: provider toggle, create-link,
// delivery-truth note, and the revoke-links affordance. Split out of
// PipelineCandidateDrawer.tsx.

import { Ban, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { TokenLinkPanel, useTokenLink } from "./PipelineTokenLink";

type UseTokenLink = ReturnType<typeof useTokenLink>;

// REC-10 — the truthful delivery claim from a token-link POST response. The
// invite routes now return `delivery` (sent = relayed 2xx · queued = local
// outbox row, nothing will deliver it · failed = dead-lettered/threw); an older
// response shape without it degrades through the legacy boolean, where `true`
// only ever meant "an outbox row was recorded" — shown as queued, never as a
// false green "sent".
function deliveryClaimOf(data: Record<string, unknown>, legacyFlag: "delivered" | "dispatched"): "sent" | "queued" | "failed" {
  const d = data.delivery;
  if (d === "sent" || d === "queued" || d === "failed") return d;
  return data[legacyFlag] ? "queued" : "failed";
}

export function PipelineVoiceScreenPanel({
  entryId,
  voiceProvider,
  onProviderChange,
  voice,
  revokeNote,
  onRevoke,
}: {
  entryId: string;
  voiceProvider: "openai" | "elevenlabs";
  onProviderChange: (p: "openai" | "elevenlabs") => void;
  voice: UseTokenLink;
  revokeNote: string | null;
  onRevoke: () => void;
}) {
  const t = useTranslations("pipeline.drawer");
  return (
    <div className="rounded-md border border-stone-200 bg-white p-3">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
        <Phone size={13} /> {t("voiceScreen")}
      </p>
      <p className="mt-1 text-sm text-steel">{t("voiceScreenHelp")}</p>
      <div className="mt-2 inline-flex rounded-md border border-stone-200 bg-paper p-0.5">
        {(["openai", "elevenlabs"] as const).map((p) => (
          <button
            key={p}
            type="button"
            disabled={voice.busy}
            aria-pressed={voiceProvider === p}
            onClick={() => onProviderChange(p)}
            className={`focus-ring rounded px-2.5 py-1 text-sm font-medium transition-colors ${
              voiceProvider === p ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
            }`}
          >
            {p === "openai" ? "OpenAI" : "ElevenLabs"}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => voice.create({ entryId, provider: voiceProvider })}
        disabled={voice.busy}
        className="focus-ring ml-2 inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
      >
        <Phone size={13} className="text-coral" /> {voice.busy ? t("creating") : t("createLink")}
      </button>

      {voice.err ? <p role="alert" className="mt-2 text-sm text-red-700">{voice.err}</p> : null}

      {voice.data ? (
        <div className="mt-2 space-y-1.5">
          <TokenLinkPanel link={voice} />
          {/* REC-10 — the note reflects the outbox row's REAL status: green
              "sent" only for a relayed send; a queued row (no relay) says so
              honestly and keeps the copy panel as the delivery path. */}
          {Boolean(voice.data.configured) && deliveryClaimOf(voice.data, "delivered") === "sent" ? (
            <p className="text-sm text-moss">{t("inviteSent")}</p>
          ) : null}
          {Boolean(voice.data.configured) && deliveryClaimOf(voice.data, "delivered") === "queued" ? (
            <p className="text-sm text-steel">{t("inviteQueued")}</p>
          ) : null}
          {Boolean(voice.data.configured) && deliveryClaimOf(voice.data, "delivered") === "failed" ? (
            <p className="text-sm text-amber-700">{t("inviteNotSent")}</p>
          ) : null}
          {Number(voice.data.revoked ?? 0) > 0 ? (
            <p className="text-sm text-steel">{t("priorLinksRevoked", { count: Number(voice.data.revoked) })}</p>
          ) : null}
          {!voice.data.configured ? (
            <p className="text-sm text-coral">
              {t("notConfigured", {
                vars: voiceProvider === "openai" ? "OPENAI_API_KEY" : "ELEVENLABS_API_KEY + ELEVENLABS_AGENT_ID",
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* W6-4 — pull every live link for this candidate without minting
          a replacement (wrong candidate, shared too widely, changed mind). */}
      <button
        type="button"
        onClick={onRevoke}
        className="focus-ring mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-steel hover:text-coral"
      >
        <Ban size={12} aria-hidden /> {t("revokeLinks")}
      </button>
      {revokeNote ? <p className="text-sm text-steel">{revokeNote}</p> : null}
    </div>
  );
}
