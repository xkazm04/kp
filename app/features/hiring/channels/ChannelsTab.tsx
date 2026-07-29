"use client";
/* eslint-disable i18next/no-literal-string -- prototype-stage copy; threaded into
   the channels namespace on a later i18n pass. */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { buildUrl } from "@/app/features/shell/tabs";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { type BadgeTone } from "@/app/_components/Badge";
import { EYEBROW, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { CHANNEL_SECTIONS, type ChannelSectionId } from "./channelsSections";
import { useChannelData, simulateInbound } from "./useChannelsData";
import { ChannelsTabSwitcher } from "./ChannelsTabSwitcher";
import { ChannelsTabStage } from "./ChannelsTabStage";
import { CHANNEL_ACCENT } from "./channelsAccent";

// CHANNELS — the "Intake Studio". Each inbound integration is a stage with its own
// identity: a row of icon-pill tabs (per-section accent + live status) opens a stage
// that leads with a hero band (sticker glyph, serif headline, status, CTA) + a stat
// cluster of what's flowing, then the manager. Proactive sourcing + Manual add are
// intentionally out of this page (they live in Match / Profile). Accents are drawn
// only from Badge-mapped tones (coral/moss/blue/amber) so both themes stay honest.

export function ChannelsTab() {
  const router = useRouter();
  const search = useSearchParams();
  const reduced = useReducedMotion();
  const { webhooks, jobs, accepted, reload } = useChannelData();
  const [section, setSection] = useState<ChannelSectionId>("comms");
  // Round-2 prototype switcher: which directional initial-state system every pane
  // on this page uses. Baseline default — nothing changes on load.
  const [simNote, setSimNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const active = CHANNEL_SECTIONS.find((s) => s.id === section)!;
  const accent = CHANNEL_ACCENT[section];
  // webhooks/jobs are null until their first fetch settles (docs/LOADING_CHOREOGRAPHY.md,
  // tier 2) — `?? []` here is only for the arithmetic below; the actual "not fetched
  // yet vs. genuinely empty" branch happens where these render (statusFor + the
  // careers list).
  const hooksFor = (ch?: string) => (ch ? (webhooks ?? []).filter((w) => w.channel === ch) : []);

  const statusFor = (id: ChannelSectionId, channel?: string): { tone: BadgeTone; label: string } | null | "pending" => {
    if (id === "comms") return null;
    if (id === "careers") {
      if (jobs === null) return "pending";
      // A careers page with nothing published is not live — there is no public link
      // to hand anyone. Say so rather than showing a green "Live" over an empty page.
      return jobs.length > 0 ? { tone: "positive", label: "Live" } : { tone: "neutral", label: "Nothing published" };
    }
    if (webhooks === null) return "pending";
    const n = hooksFor(channel).length;
    return n > 0 ? { tone: "positive", label: "Listening" } : { tone: "neutral", label: "Off" };
  };

  const simulate = async () => {
    setSimBusy(true);
    setSimNote(null);
    const note = await simulateInbound(jobs?.[0]?.id);
    if (note.ok) reload();
    setSimNote(note);
    setSimBusy(false);
  };

  const activeHooks = hooksFor(active.channel);
  const received = activeHooks.reduce((n, h) => n + (h.receivedCount ?? 0), 0);
  const leads = activeHooks.reduce((n, h) => n + (h.acceptedCount ?? 0), 0);
  const activeStatus = statusFor(active.id, active.channel);
  // First-load signal for the whole tab (tier 1's aria-busy): true only until every
  // source has settled once; a later useLiveRefresh re-fetch never flips this back.
  const firstLoad = webhooks === null || jobs === null || accepted === null;

  return (
    // Tier 1 (docs/LOADING_CHOREOGRAPHY.md): the header, switcher and stage frame
    // are direct children of this stagger-children wrapper, so they cascade in on
    // the first frame regardless of the three fetches below.
    <section data-sim="channels" className="stagger-children space-y-5" aria-busy={firstLoad}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={EYEBROW}>Inbound studio</p>
          <h2 className={`mt-1 ${TITLE_DISPLAY}`}>Where candidates come in</h2>
        </div>
        {/* data-sim hook: the guided simulation spotlights this inbound indicator. */}
        <button
          type="button"
          data-sim="channel-inbound"
          onClick={() => router.push(buildUrl({ tab: "pipeline" }, search.toString()))}
          className="focus-ring inline-flex items-center gap-1.5 text-sm font-semibold text-coral hover:underline"
        >
          {accepted ?? "—"} waiting in the pipeline <ArrowRight size={14} aria-hidden />
        </button>
      </header>

      {/* Icon-pill section switcher — each channel carries its own accent */}
      <ChannelsTabSwitcher section={section} setSection={setSection} statusFor={statusFor} />

      <ChannelsTabStage
        section={section}
        active={active}
        accent={accent}
        activeStatus={activeStatus}
        jobs={jobs}
        accepted={accepted}
        activeHooksCount={activeHooks.length}
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
