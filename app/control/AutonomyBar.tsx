"use client";

import { useTranslations } from "next-intl";
import type { Guard } from "./types";
import { BTN_AFFIRM } from "@/app/_components/ui/recipes";

// The kill switch. Pause/resume fire on a single click by design — an oversight
// surface must be able to halt automation instantly — while reconcile, which mutates
// lifecycle state, goes through the shell's two-step confirm.
export function AutonomyBar({
  paused,
  busy,
  armed,
  onAct,
  guard,
  canGovern,
  canOperate,
}: {
  paused: boolean;
  busy: boolean;
  armed: string | null;
  onAct: (action: string) => void | Promise<void>;
  guard: Guard;
  /** `org:manage` - the kill switch is ONE global key, so it is org-level policy. */
  canGovern: boolean;
  /** `pipeline:write` - reconcile re-enqueues this team's own orphaned lifecycles. */
  canOperate: boolean;
}) {
  const t = useTranslations("control.autonomy");

  return (
    <section
      className={`mt-6 flex flex-wrap items-center gap-3 rounded-lg border p-4 shadow-panel ${
        paused ? "border-coral/40 bg-coral/5" : "border-moss/30 bg-moss/5"
      }`}
    >
      {/* Transport glyphs, not copy — the state is spelled out in the line beside them. */}
      <span aria-hidden className={`grid h-10 w-10 place-items-center rounded-full text-white ${paused ? "bg-coral" : "bg-moss"}`}>
        {paused ? "❚❚" : "▶"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{paused ? t("statePaused") : t("stateRunning")}</p>
        <p className="text-micro text-steel">{paused ? t("pausedBody") : t("runningBody")}</p>
      </div>
      {/* AUTHORITY (/perfect wave 21): the state line above stays for every seat - an
          oversight surface must always SAY whether automation is running - but the
          switch itself is shown only to a seat the route will accept. */}
      {canGovern ? (
        paused ? (
          <button type="button" onClick={() => void onAct("resume")} disabled={busy} className={`${BTN_AFFIRM} h-9 px-4 text-sm`}>
            {t("resume")}
          </button>
        ) : (
          <button type="button" onClick={() => void onAct("pause")} disabled={busy} className="focus-ring h-9 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {t("pause")}
          </button>
        )
      ) : null}
      {/* bug-ui-scan-2026-07-09 (guided-pipeline-simulation #3): reconcile mutates
          lifecycle state — gate it behind a confirm, visually lit while armed. */}
      {canOperate ? (
      <button
        type="button"
        onClick={() => guard("reconcile", () => onAct("reconcile"))}
        disabled={busy}
        className={`focus-ring h-9 rounded-md border px-3 text-sm font-semibold disabled:opacity-50 ${
          armed === "reconcile" ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
        }`}
      >
        {armed === "reconcile" ? t("reconcileConfirm") : t("reconcile")}
      </button>
      ) : null}
    </section>
  );
}
