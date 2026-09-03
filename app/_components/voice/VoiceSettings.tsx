"use client";

import { useTranslations } from "next-intl";
import { VOICE_PROVIDER_ORDER as PROVIDER_ORDER } from "@/app/_lib/voice/types";
import type { VoiceProviderId } from "@/app/_lib/voice/types";
import { providerPickerGate, type AvailabilityProbe } from "./availability-gate";
import { PROVIDER_LABEL, type LangHint } from "./ui-types";

/** Settings — language + provider, side by side. The caller hides this entirely on
 *  the candidate portal (lockSettings): the provider is pinned to the session and the
 *  candidate must not see/override these internal A/B controls. Shown only in the lab.
 *  Both lock once a call is in flight. */
export function VoiceSettings({
  language,
  onLanguage,
  provider,
  onProvider,
  probe,
  onRecheck,
  isBusy,
}: {
  language: LangHint;
  onLanguage: (v: LangHint) => void;
  provider: VoiceProviderId;
  onProvider: (p: VoiceProviderId) => void;
  /** The THREE-outcome probe, not a nullable map: the picker used to receive
   *  `VoiceAvailability | null` and read null as "fine, offer everything", which
   *  is the same lie the Start button was fixed for in wave 18b — a failed probe
   *  offering a provider nobody had checked. */
  probe: AvailabilityProbe;
  /** Re-run the availability probe (the only useful action on an unknown). */
  onRecheck: () => void;
  isBusy: boolean;
}) {
  const t = useTranslations("interview.voice");
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-4">
      {/* Language hint */}
      <div>
        <p className="text-meta uppercase text-steel">{t("languageLabel")}</p>
        <div className="mt-1.5 inline-flex rounded-lg border border-stone-200 bg-paper p-1">
          {(
            [
              ["auto", t("langAuto")],
              ["cs", "Čeština"],
              ["en", "English"],
            ] as [LangHint, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              disabled={isBusy}
              aria-pressed={language === v}
              onClick={() => onLanguage(v)}
              className={`focus-ring rounded-md px-3 py-1.5 text-base transition-colors ${
                language === v ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
              } ${isBusy ? "cursor-not-allowed" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Provider picker */}
      <div>
        <p className="text-meta uppercase text-steel">{t("providerLabel")}</p>
        <div className="mt-1.5 inline-flex rounded-lg border border-stone-200 bg-paper p-1">
          {PROVIDER_ORDER.map((p) => {
            const active = provider === p;
            // Same gate as Start (availability-gate.ts): "unavailable" is a known
            // no, "unknown" is a FAILED probe — neither may be presented as a
            // working choice. "checking" stays selectable; the probe is fast.
            const gate = providerPickerGate(probe, p);
            const off = gate === "unavailable" || gate === "unknown";
            const why =
              gate === "unavailable"
                ? t("keysNotConfigured", { provider: PROVIDER_LABEL[p] })
                : gate === "unknown"
                  ? t("availabilityUnknown")
                  : undefined;
            return (
              <button
                key={p}
                type="button"
                disabled={isBusy || off}
                aria-pressed={active}
                onClick={() => onProvider(p)}
                title={why}
                className={`focus-ring rounded-md px-3 py-1.5 text-base transition-colors ${
                  active ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
                } ${off ? "cursor-not-allowed opacity-40" : isBusy ? "cursor-not-allowed" : ""}`}
              >
                {PROVIDER_LABEL[p]}
                {gate === "unavailable" ? ` · ${t("notSet")}` : ""}
                {gate === "unknown" ? ` · ${t("notChecked")}` : ""}
              </button>
            );
          })}
        </div>
        {probe.status === "failed" ? (
          // The probe failed, so EVERY option above is disabled. Say why, and offer
          // the one action that can change it — the same line and retry the Start
          // control shows, so the two controls tell one story.
          <p className="mt-1.5 text-meta text-coral" role="status">
            {t("availabilityUnknown")}{" "}
            <button type="button" onClick={onRecheck} className="focus-ring font-semibold underline">
              {t("availabilityRetry")}
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
