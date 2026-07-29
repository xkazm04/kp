"use client";

// The Channels tab's stage: hero band (sticker glyph, serif headline, status,
// CTA), a stat cluster of what's flowing, and the section body (comms
// ledger / email wizard / ad forms / careers links). Split out of
// ChannelsTab.tsx to keep the tab file under the 200-line cap.
// channels-i18n-honesty: the section label + blurb come from
// `channels.sections.<id>.*`, not from the ChannelSection record.

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ExternalLink, Link2 } from "lucide-react";
import { buildTabSwitchUrl } from "@/app/features/shell/tabs";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { Defer } from "@/app/_components/ui/Defer";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import type { ChannelSection } from "./channelsSections";
import type { Accent } from "./channelsAccent";
import { ChannelEmpty } from "./ChannelsEmpty";
import { CommsTable } from "./ChannelsCommsTable";
import { RelayConfigCard } from "./ChannelsRelayConfigCard";
import { AdFormsPane } from "./ChannelsAdFormsPane";
import { EmailIntakeWizard } from "./ChannelsEmailIntakeWizard";
import { CopyLink, Stat } from "./ChannelsTabWidgets";
import type { ChannelJob } from "./useChannelsData";

export function ChannelsTabStage({
  section,
  active,
  accent,
  activeStatus,
  jobs,
  accepted,
  activeHooksCount,
  received,
  leads,
  simulate,
  simBusy,
  simNote,
  reduced,
  base,
  reload,
}: {
  section: string;
  active: ChannelSection;
  accent: Accent;
  activeStatus: { tone: BadgeTone; label: string } | null | "pending";
  jobs: ChannelJob[] | null;
  accepted: number | null;
  activeHooksCount: number;
  received: number;
  leads: number;
  simulate: () => void;
  simBusy: boolean;
  simNote: { text: string; ok: boolean } | null;
  reduced: boolean;
  base: string;
  reload: () => void;
}) {
  const t = useTranslations("channels");
  const router = useRouter();
  const search = useSearchParams();

  return (
    // Stage: hero band + stat cluster + body. AnimatePresence crossfades the pane
    // on section change so the DOM transition reads as a deliberate swap.
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={section}
        initial={reduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 1 } : { opacity: 0, y: -6 }}
        transition={reduced ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
        className={`rounded-2xl border-2 ${accent.border} ${accent.soft} p-5`}
      >
        <div className="flex flex-wrap items-start gap-4">
          <span className={`inline-grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 ${accent.border} bg-white shadow-sticker-sm`}>
            <active.icon size={22} className={accent.text} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-serif text-h2 text-ink">{t(`sections.${active.id}.label`)}</h3>
              {activeStatus === "pending" ? (
                <span className="reveal-quiet inline-block h-5 w-20 rounded-full bg-stone-100" aria-hidden />
              ) : activeStatus ? (
                <Badge {...activeStatus} dot={activeStatus.tone === "positive"} />
              ) : null}
            </div>
            <p className="mt-1 max-w-xl text-body text-steel">{t(`sections.${active.id}.blurb`)}</p>
          </div>
        </div>

        {/* Stat cluster — what's actually flowing through this channel */}
        <div className="mt-4 flex flex-wrap gap-2">
          {active.id === "careers" ? (
            <>
              <Stat label={t("stats.publishedRoles")} value={jobs === null ? "—" : jobs.length} />
              <Stat label={t("stats.waiting")} value={accepted ?? "—"} />
            </>
          ) : active.id === "comms" ? (
            <Stat label={t("stats.waiting")} value={accepted ?? "—"} />
          ) : (
            <>
              <Stat label={t("stats.receivers")} value={activeHooksCount} />
              <Stat label={t("stats.received")} value={received} />
              <Stat label={t("stats.leads")} value={leads} />
            </>
          )}
        </div>

        {/* CTA for the apply page */}
        {active.id === "careers" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" data-sim-click="simulate-inbound" onClick={simulate} disabled={simBusy} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
              <Link2 size={15} aria-hidden /> {simBusy ? t("sim.running") : t("sim.run")}
            </button>
            {simNote ? (
              <span role="status" aria-live="polite" className={`text-sm font-medium ${simNote.ok ? "text-moss" : "text-coral"}`}>
                {simNote.text}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Body — the register / receivers / links, on a clean white card */}
        <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4">
          {active.id === "comms" ? (
            <div className="space-y-5">
              {/* Tier 3: the relay editor is secondary to the ledger below — the
                  ledger is this section's primary content and mounts immediately;
                  the config card lands a beat later. */}
              <Defer strategy="next-frame">
                <RelayConfigCard />
              </Defer>
              <CommsTable />
            </div>
          ) : null}
          {active.id === "email" ? <EmailIntakeWizard onChanged={reload} /> : null}
          {active.id === "ads" ? <AdFormsPane onChanged={reload} /> : null}
          {active.id === "careers" ? (
            jobs === null ? (
              // Tier 2: the jobs fetch hasn't settled — hold the list's height and
              // say nothing, rather than flashing the empty state below.
              <div className="reveal-quiet min-h-[9rem]" aria-hidden />
            ) : jobs.length === 0 ? (
              // Careers is the one pane whose next action lives in ANOTHER tab:
              // the apply link is minted by publishing a role, not configured here.
              <ChannelEmpty
                section="careers"
                connected={false}
                action={
                  <button
                    type="button"
                    onClick={() => router.push(buildTabSwitchUrl("jobs", search.toString()))}
                    className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
                  >
                    {t("careers.publishRole")} <ArrowRight size={14} aria-hidden />
                  </button>
                }
              />
            ) : (
              <ul className="animate-arrive-in space-y-1.5">
                {jobs.slice(0, 8).map((j) => {
                  const url = `${base}/apply/${j.id}`;
                  return (
                    <li key={j.id} className="flex flex-wrap items-center gap-2 rounded-md border border-stone-100 bg-paper/40 px-3 py-1.5 text-sm">
                      <span className="font-semibold text-ink">{j.title}</span>
                      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-coral hover:underline">
                        <Link2 size={12} aria-hidden /> {t("careers.applyLink")} <ExternalLink size={11} aria-hidden />
                      </a>
                      <span className="ml-auto">
                        <CopyLink url={url} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
