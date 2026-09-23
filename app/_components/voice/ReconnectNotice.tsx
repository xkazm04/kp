"use client";

import { useTranslations } from "next-intl";
import { RefreshCw, WifiOff } from "lucide-react";
import { BTN_GHOST, BTN_SECONDARY, NOTICE } from "@/app/_components/ui/recipes";
import type { ReconnectPlan } from "./reconnect-plan";

/** What the shell is doing about a dropped call, in words (challenge-r08
 *  voice-interview-components/B). The decision is reconnect-plan.ts's; this only
 *  renders it: the cancellable countdown, the "saving your answers first" wait, the
 *  offline wait, and the lines that hand recovery back to the Start button. A plan
 *  of `none` renders nothing. */
export function ReconnectNotice({
  plan,
  secondsLeft,
  onCancel,
  onReconnectNow,
}: {
  plan: ReconnectPlan;
  /** The countdown's current value (the plan's own `seconds` before the first tick). */
  secondsLeft: number;
  onCancel: () => void;
  onReconnectNow: () => void;
}) {
  const t = useTranslations("interview.voice.reconnect");
  if (plan.kind === "none") return null;

  if (plan.kind === "countdown") {
    return (
      <div role="status" className={`${NOTICE("info")} flex flex-wrap items-center gap-3 px-3 py-2.5 text-base`}>
        <RefreshCw size={16} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1">{t("countdown", { seconds: secondsLeft })}</span>
        <button type="button" onClick={onCancel} className={`${BTN_GHOST} h-9 px-3 text-sm`}>
          {t("cancel")}
        </button>
        <button type="button" onClick={onReconnectNow} className={`${BTN_SECONDARY} h-9 bg-white px-3 text-sm`}>
          {t("now")}
        </button>
      </div>
    );
  }

  const line =
    plan.kind === "save_first"
      ? t("savingFirst")
      : plan.kind === "wait_online"
        ? t("waitOnline")
        : plan.reason === "budget"
          ? t("budget")
          : plan.reason === "cancelled"
            ? t("cancelled")
            : t("manual");
  const waiting = plan.kind === "save_first" || plan.kind === "wait_online";
  return (
    <p role="status" className={`${NOTICE(waiting ? "info" : "amber")} flex items-center gap-2 px-3 py-2 text-base`}>
      {plan.kind === "wait_online" ? <WifiOff size={16} aria-hidden className="shrink-0" /> : null}
      <span>{line}</span>
    </p>
  );
}
