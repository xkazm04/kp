"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, Copy, ExternalLink, Link2 } from "lucide-react";
import { buildUrl } from "@/app/features/tabs";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { BTN_PRIMARY, EYEBROW, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { CHANNEL_SECTIONS, type ChannelSectionId } from "./sections";
import { useChannelData, simulateInbound } from "./use-channel-data";
import { isReceiverLive } from "./use-receivers";
import { CommsTable } from "./CommsTable";
import { AdFormsPane } from "./AdFormsPane";
import { EmailIntakeWizard } from "./EmailIntakeWizard";

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

type Accent = { text: string; soft: string; border: string };
const ACCENT: Record<ChannelSectionId, Accent> = {
  comms: { text: "text-coral", soft: "bg-coral/10", border: "border-coral/30" },
  careers: { text: "text-moss", soft: "bg-moss/10", border: "border-moss/30" },
  email: { text: "text-blue-700", soft: "bg-blue-50", border: "border-blue-200" },
  ads: { text: "text-amber-700", soft: "bg-amber-50", border: "border-amber-200" },
};

function CopyLink({ url }: { url: string }) {
  const t = useTranslations("channels");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-ink hover:border-coral/40"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? t("copied") : t("copyLink")}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 shadow-pop">
      <div className="text-meta uppercase text-steel">{label}</div>
      <div className="font-serif text-h3 leading-tight text-ink nums">{value}</div>
    </div>
  );
}

export function ChannelsTab() {
  const t = useTranslations("channels");
  const router = useRouter();
  const search = useSearchParams();
  const reduced = useReducedMotion();
  const { webhooks, jobs, accepted, reload } = useChannelData();
  const [section, setSection] = useState<ChannelSectionId>("comms");
  const [simNote, setSimNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const active = CHANNEL_SECTIONS.find((s) => s.id === section)!;
  const a = ACCENT[section];
  const hooksFor = (ch?: string) => (ch ? webhooks.filter((w) => w.channel === ch) : []);

  // ONE "Listening" definition on this page (channels-i18n-honesty). The section badge
  // used to say Listening the moment a receiver ROW existed, while the row's own badge
  // said Listening only once it had taken traffic — two contradictory claims about the
  // same thing, side by side. The row semantics win: Listening means liveness is
  // PROVEN (isReceiverLive, an authenticated POST has arrived — see db/channels.ts);
  // a receiver that exists but has never been reached reads as the neutral "Configured".
  const statusFor = (id: ChannelSectionId, channel?: string): { tone: BadgeTone; label: string } | null => {
    if (id === "comms") return null;
    if (id === "careers") return { tone: "positive", label: t("statusLive") };
    const hooks = hooksFor(channel);
    if (hooks.length === 0) return { tone: "neutral", label: t("statusOff") };
    return hooks.some(isReceiverLive)
      ? { tone: "positive", label: t("statusListening") }
      : { tone: "info", label: t("statusConfigured") };
  };

  const simulate = async () => {
    setSimBusy(true);
    setSimNote(null);
    const result = await simulateInbound(jobs[0]?.id);
    if (result.ok) {
      reload();
      setSimNote({ ok: true, text: t("sim.filed", { label: result.label, score: result.score, role: result.jobTitle }) });
    } else {
      setSimNote({
        ok: false,
        text: result.reason === "noJob" ? t("sim.noJob") : result.message ?? t("sim.failed"),
      });
    }
    setSimBusy(false);
  };

  const activeHooks = hooksFor(active.channel);
  const received = activeHooks.reduce((n, h) => n + (h.receivedCount ?? 0), 0);
  const leads = activeHooks.reduce((n, h) => n + (h.acceptedCount ?? 0), 0);
  const activeStatus = statusFor(active.id, active.channel);

  return (
    <section data-sim="channels" className="space-y-5">
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

      {/* Icon-pill section switcher — each channel carries its own accent */}
      <div role="tablist" aria-label={t("tablist")} className="flex flex-wrap gap-2">
        {CHANNEL_SECTIONS.map((s) => {
          const selected = s.id === section;
          const acc = ACCENT[s.id];
          const st = statusFor(s.id, s.channel);
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setSection(s.id)}
              className={`focus-ring flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-all ${
                selected ? `${acc.border} ${acc.soft} shadow-pop` : "border-stone-200 bg-white hover:border-stone-300"
              }`}
            >
              <span
                className={`inline-grid h-8 w-8 place-items-center rounded-lg border ${selected ? acc.border : "border-stone-200"} ${selected ? "bg-white" : "bg-paper"}`}
              >
                <s.icon size={16} className={selected ? acc.text : "text-steel"} aria-hidden />
              </span>
              <span className="text-left">
                <span className={`block text-sm font-semibold ${selected ? "text-ink" : "text-steel"}`}>
                  {t(`sections.${s.id}.label`)}
                </span>
                {st ? (
                  <span className="flex items-center gap-1 text-xs text-steel">
                    <span className={`h-1.5 w-1.5 rounded-full ${st.tone === "positive" ? "bg-moss" : "bg-stone-300"}`} aria-hidden />
                    {st.label}
                  </span>
                ) : (
                  <span className="block text-xs text-steel">{t("ledger")}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Stage: hero band + stat cluster + body. AnimatePresence crossfades the pane
          on section change so the DOM transition reads as a deliberate swap. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={section}
          initial={reduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 1 } : { opacity: 0, y: -6 }}
          transition={reduced ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
          className={`rounded-2xl border-2 ${a.border} ${a.soft} p-5`}
        >
          <div className="flex flex-wrap items-start gap-4">
            <span className={`inline-grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 ${a.border} bg-white shadow-sticker-sm`}>
              <active.icon size={22} className={a.text} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-serif text-h2 text-ink">{t(`sections.${active.id}.label`)}</h3>
                {activeStatus ? <Badge {...activeStatus} dot={activeStatus.tone === "positive"} /> : null}
              </div>
              <p className="mt-1 max-w-xl text-body text-steel">{t(`sections.${active.id}.blurb`)}</p>
            </div>
          </div>

          {/* Stat cluster — what's actually flowing through this channel */}
          <div className="mt-4 flex flex-wrap gap-2">
            {active.id === "careers" ? (
              <>
                <Stat label={t("stats.publishedRoles")} value={jobs.length} />
                <Stat label={t("stats.waiting")} value={accepted ?? "—"} />
              </>
            ) : active.id === "comms" ? (
              <Stat label={t("stats.waiting")} value={accepted ?? "—"} />
            ) : (
              <>
                <Stat label={t("stats.receivers")} value={activeHooks.length} />
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
            {active.id === "comms" ? <CommsTable /> : null}
            {active.id === "email" ? <EmailIntakeWizard onChanged={reload} /> : null}
            {active.id === "ads" ? <AdFormsPane onChanged={reload} /> : null}
            {active.id === "careers" ? (
              jobs.length === 0 ? (
                <p className="text-sm text-steel">{t("careers.empty")}</p>
              ) : (
                <ul className="space-y-1.5">
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
    </section>
  );
}
