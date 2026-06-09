"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { ArrowRight, Globe, Link2, Mail, Radio, Sparkles, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildUrl, type WorkspaceTabId } from "@/app/features/tabs";
import { useLiveRefresh } from "@/app/features/live-refresh";
import { Badge } from "@/app/_components/Badge";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { PipelineEntryView } from "@/app/_lib/db";

// A gentle count-up tween (framer) for the headline inbound figure, so a freshly
// arrived application visibly ticks the number rather than swapping it in place;
// snaps straight to the value when the OS prefers reduced motion. `nums` keeps the
// glyphs tabular so the figure doesn't reflow mid-tween.
function InboundCount({ value }: { value: number }) {
  const reducedMotion = useReducedMotion();
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v));
  useEffect(() => {
    if (reducedMotion) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.6, ease: "easeOut" });
    return () => controls.stop();
  }, [value, reducedMotion, mv]);
  return <motion.span className="font-serif text-2xl text-ink nums">{rounded}</motion.span>;
}

// ENTRY-STAGE RULE (single source of truth: PIPELINE_STAGES / LEGACY_STAGE_MAP in
// app/_lib/db.ts). The consolidated 5-stage model has NO separate "Sourced" stage —
// it was folded into "Accepted". So EVERY channel below — inbound apply, email, job
// boards, proactive sourcing, manual add — lands its candidates at "Accepted", which
// then flows into "Screened". Proactive sourcing ranks the pool in Match, but the
// ranked candidates still ENTER at "Accepted" like everyone else. Keep each channel's
// `desc` copy (and /api/sim/inbound's stage) saying "Accepted", never "Sourced".
// Structural channel definitions; display text (name/status/desc/cta) is resolved
// from the `channels.items.<id>.*` catalog so it localizes. The `desc` copy must
// keep saying "Accepted" (the entry stage) — see the ENTRY-STAGE RULE above.
const CHANNELS: { id: string; icon: typeof Link2; live: boolean; tab?: WorkspaceTabId }[] = [
  { id: "apply", icon: Link2, live: true },
  { id: "email", icon: Mail, live: false },
  { id: "boards", icon: Globe, live: false },
  { id: "sourcing", icon: Sparkles, live: true, tab: "match" },
  { id: "manual", icon: UserPlus, live: true, tab: "profile" },
];

// Phase 2 — inbound channels & integrations. Where candidates ENTER the pipeline
// (the front redesign): both inbound applications and proactively-sourced
// candidates arrive at ‘Accepted’, then flow into ‘Screened’ (first-wave evaluation).
export function ChannelsTab() {
  const t = useTranslations("channels");
  // Resolve a channel's display text from the catalog by id (e.g. items.apply.name).
  const item = (id: string, key: string) => t(`items.${id}.${key}` as Parameters<typeof t>[0]);
  const router = useRouter();
  const search = useSearchParams();
  const [entries, setEntries] = useState<PipelineEntryView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const load = () =>
    fetch("/api/pipeline")
      .then((r) => r.json())
      .then((p) => setEntries((p.entries as PipelineEntryView[]) ?? []))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  useEffect(() => {
    load();
  }, []);
  useLiveRefresh(load);

  const accepted = entries.filter((e) => e.stage === "Accepted" && e.status === "active");
  const jobs = [...new Map(entries.filter((e) => e.jobId).map((e) => [e.jobId as string, e.jobTitle ?? ""])).entries()];

  const simulate = async () => {
    const jobId = jobs[0]?.[0];
    if (!jobId) {
      setNote({ text: t("noJobNote"), ok: false });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/sim/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? t("failed"));
      setNote({ text: t("appliedNote", { label: p.label, score: p.score }), ok: true });
      load();
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : t("failed"), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-sim="channels" className="space-y-6">
      <header>
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-2xl text-body text-steel">
          {t.rich("intro", {
            b: (chunks) => <strong>{chunks}</strong>,
            hl: (chunks) => <span className="font-semibold text-ink">{chunks}</span>,
          })}
        </p>
      </header>

      <div data-sim="channel-inbound" className="flex flex-wrap items-center gap-3 rounded-lg border border-moss/30 bg-moss/5 p-4">
        <Radio size={18} className="text-moss" />
        {loaded ? (
          <span className="text-base text-ink">
            <InboundCount value={accepted.length} />{" "}
            {t.rich("received", {
              count: accepted.length,
              hl: (chunks) => <span className="font-semibold">{chunks}</span>,
            })}
          </span>
        ) : (
          <span
            role="status"
            aria-label={t("loadingInbound")}
            className="inline-block h-6 w-52 animate-pulse rounded bg-moss/20"
          />
        )}
        <button
          type="button"
          onClick={() => router.push(buildUrl({ tab: "pipeline" }, search.toString()))}
          className="focus-ring inline-flex items-center gap-1 text-base font-semibold text-coral hover:underline"
        >
          {t("openPipeline")} <ArrowRight size={14} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {CHANNELS.map((c) => (
          <div key={c.id} className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <c.icon size={16} className="text-coral" /> {item(c.id, "name")}
              </span>
              <Badge
                tone={c.live ? "positive" : "neutral"}
                label={item(c.id, "status")}
                dot={c.live}
                ariaLabel={t(c.live ? "channelAriaLive" : "channelAriaOff", { name: item(c.id, "name"), status: item(c.id, "status") })}
                className="shrink-0"
              />
            </div>
            <p className="mt-1.5 text-sm text-steel">{item(c.id, "desc")}</p>
            {c.tab ? (
              <button
                type="button"
                onClick={() => router.push(buildUrl({ tab: c.tab! }, search.toString()))}
                className="focus-ring mt-2 inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
              >
                {t.has(`items.${c.id}.cta` as Parameters<typeof t>[0]) ? item(c.id, "cta") : t("open")} <ArrowRight size={13} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-sim-click="simulate-inbound"
          onClick={simulate}
          disabled={busy}
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
        >
          <Link2 size={15} /> {busy ? t("receiving") : t("simulate")}
        </button>
        {note ? (
          <span
            role="status"
            aria-live="polite"
            className={`text-sm font-medium ${note.ok ? "text-moss" : "text-coral"}`}
          >
            {note.text}
          </span>
        ) : null}
      </div>
    </section>
  );
}
