"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  calendarCallbackTone,
  isCalendarCallbackStatus,
  type CalendarCallbackTone,
} from "@/app/_lib/calendar/callback-status";

// connect-the-integrations — renders ONE Google OAuth callback outcome.
//
// Every code in CALENDAR_CALLBACK_STATUSES gets a title + a "what to do about it" line;
// integrationsCatalog.test.ts asserts that mapping is total in all four locales, because
// the failure mode here is silent by construction — a missing key renders an empty banner
// after a redirect the operator cannot repeat without re-running the whole consent flow.
//
// An UNRECOGNIZED code (an older deployment redirecting into a newer UI, or a hand-typed
// param) still renders: generic error copy plus the raw code, so the operator has
// something to report. Never a blank frame.

const TONE_CLASS: Record<CalendarCallbackTone, string> = {
  ok: "border-moss/40 bg-moss/5 text-moss",
  warn: "border-amber-300 bg-amber-50 text-amber-900",
  error: "border-coral/40 bg-coral/5 text-coral",
};

export function IntegrationsCallbackBanner({ code }: { code: string }) {
  const t = useTranslations("integrations.calendar");
  const known = isCalendarCallbackStatus(code);
  const tone: CalendarCallbackTone = known ? calendarCallbackTone(code) : "error";
  const Icon = tone === "ok" ? CheckCircle2 : AlertTriangle;

  // The key is built at runtime from the canonical status list, so it is cast to the
  // translator's own key type (the `useEnumLabel`/`navLabel` precedent). No `has` fallback
  // on the known branch — the guard test makes that mapping total by contract.
  type Key = Parameters<typeof t>[0];
  const title = known ? t(`callback.${code}.title` as Key) : t("callback.unknown.title");
  // The unknown branch echoes the raw `?calendar=` param so the operator has
  // something to report — but that param is whatever was in the address bar, and
  // an unbounded echo puts arbitrary text of arbitrary length inside a styled
  // error banner (React escapes it, so this is layout and framing, not markup).
  // 64 characters is more than any real status code and still quotable.
  const body = known ? t(`callback.${code}.body` as Key) : t("callback.unknown.body", { code: code.slice(0, 64) });

  // `cancelled` and a partial grant are `warn`, not faults — announced politely (status),
  // so only a genuine error interrupts a screen reader with `alert`.
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-lg border p-3 ${TONE_CLASS[tone]}`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-base font-semibold">{title}</p>
        <p className="mt-0.5 text-sm opacity-90">{body}</p>
      </div>
    </div>
  );
}
