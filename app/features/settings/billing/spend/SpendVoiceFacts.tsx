"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { BTN_GHOST } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { VoiceProviderId } from "@/app/_lib/voice/types";
import type { VoiceReadinessReport, VoiceReadinessRow, VoiceReadinessState } from "@/app/_lib/voice/readiness";

// The realtime voice plane on the operator's System strip (challenge-r09
// voice-provider-io/B). One line per provider: a dot, the product name, a state word
// that needs evidence to say "ready", the price per minute the ledger bills with (and
// where it came from), what to set or fix, and how many screens fell back from it this
// week. Reads GET /api/voice/readiness, which never mints; "Check now" POSTs the probe.
//
// Rendered beside SpendEngineFacts, and silent when the read fails: like the engine
// lines it is context under the spend, not the section's subject.

type Report = VoiceReadinessReport & { canProbe: boolean };

// Product names: constants, never catalog copy (docs/i18n/glossary.md, Do-Not-Translate),
// as in SpendEngineFacts. A Record over the id union, so a new provider owes a name.
const VOICE_PRODUCT: Record<VoiceProviderId, string> = {
  openai: "OpenAI Realtime",
  elevenlabs: "ElevenLabs Agents",
};

const DOT: Record<VoiceReadinessState, string> = {
  ready: "bg-moss",
  broken: "bg-coral",
  unchecked: "bg-stone-300",
  absent: "bg-stone-300",
};

export function SpendVoiceFacts() {
  const t = useTranslations("models.system");
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const [report, setReport] = useState<Report | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    fetch("/api/voice/readiness")
      .then((r) => (r.ok ? (r.json() as Promise<Report>) : null))
      .then((body) => {
        if (alive.current && body) setReport(body);
      })
      .catch(() => {
        /* context, not the section's subject: a failed read leaves the voice lines out */
      });
    return () => {
      alive.current = false;
    };
  }, []);

  const check = useCallback(() => {
    setChecking(true);
    setCheckError(null);
    fetch("/api/voice/readiness", { method: "POST" })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!alive.current) return;
        if (r.ok && body) setReport(body as Report);
        else setCheckError(errorMessage(body, t("voice.checkFailed")));
      })
      .catch(() => {
        if (alive.current) setCheckError(t("voice.checkFailed"));
      })
      .finally(() => {
        if (alive.current) setChecking(false);
      });
  }, [errorMessage, t]);

  if (!report) return null;

  const name = (id: VoiceProviderId) => VOICE_PRODUCT[id];
  const money = (usd: number) => format.number(usd, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

  const price = (row: VoiceReadinessRow) => {
    const b = row.billing;
    if (b.kind === "self-hosted") return t("voice.priceSelfHosted");
    return b.source === "override" ? t("voice.priceOverride", { price: money(b.usdPerMin) }) : t("voice.priceEstimate", { price: money(b.usdPerMin) });
  };

  const fix = (row: VoiceReadinessRow) => {
    if (row.state === "absent") return t("findingEnv", { vars: row.need.join(", ") });
    if (row.state !== "broken" || !row.remedy) return null;
    if (row.remedy.kind === "retry") return t("voice.remedyRetry");
    const vars = row.remedy.vars.join(", ");
    return row.remedy.kind === "service" ? t("voice.remedyService", { vars }) : t("findingEnv", { vars });
  };

  const hint = t("voice.checkHint");
  const pref = report.preference;

  return (
    <div className="mt-3 space-y-1.5 text-sm text-ink">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{t("voice.title")}</span>
        {report.offline ? (
          <span className="text-steel">{t("voice.offline")}</span>
        ) : report.canProbe ? (
          <>
            <button
              type="button"
              onClick={check}
              disabled={checking}
              title={hint}
              className={`${BTN_GHOST} px-1 py-0.5 font-semibold text-ink`}
            >
              <RefreshCw size={13} aria-hidden className={checking ? "animate-spin motion-reduce:animate-none" : undefined} />
              {checking ? t("voice.checking") : t("voice.checkNow")}
            </button>
            <span className="text-steel">{hint}</span>
          </>
        ) : null}
      </div>

      {pref && !pref.honored ? (
        <p role="status" className="text-amber-700">
          {t("voice.preference", { requested: name(pref.requested), used: name(pref.defaultProvider) })}
        </p>
      ) : null}
      {checkError ? (
        <p role="alert" className="text-coral">
          {checkError}
        </p>
      ) : null}

      <ul className="space-y-1">
        {report.providers.map((row) => {
          const remedy = fix(row);
          return (
            <li key={row.provider} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${DOT[row.state]}`} />
              <span>{name(row.provider)}</span>
              <span className="text-steel">
                {t(`voice.state.${row.state}`)}
                {row.state === "ready" && row.latencyMs !== null ? ` · ${t("voice.latency", { ms: row.latencyMs })}` : ""}
                {row.state === "broken" && row.cause ? ` · ${t(`voice.cause.${row.cause}`)}` : ""}
                {row.checkedAt ? ` · ${t("voice.checkedAt", { time: format.relativeTime(new Date(row.checkedAt)) })}` : ""}
              </span>
              <span className="text-steel">· {price(row)}</span>
              {row.billing.kind === "per-minute" && row.billing.malformedOverride ? (
                <span className="font-mono text-xs text-amber-700">{t("voice.malformedOverride", { name: row.billing.malformedOverride })}</span>
              ) : null}
              {remedy ? <span className="font-mono text-xs">{remedy}</span> : null}
              {row.failovers.map((f) => (
                <span key={f.to} className="text-amber-700">
                  · {t("voice.failedOver", { count: f.count, to: name(f.to) })}
                </span>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
