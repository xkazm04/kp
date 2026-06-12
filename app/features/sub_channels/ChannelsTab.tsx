"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { ArrowRight, Check, Copy, Globe, Link2, Mail, Radio, Sparkles, Trash2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildTabSwitchUrl, buildUrl, type WorkspaceTabId } from "@/app/features/tabs";
import { useLiveRefresh } from "@/app/features/live-refresh";
import { Badge } from "@/app/_components/Badge";
import { CommsCenter } from "./CommsCenter";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/locales";
import type { ChannelWebhookRecord, PipelineEntryView } from "@/app/_lib/db";

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
// E3 — `live: false` channels are webhook-backed: they read as "Listening" the
// moment at least one active inbound webhook exists for them (see liveFor below
// and the WebhookConnect panel), instead of being hard-coded stubs.
const CHANNELS: { id: string; icon: typeof Link2; live: boolean; tab?: WorkspaceTabId; webhook?: boolean }[] = [
  { id: "apply", icon: Link2, live: true },
  { id: "email", icon: Mail, live: false, webhook: true },
  { id: "boards", icon: Globe, live: false, webhook: true },
  { id: "sourcing", icon: Sparkles, live: true, tab: "match" },
  { id: "manual", icon: UserPlus, live: true, tab: "profile" },
];

// E3 — the per-channel connect panel: lists this channel's inbound webhooks
// (copyable receiver URL, receipt count, revoke) and creates new ones bound to
// a role + candidate language. Lives inside the channel card.
function WebhookConnect({
  channel,
  hooks,
  onChanged,
}: {
  channel: string;
  hooks: ChannelWebhookRecord[];
  onChanged: () => void;
}) {
  const t = useTranslations("channels.webhooks");
  const router = useRouter();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  // null = not fetched yet (lazy: the catalog is only needed once the panel opens).
  const [jobs, setJobs] = useState<{ id: string; title: string }[] | null>(null);
  const [jobId, setJobId] = useState("");
  const [lang, setLang] = useState<Locale>(DEFAULT_LOCALE);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);

  const togglePanel = () => {
    setOpen((o) => !o);
    if (jobs === null) {
      fetch("/api/jobs?limit=200")
        .then((r) => r.json())
        .then((p) => {
          const list = ((p.jobs ?? []) as { id: string; title: string }[]).map((j) => ({ id: j.id, title: j.title }));
          setJobs(list);
          setJobId((cur) => cur || list[0]?.id || "");
        })
        .catch(() => setJobs([]));
    }
  };

  const receiverUrl = (token: string) =>
    `${publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "")}/api/channels/inbound/${token}`;

  // E5 — the playbook's "time to first apply": how long after setup this
  // webhook landed its first lead. Null until one lands (or on clock skew).
  const firstLeadLabel = (h: ChannelWebhookRecord): string | null => {
    if (!h.firstReceivedAt) return null;
    const ms = Date.parse(h.firstReceivedAt) - Date.parse(h.createdAt);
    if (!Number.isFinite(ms) || ms < 0) return null;
    const mins = Math.round(ms / 60_000);
    return mins < 120 ? t("firstLeadMins", { mins }) : t("firstLeadHours", { hours: Math.round(ms / 3_600_000) });
  };

  const copyUrl = async (token: string) => {
    try {
      await navigator.clipboard.writeText(receiverUrl(token));
      setCopiedToken(token);
      window.setTimeout(() => setCopiedToken((c) => (c === token ? null : c)), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const create = async () => {
    if (creating || !jobId) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/channels/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, jobId, lang }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      onChanged();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (token: string) => {
    if (revokingToken) return;
    setRevokingToken(token);
    setError(null);
    try {
      const r = await fetch(`/api/channels/webhooks/${encodeURIComponent(token)}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      onChanged();
    } catch {
      setError(t("revokeFailed"));
    } finally {
      setRevokingToken(null);
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={togglePanel}
        aria-expanded={open}
        className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
      >
        {open ? t("hide") : hooks.length ? t("manage", { count: hooks.length }) : t("connect")}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 border-t border-stone-100 pt-2">
          <p className="text-sm text-steel">{t("intro")}</p>

          {hooks.map((h) => (
            <div key={h.token} className="rounded-md border border-stone-200 bg-paper/50 px-2.5 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{h.jobTitle ?? h.jobId}</span>
                <span className="rounded-full border border-stone-200 px-1.5 text-micro font-semibold uppercase text-steel">
                  {h.lang ?? DEFAULT_LOCALE}
                </span>
                <span className="text-steel">
                  {h.receivedCount > 0 ? t("received", { count: h.receivedCount }) : t("neverReceived")}
                  {firstLeadLabel(h) ? <> · {firstLeadLabel(h)}</> : null}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => copyUrl(h.token)}
                    className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-0.5 font-semibold text-ink hover:border-coral/40"
                  >
                    {copiedToken === h.token ? <Check size={12} /> : <Copy size={12} />}
                    {copiedToken === h.token ? t("copied") : t("copyUrl")}
                  </button>
                  <button
                    type="button"
                    onClick={() => revoke(h.token)}
                    disabled={revokingToken === h.token}
                    title={t("revoke")}
                    aria-label={t("revoke")}
                    className="focus-ring inline-flex items-center rounded-md border border-stone-200 bg-white p-1 text-steel hover:border-coral/40 hover:text-coral disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            </div>
          ))}

          {jobs !== null && jobs.length === 0 ? (
            // Chain-aware dead-end escape: a webhook needs a job, and jobs are
            // born in the JD library — point there instead of dead-stopping.
            <p className="text-sm text-steel">
              {t("noJobs")}{" "}
              <button
                type="button"
                onClick={() => router.push(buildTabSwitchUrl("library", search.toString()))}
                className="focus-ring font-semibold text-coral hover:underline"
              >
                {t("noJobsCta")}
              </button>
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`hook-job-${channel}`}>
                {t("job")}
              </label>
              <select
                id={`hook-job-${channel}`}
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                disabled={jobs === null}
                className="focus-ring h-8 max-w-56 rounded-md border border-stone-200 bg-white px-2 text-sm"
              >
                {(jobs ?? []).map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
              <span className="flex items-center gap-1" role="group" aria-label={t("language")}>
                {LOCALES.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => setLang(loc)}
                    aria-pressed={lang === loc}
                    className={`focus-ring rounded-full border px-2 py-0.5 text-sm font-semibold uppercase ${
                      lang === loc ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
                    }`}
                  >
                    {loc}
                  </button>
                ))}
              </span>
              <button
                type="button"
                onClick={create}
                disabled={creating || !jobId}
                className="focus-ring h-8 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
              >
                {creating ? t("creating") : t("create")}
              </button>
            </div>
          )}

          {error ? (
            <p role="alert" className="text-sm text-coral">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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
  // E3 — active inbound webhooks; flips the stub channels' badge to "Listening"
  // and feeds each card's connect panel.
  const [webhooks, setWebhooks] = useState<ChannelWebhookRecord[]>([]);

  const loadWebhooks = () =>
    fetch("/api/channels/webhooks")
      .then((r) => r.json())
      .then((p) => setWebhooks((p.webhooks as ChannelWebhookRecord[]) ?? []))
      .catch(() => undefined);
  const load = () =>
    Promise.all([
      fetch("/api/pipeline")
        .then((r) => r.json())
        .then((p) => setEntries((p.entries as PipelineEntryView[]) ?? []))
        .catch(() => undefined),
      loadWebhooks(),
    ]).finally(() => setLoaded(true));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only load; `load` is stable per render and re-fired by useLiveRefresh below
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
        {CHANNELS.map((c) => {
          // E3 — a webhook-backed channel is live the moment one active webhook
          // exists for it; the static status text then reads "Listening".
          const hooks = webhooks.filter((w) => w.channel === c.id);
          const live = c.live || hooks.length > 0;
          const status = !c.live && live ? t("statusListening") : item(c.id, "status");
          return (
            <div key={c.id} className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold text-ink">
                  <c.icon size={16} className="text-coral" /> {item(c.id, "name")}
                </span>
                <Badge
                  tone={live ? "positive" : "neutral"}
                  label={status}
                  dot={live}
                  ariaLabel={t(live ? "channelAriaLive" : "channelAriaOff", { name: item(c.id, "name"), status })}
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
              {c.webhook ? <WebhookConnect channel={c.id} hooks={hooks} onChanged={loadWebhooks} /> : null}
            </div>
          );
        })}
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

      {/* W6-2 (SIM1) — every candidate-facing message, where a recruiter
          actually thinks "candidate communications". */}
      <CommsCenter />
    </section>
  );
}
