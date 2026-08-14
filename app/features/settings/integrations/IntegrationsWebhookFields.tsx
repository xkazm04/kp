"use client";

// The webhook form's fields (endpoint URL, signing secret, event subscriptions),
// split out of IntegrationsWebhookPanel.tsx so it stays under the 200-line cap.
// Purely presentational: the panel owns the config fetch, the save and the ping.
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import { TextInput } from "@/app/_components/TextInput";
import { Checkbox } from "@/app/_components/Checkbox";

// The wire event ids, paired with the catalog key naming each one. Identifiers,
// not copy — the strings an operator matches against their own system.
const SUBSCRIBABLE = [
  { id: "candidate.hired", key: "candidateHired" },
  { id: "candidate.rejected", key: "candidateRejected" },
  { id: "offer.accepted", key: "offerAccepted" },
  { id: "offer.declined", key: "offerDeclined" },
] as const;

const HIRED_EVENT = "candidate.hired";
const EXAMPLE_WEBHOOK_URL = "https://your-ats.example.com/hooks/kp";

export function IntegrationsWebhookFields({
  url,
  onUrlChange,
  secret,
  onSecretChange,
  hasSecret,
  events,
  onToggleEvent,
}: {
  url: string;
  onUrlChange: (value: string) => void;
  secret: string;
  onSecretChange: (value: string) => void;
  /** Whether a secret is already stored — blank input means "keep it". */
  hasSecret: boolean;
  events: string[];
  onToggleEvent: (id: string) => void;
}) {
  const t = useTranslations("integrations.webhook");
  return (
    <div className="mt-4 space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">{t("webhookUrl")}</span>
        <TextInput
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder={EXAMPLE_WEBHOOK_URL}
          sizeVariant="sm"
          className="font-mono"
        />
        <span className="mt-1 block text-meta text-steel">{t("leaveEmpty")}</span>
      </label>

      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <KeyRound size={13} className="text-steel" aria-hidden /> {t("signingSecret")}
          <span className="font-normal text-meta text-steel">{hasSecret ? t("secretSet") : t("secretNotSet")}</span>
        </span>
        <TextInput
          type="password"
          value={secret}
          onChange={(e) => onSecretChange(e.target.value)}
          placeholder={hasSecret ? t("secretPlaceholderSet") : t("secretPlaceholderNew")}
          autoComplete="new-password"
          sizeVariant="sm"
          className="font-mono"
        />
      </label>

      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-ink">{t("events")}</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {SUBSCRIBABLE.map((e) => (
            <label key={e.id} className="flex items-center gap-2 text-sm text-steel">
              <Checkbox checked={events.includes(e.id)} onChange={() => onToggleEvent(e.id)} />
              {t(`event.${e.key}`)}
            </label>
          ))}
        </div>
        <p className="mt-1 text-meta text-steel">
          {t.rich("eventsNote", {
            event: HIRED_EVENT,
            code: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
          })}
        </p>
      </fieldset>
    </div>
  );
}
