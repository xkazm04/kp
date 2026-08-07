"use client";

import { useTranslations } from "next-intl";
import { VOICE_PROVIDER_ORDER as PROVIDER_ORDER } from "@/app/_lib/voice/types";
import type { VoiceAvailability, VoiceProviderId } from "@/app/_lib/voice/types";
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
  availability,
  isBusy,
}: {
  language: LangHint;
  onLanguage: (v: LangHint) => void;
  provider: VoiceProviderId;
  onProvider: (p: VoiceProviderId) => void;
  availability: VoiceAvailability | null;
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
            const off = availability ? !availability[p] : false;
            return (
              <button
                key={p}
                type="button"
                disabled={isBusy || off}
                aria-pressed={active}
                onClick={() => onProvider(p)}
                title={off ? t("keysNotConfigured", { provider: PROVIDER_LABEL[p] }) : undefined}
                className={`focus-ring rounded-md px-3 py-1.5 text-base transition-colors ${
                  active ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
                } ${off ? "cursor-not-allowed opacity-40" : isBusy ? "cursor-not-allowed" : ""}`}
              >
                {PROVIDER_LABEL[p]}
                {off ? ` · ${t("notSet")}` : ""}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
