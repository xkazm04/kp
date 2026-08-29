"use client";

// The webhook form's fields (endpoint URL, signing secret, event subscriptions),
// split out of IntegrationsWebhookPanel.tsx so it stays under the 200-line cap.
// Purely presentational: the panel owns the config fetch, the save and the ping.
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import { TextInput } from "@/app/_components/TextInput";
import { Checkbox } from "@/app/_components/Checkbox";
// Machine identifiers, not copy — and each one pinned to its authority. See
// integrationsWebhookIdentifiers.ts for which are imported and which are
// set-equality asserted by integrationsCatalog.test.ts.
import { EXAMPLE_WEBHOOK_URL, HIRED_EVENT, SUBSCRIBABLE_EVENT_ROWS } from "./integrationsWebhookIdentifiers";

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
        {/* Mobile-first, like the other two grids on this tab (IntegrationsAtsForm,
            the calendar's detail <dl>): an unconditional two-column split put
            "Candidate rejected" and "Offer declined" into ~150px columns on a
            phone, wrapping both labels away from their checkboxes. */}
        <div className="grid gap-1.5 sm:grid-cols-2">
          {SUBSCRIBABLE_EVENT_ROWS.map((e) => (
            <label key={e.id} className="flex items-center gap-2 text-sm text-steel">
              <Checkbox checked={events.includes(e.id)} onChange={() => onToggleEvent(e.id)} />
              {t(`event.${e.key}` as Parameters<typeof t>[0])}
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
