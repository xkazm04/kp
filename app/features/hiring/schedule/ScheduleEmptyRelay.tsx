"use client";

// Variant B — "Relay handoff".
//
// Metaphor: Schedule is a station on a relay, not a container. The tab is empty
// because the baton is still one stop upstream, so the surface leads with the
// three-stop rail (Decisions → Schedule → Interview), marks where the baton sits
// and where the recruiter is standing, and only then explains the absence. The
// traced calendar glyph sits outside the card as the station's stamp rather than
// as a hero illustration.
//
// Differs from baseline (and from Variant A): baseline is a centred card that
// names the missing thing; this one makes the *chain itself* the primary object,
// so the upstream link is the obvious continuation of a drawn path.

import { useTranslations } from "next-intl";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { SCHEDULE_GLYPH } from "@/app/_components/glyph/glyphs/scheduleGlyph";
import { META_LABEL } from "@/app/_components/ui/recipes";

type StopState = "waiting" | "here" | "ahead";

// One station on the rail. Extracted so the rail can be reused by any downstream
// tab that wants to show where its input is stuck (Offer, Hired).
function RelayStop({ label, note, state }: { label: string; note: string; state: StopState }) {
  const dot =
    state === "waiting"
      ? "bg-coral"
      : state === "here"
        ? "bg-ink"
        : "border border-stone-300 bg-transparent";
  return (
    <li className="flex min-w-0 flex-1 items-start gap-2">
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="min-w-0">
        <span
          className={`block truncate text-sm ${state === "ahead" ? "font-medium text-steel" : "font-semibold text-ink"}`}
        >
          {label}
        </span>
        <span className="block text-meta uppercase tracking-wide text-steel">{note}</span>
      </span>
    </li>
  );
}

export function ScheduleEmptyRelay() {
  const t = useTranslations("scheduleTab");
  return (
    <div className="space-y-4">
      <div>
        <p className={META_LABEL}>Where the baton is</p>
        <ol className="mt-2 flex flex-col gap-3 border-t border-stone-200 pt-3 sm:flex-row sm:gap-6">
          <RelayStop label="Decisions" note="Waiting here" state="waiting" />
          <RelayStop label="Schedule" note="You are here" state="here" />
          <RelayStop label="Interview" note="Next" state="ahead" />
        </ol>
      </div>
      <div className="grid items-center gap-4 sm:grid-cols-[auto_1fr]">
        <MotionizedGlyph
          data={SCHEDULE_GLYPH.data}
          viewBox={SCHEDULE_GLYPH.viewBox}
          className="mx-auto h-24 w-24 sm:mx-0"
        />
        <ChainEmptyState
          title={t("emptyTitle")}
          body={t("emptyBody")}
          links={[{ tab: "decisions", label: t("emptyCta") }]}
        />
      </div>
    </div>
  );
}
