"use client";

import Link from "next/link";
import { Loader2, Plus, Sparkles, X } from "lucide-react";
import { MAX_CODEBASES } from "@/app/_lib/devcase-constraints";
import { isSupportedRepoRef } from "./DevHelpers";
import { Field } from "./DevShared";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import type { JdSummary, SelectedJd } from "./DevTypes";
import type { Task } from "@/app/features/tasks/TasksProvider";

export function NeedForm({
  jds,
  jd,
  jdLoading,
  pickJd,
  repoUrls,
  setRepoUrl,
  addRepo,
  removeRepo,
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
  jds: JdSummary[];
  jd: SelectedJd | null;
  jdLoading: boolean;
  pickJd: (slug: string) => void;
  repoUrls: string[];
  setRepoUrl: (index: number, value: string) => void;
  addRepo: () => void;
  removeRepo: (index: number) => void;
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
  // A JD must be picked AND its body loaded before anything can run — the JD is the
  // need's metadata (title + stack + responsibilities), not an optional attachment.
  const jdMissing = jd == null || jdLoading;
  return (
    <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <Field label="Job description *">
        {jds.length === 0 ? (
          <p className="rounded-md border border-dashed border-stone-300 bg-white p-2 text-sm text-steel">
            No JDs saved.{" "}
            <Link href="/?tab=library" className="font-semibold text-coral underline-offset-2 hover:underline">
              Save one
            </Link>{" "}
            in the library first — the role and case are designed from it.
          </p>
        ) : (
          <>
            <Select
              ariaLabel="Saved JD"
              value={jd?.slug ?? ""}
              onChange={pickJd}
              invalid={jd == null}
              className="w-full"
              options={[
                { value: "", label: "Pick a saved JD…" },
                ...jds.map((j) => ({ value: j.slug, label: j.title.length > 44 ? `${j.title.slice(0, 42)}…` : j.title })),
              ]}
            />
            {jdLoading ? (
              <p className="mt-1 flex items-center gap-1 text-micro text-steel">
                <Loader2 size={11} className="animate-spin" /> Loading the JD…
              </p>
            ) : jd ? (
              <p className="mt-1 text-micro text-steel">
                Role title, stack and responsibilities are read from this JD.
              </p>
            ) : (
              <p className="mt-1 text-micro text-steel">A job description is required to run.</p>
            )}
          </>
        )}
      </Field>

      <Field label={`Codebases (GitHub, up to ${MAX_CODEBASES})`}>
        <div className="space-y-1.5">
          {repoUrls.map((url, i) => (
            <div key={i}>
              <div className="flex items-center gap-1.5">
                <TextInput
                  value={url}
                  onChange={(e) => setRepoUrl(i, e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  aria-label={`Codebase ${i + 1}`}
                  invalid={url.trim() !== "" && !isSupportedRepoRef(url)}
                />
                {repoUrls.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeRepo(i)}
                    aria-label={`Remove codebase ${i + 1}`}
                    className="focus-ring shrink-0 rounded-md border border-stone-200 p-2 text-steel hover:border-coral/40 hover:text-coral"
                  >
                    <X size={13} />
                  </button>
                ) : null}
              </div>
              {url.trim() !== "" && !isSupportedRepoRef(url) ? (
                <p className="mt-1 text-micro text-amber-700">
                  Only GitHub is supported for grounding — this ref will be skipped.
                </p>
              ) : null}
            </div>
          ))}
        </div>
        {repoUrls.length < MAX_CODEBASES ? (
          <button
            type="button"
            onClick={addRepo}
            className="focus-ring mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold text-coral hover:bg-coral/5"
          >
            <Plus size={13} /> Add codebase
          </button>
        ) : null}
      </Field>

      <Field label="Seniority target">
        <Select
          ariaLabel="Seniority"
          value={seniority}
          onChange={setSeniority}
          className="w-full"
          options={["junior", "medior", "senior", "lead"].map((s) => ({ value: s, label: s }))}
        />
      </Field>
      <button
        type="button"
        onClick={runLifecycle}
        disabled={lifecycleActive || jdMissing}
        title="Automated lifecycle: analyze → design → policy gate → publish → (on submissions) evaluate → rank → promote to Decisions"
        className="focus-ring inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-coral text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {lifecycleActive ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        {lifecycleActive ? "Lifecycle running…" : "▶ Run automated lifecycle"}
      </button>
      <button type="button" onClick={submit} disabled={running || jdMissing}
        className="focus-ring inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 bg-white text-base font-semibold text-ink hover:border-coral/40 disabled:opacity-50">
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
                  className={`focus-ring w-full truncate rounded px-1.5 py-1 text-left text-sm ${
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
