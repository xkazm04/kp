"use client";

import { useTranslations } from "next-intl";
import type { Guard } from "./types";

// The kill switch. Pause/resume fire on a single click by design — an oversight
// surface must be able to halt automation instantly — while reconcile, which mutates
// lifecycle state, goes through the shell's two-step confirm.
export function AutonomyBar({
  paused,
  busy,
  armed,
  onAct,
  guard,
}: {
  paused: boolean;
  busy: boolean;
  armed: string | null;
  onAct: (action: string) => void | Promise<void>;
  guard: Guard;
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
        <p className="text-xs text-steel">{paused ? t("pausedBody") : t("runningBody")}</p>
      </div>
      {paused ? (
        <button type="button" onClick={() => void onAct("resume")} disabled={busy} className="focus-ring h-9 rounded-md bg-moss px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {t("resume")}
        </button>
      ) : (
        <button type="button" onClick={() => void onAct("pause")} disabled={busy} className="focus-ring h-9 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {t("pause")}
        </button>
      )}
      {/* bug-ui-scan-2026-07-09 (guided-pipeline-simulation #3): reconcile mutates
          lifecycle state — gate it behind a confirm, visually lit while armed. */}
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
    </section>
  );
}
