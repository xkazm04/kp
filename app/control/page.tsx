"use client";

import { useEffect, useState } from "react";

type Audit = { id: number; lifecycleId: string | null; actor: string; action: string; reason: string | null; createdAt: string };
type LC = { id: string; title: string | null; stage: string; detail: string | null };
type Gate = { id: string; title: string | null; detail: string | null };
type Status = { autonomy: "on" | "paused"; lifecycles: LC[]; pendingGates: Gate[]; audit: Audit[] };

const ACTOR: Record<string, string> = {
  auto: "bg-coral/15 text-coral",
  human: "bg-moss/15 text-moss",
  system: "bg-stone-200 text-steel",
};

function rel(iso: string): string {
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(d)) return "";
  if (d < 60) return `${Math.max(0, Math.floor(d))}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export default function ControlPage() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/devcase/control")
      .then((r) => r.json())
      .then((p) => (p.error ? null : setS(p as Status)))
      .catch(() => {});
  useEffect(() => {
    load();
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
  }, []);

  const act = async (action: string) => {
    setBusy(true);
    try {
      await fetch("/api/devcase/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      await load();
    } finally {
      setBusy(false);
    }
  };
  const approve = async (id: string) => {
    await fetch(`/api/devcase/lifecycle/${id}/approve`, { method: "POST" });
    await load();
  };

  const paused = s?.autonomy === "paused";
  const active = (s?.lifecycles ?? []).filter((l) => !["promoted", "closed"].includes(l.stage));

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-meta uppercase text-coral">Oversight</p>
            <h1 className="mt-1 font-serif text-display text-ink">Autonomy control room</h1>
            <p className="mt-1 max-w-2xl text-body text-steel">
              Human oversight for the autonomous hiring pipeline — a kill switch, the human gates awaiting you, and an
              immutable audit trail of every automated decision (the record-keeping a high-risk AI hiring system requires).
            </p>
          </div>
          <a href="/?tab=dev" className="focus-ring rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:border-coral/40">
            ← Dev cases
          </a>
        </header>

        {/* kill switch */}
        <section
          className={`mt-6 flex flex-wrap items-center gap-3 rounded-lg border p-4 shadow-panel ${
            paused ? "border-coral/40 bg-coral/5" : "border-moss/30 bg-moss/5"
          }`}
        >
          <span className={`grid h-10 w-10 place-items-center rounded-full text-white ${paused ? "bg-coral" : "bg-moss"}`}>
            {paused ? "❚❚" : "▶"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Automation is {paused ? "PAUSED" : "running"}</p>
            <p className="text-xs text-steel">
              {paused
                ? "Auto-advancement is halted; lifecycles wait for you. Resume to continue + reconcile."
                : "Lifecycles advance under policy. Pause to halt all automation immediately."}
            </p>
          </div>
          {paused ? (
            <button type="button" onClick={() => act("resume")} disabled={busy} className="focus-ring h-9 rounded-md bg-moss px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              Resume automation
            </button>
          ) : (
            <button type="button" onClick={() => act("pause")} disabled={busy} className="focus-ring h-9 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              Pause (kill switch)
            </button>
          )}
          <button type="button" onClick={() => act("reconcile")} disabled={busy} className="focus-ring h-9 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50">
            Reconcile
          </button>
        </section>

        {/* pending human gates */}
        {(s?.pendingGates ?? []).length > 0 ? (
          <section className="mt-6">
            <h2 className="text-meta uppercase tracking-wide text-coral">Awaiting your decision · {s?.pendingGates.length}</h2>
            <div className="mt-2 space-y-2">
              {s?.pendingGates.map((g) => (
                <div key={g.id} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 shadow-panel">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{g.title || "Role"}</span>
                    <span className="block truncate text-[11px] text-steel">{g.detail}</span>
                  </span>
                  <button type="button" onClick={() => approve(g.id)} className="focus-ring h-8 shrink-0 rounded-md bg-moss px-3 text-[11px] font-semibold text-white hover:opacity-90">
                    Approve &amp; continue
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* active lifecycles */}
        <section className="mt-6">
          <h2 className="text-meta uppercase tracking-wide text-steel">Active lifecycles · {active.length}</h2>
          {active.length === 0 ? (
            <p className="mt-2 rounded-md border border-dashed border-stone-200 p-3 text-xs text-steel">None active.</p>
          ) : (
            <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white shadow-panel">
              {active.map((l) => (
                <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="w-28 shrink-0 truncate font-semibold text-ink">{l.title}</span>
                  <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] uppercase text-steel">{l.stage}</span>
                  <span className="min-w-0 flex-1 truncate text-steel">{l.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* audit trail */}
        <section className="mt-6">
          <h2 className="text-meta uppercase tracking-wide text-steel">Audit trail · last {s?.audit.length ?? 0}</h2>
          <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white shadow-panel">
            {(s?.audit ?? []).map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                <span className={`w-12 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[9px] font-semibold uppercase ${ACTOR[a.actor] ?? "bg-stone-200 text-steel"}`}>
                  {a.actor}
                </span>
                <span className="w-28 shrink-0 truncate font-semibold text-ink">{a.action}</span>
                <span className="min-w-0 flex-1 truncate text-steel">{a.reason}</span>
                <span className="shrink-0 text-[10px] text-steel">{rel(a.createdAt)}</span>
              </li>
            ))}
            {(s?.audit ?? []).length === 0 ? <li className="px-3 py-2 text-[11px] text-steel">No decisions logged yet.</li> : null}
          </ul>
        </section>
      </div>
    </div>
  );
}
