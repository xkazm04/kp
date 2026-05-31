"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Globe, Link2, Mail, Radio, Sparkles, UserPlus } from "lucide-react";
import { buildUrl, type WorkspaceTabId } from "@/app/features/tabs";
import { useLiveRefresh } from "@/app/features/live-refresh";

type Entry = { jobId: string | null; jobTitle: string | null; stage: string; status: string };

const CHANNELS: { id: string; icon: typeof Link2; name: string; status: string; live: boolean; desc: string; tab?: WorkspaceTabId; cta?: string }[] = [
  { id: "apply", icon: Link2, name: "Careers page · Apply link", status: "Listening", live: true, desc: "A conversational apply link — submitted applications land at ‘Accepted’." },
  { id: "email", icon: Mail, name: "Email intake", status: "Not configured", live: false, desc: "Forward applications@ to ingest CVs automatically." },
  { id: "boards", icon: Globe, name: "Job boards", status: "Not configured", live: false, desc: "Syndicate a published JD to LinkedIn, jobs.cz, StackOverflow…" },
  { id: "sourcing", icon: Sparkles, name: "Proactive sourcing", status: "Active", live: true, tab: "match", cta: "Open Match", desc: "Rank the candidate pool against the role in Match — proactively sourced candidates land at ‘Sourced’." },
  { id: "manual", icon: UserPlus, name: "Manual add", status: "Recruiter", live: true, tab: "profile", cta: "Build a profile", desc: "Build a candidate profile by hand (Profile) and add them to a role." },
];

// Phase 2 — inbound channels & integrations. Where candidates ENTER the pipeline
// (the front redesign): applications arrive at ‘Accepted’; proactive sourcing
// lands at ‘Sourced’. Both then flow to AI-matched.
export function ChannelsTab() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = () => fetch("/api/pipeline").then((r) => r.json()).then((p) => setEntries((p.entries as Entry[]) ?? [])).catch(() => undefined);
  useEffect(() => {
    load();
  }, []);
  useLiveRefresh(load);

  const accepted = entries.filter((e) => e.stage === "Accepted" && e.status === "active");
  const jobs = [...new Map(entries.filter((e) => e.jobId).map((e) => [e.jobId as string, e.jobTitle ?? ""])).entries()];

  const simulate = async () => {
    const jobId = jobs[0]?.[0];
    if (!jobId) {
      setNote("Publish a JD first — then applications can arrive.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/sim/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? "failed");
      setNote(`${p.label} applied → Accepted (match ${p.score}).`);
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-sim="channels" className="space-y-6">
      <header>
        <p className="text-meta uppercase text-coral">Workspace</p>
        <h2 className="mt-1 font-serif text-display text-ink">Channels &amp; integrations</h2>
        <p className="mt-2 max-w-2xl text-body text-steel">
          Where candidates enter the pipeline. Inbound <strong>applications</strong> arrive at{" "}
          <span className="font-semibold text-ink">Accepted</span>; proactive sourcing lands at{" "}
          <span className="font-semibold text-ink">Sourced</span>. Both then flow to AI-matched.
        </p>
      </header>

      <div data-sim="channel-inbound" className="flex flex-wrap items-center gap-3 rounded-lg border border-moss/30 bg-moss/5 p-4">
        <Radio size={18} className="text-moss" />
        <span className="text-base text-ink">
          <span className="font-serif text-2xl text-ink">{accepted.length}</span> application
          {accepted.length === 1 ? "" : "s"} received → <span className="font-semibold">Accepted</span>
        </span>
        <button
          type="button"
          onClick={() => router.push(buildUrl({ tab: "pipeline" }))}
          className="focus-ring inline-flex items-center gap-1 text-base font-semibold text-coral hover:underline"
        >
          Open Pipeline <ArrowRight size={14} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {CHANNELS.map((c) => (
          <div key={c.id} className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <c.icon size={16} className="text-coral" /> {c.name}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-micro font-semibold uppercase ${
                  c.live ? "bg-moss/15 text-moss" : "bg-stone-100 text-steel"
                }`}
              >
                {c.status}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-steel">{c.desc}</p>
            {c.tab ? (
              <button
                type="button"
                onClick={() => router.push(buildUrl({ tab: c.tab! }))}
                className="focus-ring mt-2 inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
              >
                {c.cta ?? "Open"} <ArrowRight size={13} />
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
          <Link2 size={15} /> {busy ? "Receiving…" : "Simulate an application"}
        </button>
        {note ? <span className="text-sm text-steel">{note}</span> : null}
      </div>
    </section>
  );
}
