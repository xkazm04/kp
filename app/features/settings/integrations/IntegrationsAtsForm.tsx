"use client";

import { useTranslations } from "next-intl";
import { BTN_PRIMARY, DIVIDER, META_LABEL } from "@/app/_components/ui/recipes";
import { Checkbox } from "@/app/_components/Checkbox";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";

// connect-the-integrations — the add/replace form for one inbound ATS connection.
// Split out of IntegrationsAtsPanel.tsx to keep both under the 200-line feature cap.
//
// The token field is write-only in both directions: the GET never returns it (secret
// doctrine, connections-store.ts), and leaving the field BLANK on an existing connection
// keeps the stored one rather than clearing it — so an operator can fix a base URL without
// having to re-paste a credential they may no longer have.

export function IntegrationsAtsForm({
  providers,
  provider,
  onProviderChange,
  providerLabel,
  baseUrl,
  onBaseUrlChange,
  apiToken,
  onApiTokenChange,
  enabled,
  onEnabledChange,
  existingHasToken,
  saving,
  note,
  onSubmit,
}: {
  providers: string[];
  provider: string;
  onProviderChange: (v: string) => void;
  providerLabel: (p: string) => string;
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  apiToken: string;
  onApiTokenChange: (v: string) => void;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  existingHasToken: boolean;
  saving: boolean;
  note: { text: string; ok: boolean } | null;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const t = useTranslations("integrations.ats");

  return (
    <form onSubmit={onSubmit} className={`${DIVIDER} mt-4 pt-4`}>
      <p className="text-base font-medium text-ink">{t("addTitle")}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={`${META_LABEL} block`} htmlFor="ats-provider">
            {t("providerLabel")}
          </label>
          <Select
            id="ats-provider"
            value={provider}
            onChange={onProviderChange}
            sizeVariant="sm"
            className="mt-1 w-full"
            options={providers.map((p) => ({ value: p, label: providerLabel(p) }))}
          />
        </div>
        <div>
          <label className={`${META_LABEL} block`} htmlFor="ats-base-url">
            {t("baseUrlLabel")}
          </label>
          <TextInput
            id="ats-base-url"
            type="url"
            value={baseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            placeholder="https://api.example.com"
            sizeVariant="sm"
            className="mt-1 font-mono"
          />
          <span className="mt-1 block text-meta text-steel">{t("baseUrlHelp")}</span>
        </div>
        <div className="sm:col-span-2">
          <label className={`${META_LABEL} block`} htmlFor="ats-token">
            {t("tokenLabel")}
          </label>
          <TextInput
            id="ats-token"
            type="password"
            value={apiToken}
            onChange={(e) => onApiTokenChange(e.target.value)}
            placeholder={existingHasToken ? t("tokenPlaceholderKeep") : t("tokenPlaceholder")}
            autoComplete="new-password"
            sizeVariant="sm"
            className="mt-1 font-mono"
          />
          <span className="mt-1 block text-meta text-steel">
            {existingHasToken ? t("tokenHelpExisting") : t("tokenHelp")}
          </span>
        </div>
      </div>

      <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-sm text-steel">
        <Checkbox checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
        {t("enabledLabel")}
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving || !provider} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
          {saving ? t("saving") : existingHasToken ? t("update") : t("save")}
        </button>
        {note ? (
          <span role={note.ok ? "status" : "alert"} className={`text-sm font-medium ${note.ok ? "text-moss" : "text-coral"}`}>
            {note.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
