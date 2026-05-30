"use client";

import { Loader2, Sparkles } from "lucide-react";
import { isSupportedRepoRef } from "./DevHelpers";
import { Field } from "./DevShared";
import type { Task } from "@/app/features/tasks/TasksProvider";

export function NeedForm({
  title,
  setTitle,
  stackStr,
  setStackStr,
  respStr,
  setRespStr,
  repoUrl,
  setRepoUrl,
  seniority,
  setSeniority,
  runLifecycle,
  lifecycleActive,
  submit,
  running,
  needTasks,
  viewed,
  selectNeed,
}: {
  title: string;
  setTitle: (v: string) => void;
  stackStr: string;
  setStackStr: (v: string) => void;
  respStr: string;
  setRespStr: (v: string) => void;
  repoUrl: string;
  setRepoUrl: (v: string) => void;
  seniority: string;
  setSeniority: (v: string) => void;
  runLifecycle: () => void;
  lifecycleActive: boolean;
  submit: () => void;
  running: boolean;
  needTasks: Task[];
  viewed: Task | null;
  selectNeed: (id: string) => void;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <Field label="Role title *">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Backend Engineer"
          aria-invalid={title.trim() === ""}
          className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm" />
        {title.trim() === "" ? (
          <p className="mt-1 text-micro text-steel">A role title is required to run.</p>
        ) : null}
      </Field>
      <Field label="Stack (comma-separated)">
        <input value={stackStr} onChange={(e) => setStackStr(e.target.value)} placeholder="Python, Django, PostgreSQL"
          className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm" />
      </Field>
      <Field label="Responsibilities (one per line)">
        <textarea value={respStr} onChange={(e) => setRespStr(e.target.value)} rows={3} placeholder={"Own the ingest pipeline\nReview PRs"}
          className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm" />
      </Field>
      <Field label="Codebase (GitHub URL)">
        <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo"
          aria-invalid={repoUrl.trim() !== "" && !isSupportedRepoRef(repoUrl)}
          className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm" />
        {repoUrl.trim() !== "" && !isSupportedRepoRef(repoUrl) ? (
          <p className="mt-1 text-micro text-amber-700">
            Only GitHub is supported for grounding — this will run ungrounded at low confidence.
          </p>
        ) : null}
      </Field>
      <Field label="Seniority target">
        <select value={seniority} onChange={(e) => setSeniority(e.target.value)}
          className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm">
          {["junior", "medior", "senior", "lead"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </Field>
      <button
        type="button"
        onClick={runLifecycle}
        disabled={lifecycleActive || title.trim() === ""}
        title="Automated lifecycle: analyze → design → policy gate → publish → (on submissions) evaluate → rank → promote to Decisions"
        className="focus-ring inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-coral text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {lifecycleActive ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        {lifecycleActive ? "Lifecycle running…" : "▶ Run automated lifecycle"}
      </button>
      <button type="button" onClick={submit} disabled={running || title.trim() === ""}
        className="focus-ring inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 bg-white text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50">
        {running ? <Loader2 size={14} className="animate-spin" /> : null}
        {running ? "Reflecting…" : "Analyze need only"}
      </button>

      {needTasks.length > 0 ? (
        <div className="border-t border-stone-100 pt-2">
          <p className="text-micro font-semibold uppercase tracking-wide text-steel">Recent</p>
          <ul className="mt-1 space-y-0.5">
            {needTasks.slice(0, 6).map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => selectNeed(t.id)}
                  className={`focus-ring w-full truncate rounded px-1.5 py-1 text-left text-xs ${
                    viewed?.id === t.id ? "bg-coral/10 text-coral" : "text-ink/80 hover:bg-paper"
                  }`}>
                  {t.label?.replace("Need analysis · ", "") || t.id}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
