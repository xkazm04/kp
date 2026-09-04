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
import { BTN_PRIMARY, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import type { ChannelSection } from "./channelsSections";
import type { Accent } from "./channelsAccent";
import { ChannelEmpty } from "./ChannelsEmpty";
import { CommsTable } from "./ChannelsCommsTable";
import { RelayConfigCard } from "./ChannelsRelayConfigCard";
import { EdgeConfigCard } from "./ChannelsEdgeCard";
import { AdFormsPane } from "./ChannelsAdFormsPane";
import { EmailIntakeWizard } from "./ChannelsEmailIntakeWizard";
import { CopyLink, Stat } from "./ChannelsTabWidgets";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import type { ChannelJob } from "./useChannelsData";

/** Published roles shown inline on the Careers stage. The full library is one tab
 *  away, so this pane stays a preview — but a preview has to say it is one. */
const CAREERS_PREVIEW = 8;

export function ChannelsTabStage({
  section,
  active,
  accent,
  activeStatus,
  jobs,
  webhooks,
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
  /** Every channel's receivers — handed to the intake panes so they don't
   *  re-fetch a list the tab already holds (useChannelsReceivers). */
  webhooks: ChannelWebhookRecord[] | null;
  accepted: number | null;
  /** null = the receivers list hasn't settled (or failed): the stats render "—", never
   *  a fabricated 0 for a channel whose traffic we have not read yet. */
  activeHooksCount: number | null;
  received: number | null;
  leads: number | null;
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
        {/* Hero row: identity on the left, the stat cluster pinned to the section's
            top-RIGHT corner. The stats used to sit on their own line under the
            blurb, which read as content belonging to the pane below them; up here
            they are what they are — the section's headline numbers, level with the
            section's name, and the pane below starts at the pane. */}
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
          {/* Stat cluster — what's actually flowing through this channel */}
          <div className="flex flex-wrap items-start justify-end gap-2 sm:ml-auto">
            {active.id === "careers" ? (
              <>
                <Stat label={t("stats.publishedRoles")} value={jobs === null ? "—" : jobs.length} />
                <Stat label={t("stats.waiting")} value={accepted ?? "—"} />
              </>
            ) : active.id === "comms" ? (
              <Stat label={t("stats.waiting")} value={accepted ?? "—"} />
            ) : (
              <>
                <Stat label={t("stats.receivers")} value={activeHooksCount ?? "—"} />
                <Stat label={t("stats.received")} value={received ?? "—"} />
                <Stat label={t("stats.leads")} value={leads ?? "—"} />
              </>
            )}
          </div>
        </div>

        {/* CTA for the apply page */}
        {active.id === "careers" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* Held until the jobs list has actually settled: the simulator picks
                jobs[0], so firing it against an unread (or failed) list answered
                "Create a job first" to a workspace full of published roles. */}
            <button
              type="button"
              data-sim-click="simulate-inbound"
              onClick={simulate}
              disabled={simBusy || jobs === null}
              className={`${BTN_PRIMARY} h-9 px-4 text-sm`}
            >
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
              {/* Both of these now render their chrome on the first frame and hold
                  their own height while their fetch is in flight, so neither needs
                  deferring: the relay editor used to sit behind <Defer next-frame>
                  AND behind its own GET, which pushed the ledger down twice — once
                  when the card mounted, again when its config landed. */}
              <RelayConfigCard />
              {/* The INBOUND twin of the relay, and deliberately next to it: one card
                  says where outbound messages go, the other says who answers for this
                  install while it is switched off. */}
              <EdgeConfigCard />
              <CommsTable />
            </div>
          ) : null}
          {active.id === "email" ? (
            <EmailIntakeWizard webhooks={webhooks} jobs={jobs} reload={reload} onChanged={reload} />
          ) : null}
          {active.id === "ads" ? <AdFormsPane webhooks={webhooks} jobs={jobs} reload={reload} onChanged={reload} /> : null}
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
              <>
              <ul className="animate-arrive-in space-y-1.5">
                {jobs.slice(0, CAREERS_PREVIEW).map((j) => {
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
              {/* The list is a PREVIEW, and it used to end without saying so: eight
                  rows out of up to two hundred (useChannelsData reads limit=200),
                  while the stat tile a few inches above showed the real number. The
                  count and the way to the rest belong together. */}
              {jobs.length > CAREERS_PREVIEW ? (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-steel">
                  <span className="nums">{t("careers.showingOf", { shown: CAREERS_PREVIEW, total: jobs.length })}</span>
                  <button
                    type="button"
                    onClick={() => router.push(buildTabSwitchUrl("jobs", search.toString()))}
                    className="focus-ring inline-flex items-center gap-1 rounded font-semibold text-coral hover:underline"
                  >
                    {t("careers.viewAllRoles")} <ArrowRight size={12} aria-hidden />
                  </button>
                </p>
              ) : null}
              </>
            )
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
