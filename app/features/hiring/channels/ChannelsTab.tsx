"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { buildUrl } from "@/app/features/shell/tabs";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { type BadgeTone } from "@/app/_components/Badge";
import { BTN_SECONDARY, EYEBROW, NOTICE, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { CHANNEL_SECTIONS, type ChannelSectionId } from "./channelsSections";
import { useChannelData, simulateInbound } from "./useChannelsData";
import { isReceiverLive } from "./useChannelsReceivers";
import { ChannelsTabSwitcher } from "./ChannelsTabSwitcher";
import { ChannelsTabStage } from "./ChannelsTabStage";
import { CHANNEL_ACCENT } from "./channelsAccent";

// CHANNELS — the "Intake Studio". Each inbound integration is a stage with its own
// identity: a row of icon-pill tabs (per-section accent + live status) opens a stage
// that leads with a hero band (sticker glyph, serif headline, status, CTA) + a stat
// cluster of what's flowing, then the manager. Proactive sourcing + Manual add are
// intentionally out of this page (they live in Match / Profile). Accents are drawn
// only from Badge-mapped tones (coral/moss/blue/amber) so both themes stay honest.
//
// channels-i18n-honesty: every string on this surface now resolves through the
// `channels.*` catalog in all four locales — the tab was hardcoded English behind an
// eslint-disable while ~49 already-translated keys sat orphaned.

export function ChannelsTab() {
  const t = useTranslations("channels");
  // The shared error affordance (RouteError's namespace) — this tab's fourth loading
  // branch. Reused rather than re-worded so a failed intake load reads the same as
  // every other failure in the product, in all four locales.
  const tError = useTranslations("resilience");
  // Sim refusals resolve from the machine `code`, never the server's English `error`
  // — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const router = useRouter();
  const search = useSearchParams();
  const reduced = useReducedMotion();
  const { webhooks, jobs, accepted, loadFailed, reload } = useChannelData();
  const [section, setSection] = useState<ChannelSectionId>("comms");
  // Round-2 prototype switcher: which directional initial-state system every pane
  // on this page uses. Baseline default — nothing changes on load.
  const [simNote, setSimNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const active = CHANNEL_SECTIONS.find((s) => s.id === section)!;
  const accent = CHANNEL_ACCENT[section];
  // webhooks/jobs are null until their first fetch settles (docs/design/loading-choreography.md,
  // tier 2) — `?? []` here is only for the arithmetic below; the actual "not fetched
  // yet vs. genuinely empty" branch happens where these render (statusFor, the careers
  // list, and the `hooksKnown` stat cluster below).
  const hooksFor = (ch?: string) => (ch ? (webhooks ?? []).filter((w) => w.channel === ch) : []);

  // ONE "Listening" definition on this page (channels-i18n-honesty). The section badge
  // used to say Listening the moment a receiver ROW existed, while the row's own badge
  // said Listening only once it had taken traffic — two contradictory claims about the
  // same thing, side by side. The row semantics win: Listening means liveness is
  // PROVEN (isReceiverLive, an authenticated POST has arrived — see db/channels.ts);
  // a receiver that exists but has never been reached reads as the neutral "Configured".
  const statusFor = (id: ChannelSectionId, channel?: string): { tone: BadgeTone; label: string } | null | "pending" => {
    if (id === "comms") return null;
    if (id === "careers") {
      if (jobs === null) return "pending";
      // A careers page with nothing published is not live — there is no public link
      // to hand anyone. Say so rather than showing a green "Live" over an empty page.
      return jobs.length > 0
        ? { tone: "positive", label: t("statusLive") }
        : { tone: "neutral", label: t("statusNothingPublished") };
    }
    if (webhooks === null) return "pending";
    const hooks = hooksFor(channel);
    if (hooks.length === 0) return { tone: "neutral", label: t("statusOff") };
    return hooks.some(isReceiverLive)
      ? { tone: "positive", label: t("statusListening") }
      : { tone: "info", label: t("statusConfigured") };
  };

  const simulate = async () => {
    setSimBusy(true);
    setSimNote(null);
    const result = await simulateInbound(jobs?.[0]?.id);
    if (result.ok) {
      reload();
      setSimNote({ ok: true, text: t("sim.filed", { label: result.label, score: result.score, role: result.jobTitle }) });
    } else {
      setSimNote({
        ok: false,
        text:
          result.reason === "noJob"
            ? t("sim.noJob")
            : errMsg(result, result.status ? t("sim.failedStatus", { status: result.status }) : t("sim.failed")),
      });
    }
    setSimBusy(false);
  };

  // The stat cluster is the THIRD render site of these lists, and the one the `?? []`
  // note above forgot: summing an unfetched (or failed) list gave "Receivers 0 /
  // Received 0 / Leads filed 0" — a hard zero, next to a status badge that was
  // honestly holding a pending placeholder for the same unknown. `null` here renders
  // as "—", the same unknown marker the careers stats already use.
  const activeHooks = hooksFor(active.channel);
  const hooksKnown = webhooks !== null;
  const activeHooksCount = hooksKnown ? activeHooks.length : null;
  const received = hooksKnown ? activeHooks.reduce((n, h) => n + (h.receivedCount ?? 0), 0) : null;
  const leads = hooksKnown ? activeHooks.reduce((n, h) => n + (h.acceptedCount ?? 0), 0) : null;
  const activeStatus = statusFor(active.id, active.channel);
  // First-load signal for the whole tab (tier 1's aria-busy): true only until every
  // source has settled once; a later useLiveRefresh re-fetch never flips this back.
  // A failed source leaves its value null on purpose, so `loadFailed` releases the
  // busy state — the page is not loading any more, it is broken, and the alert below
  // is what a screen reader should be hearing instead.
  const firstLoad = (webhooks === null || jobs === null || accepted === null) && !loadFailed;

  return (
    // Tier 1 (docs/design/loading-choreography.md): the header, switcher and stage frame
    // are direct children of this stagger-children wrapper, so they cascade in on
    // the first frame regardless of the three fetches below.
    <section data-sim="channels" className="stagger-children space-y-5" aria-busy={firstLoad}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h2 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h2>
        </div>
        {/* data-sim hook: the guided simulation spotlights this inbound indicator. */}
        <button
          type="button"
          data-sim="channel-inbound"
          onClick={() => router.push(buildUrl({ tab: "pipeline" }, search.toString()))}
          className="focus-ring inline-flex items-center gap-1.5 text-sm font-semibold text-coral hover:underline"
        >
          {t("waiting", { count: accepted ?? "—" })} <ArrowRight size={14} aria-hidden />
        </button>
      </header>

      {/* A source didn't load. Say so and offer the retry, rather than letting the
          panes below narrate an empty workspace nobody has verified. */}
      {loadFailed ? (
        // NOTICE("critical") + BTN_SECONDARY, not a hand-rolled red box: the literal
        // version sat one shade off the recipe (red-200/red-700 vs the recipe's
        // red-800 text) and carried none of Spark Dark's structure — no sticker
        // radius on the block, a flat retry button beside every other one that
        // presses down.
        <p role="alert" className={`${NOTICE("critical")} flex flex-wrap items-center gap-3 p-3 text-sm`}>
          {tError("errorTitle")}
          <button type="button" onClick={() => reload()} className={`${BTN_SECONDARY} h-7 px-2 font-semibold`}>
            {tError("retry")}
          </button>
        </p>
      ) : null}

      {/* Icon-pill section switcher — each channel carries its own accent */}
      <ChannelsTabSwitcher section={section} setSection={setSection} statusFor={statusFor} />

      <ChannelsTabStage
        section={section}
        active={active}
        accent={accent}
        activeStatus={activeStatus}
        jobs={jobs}
        webhooks={webhooks}
        accepted={accepted}
        activeHooksCount={activeHooksCount}
        received={received}
        leads={leads}
        simulate={simulate}
        simBusy={simBusy}
        simNote={simNote}
        reduced={reduced}
        base={base}
        reload={reload}
      />
    </section>
  );
}
