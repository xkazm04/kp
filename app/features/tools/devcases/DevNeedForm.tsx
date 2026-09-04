"use client";

import Link from "next/link";
import { AlertTriangle, Loader2, Plus, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { MAX_CODEBASES } from "@/app/_lib/devcase-constraints";
import { isSupportedRepoRef } from "./DevHelpers";
import { useSeniorityLabel } from "./DevLabels";
import { Field } from "./DevShared";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import type { JdSummary, SelectedJd } from "./DevTypes";
import type { Task } from "@/app/features/shell/tasks/TasksProvider";

export function NeedForm({
  jds,
  jd,
  jdLoading,
  pickJd,
  jdsError,
  reloadJds,
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
  jdsError: string | null;
  reloadJds: () => void;
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
  const tJds = useTranslations("devcase.studio.jds");
  // The ENTRANCE to the whole devcase loop, and every word of it was English in a
  // four-locale studio — including the two aria-labels that are a screen-reader
  // user's only name for the JD and seniority pickers.
  const t = useTranslations("devcase.studio.need");
  const seniorityLabel = useSeniorityLabel();
  return (
    <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <Field label={t("jdLabel")}>
        {/* A failed library fetch is NOT an empty library. Without this the entrance
            pointed the operator at "save one" in a library that already had some, and
            the retry was a full page reload. */}
        {jdsError ? (
          <p
            role="alert"
            className="flex flex-wrap items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50/70 p-2 text-sm text-amber-800"
          >
            <AlertTriangle size={13} className="shrink-0" />
            {jdsError}
            <button
              type="button"
              onClick={reloadJds}
              className="focus-ring font-semibold text-coral underline-offset-2 hover:underline"
            >
              {tJds("retry")}
            </button>
          </p>
        ) : jds.length === 0 ? (
          <p className="rounded-md border border-dashed border-stone-300 bg-white p-2 text-sm text-steel">
            {/* One sentence with one link inside it, so a translator can put the link
                where their grammar wants it instead of receiving three fragments.
                The link goes to the AUTHORING tab: "no JDs saved" is answered by
                writing one, and the ledger it used to point at is where one lands. */}
            {t.rich("noJds", {
              link: (chunks) => (
                <Link href="/?tab=intake" className="font-semibold text-coral underline-offset-2 hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : (
          <>
            <Select
              ariaLabel={t("savedJdAria")}
              value={jd?.slug ?? ""}
              onChange={pickJd}
              invalid={jd == null}
              className="w-full"
              options={[
                { value: "", label: t("pickJd") },
                ...jds.map((j) => ({ value: j.slug, label: j.title.length > 44 ? `${j.title.slice(0, 42)}…` : j.title })),
              ]}
            />
            {jdLoading ? (
              <p className="mt-1 flex items-center gap-1 text-micro text-steel">
                <Loader2 size={11} className="animate-spin" /> {t("loadingJd")}
              </p>
            ) : jd ? (
              <p className="mt-1 text-micro text-steel">{t("jdReadHint")}</p>
            ) : (
              <p className="mt-1 text-micro text-steel">{t("jdRequired")}</p>
            )}
          </>
        )}
      </Field>

      <Field label={t("codebasesLabel", { max: MAX_CODEBASES })}>
        <div className="space-y-1.5">
          {repoUrls.map((url, i) => (
            <div key={i}>
              <div className="flex items-center gap-1.5">
                <TextInput
                  value={url}
                  onChange={(e) => setRepoUrl(i, e.target.value)}
                  placeholder={t("repoPlaceholder")}
                  aria-label={t("codebaseAria", { n: i + 1 })}
                  invalid={url.trim() !== "" && !isSupportedRepoRef(url)}
                />
                {repoUrls.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeRepo(i)}
                    aria-label={t("removeCodebaseAria", { n: i + 1 })}
                    className="focus-ring shrink-0 rounded-md border border-stone-200 p-2 text-steel hover:border-coral/40 hover:text-coral"
                  >
                    <X size={13} />
                  </button>
                ) : null}
              </div>
              {url.trim() !== "" && !isSupportedRepoRef(url) ? (
                <p className="mt-1 text-micro text-amber-700">{t("unsupportedRepo")}</p>
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
            <Plus size={13} /> {t("addCodebase")}
          </button>
        ) : null}
      </Field>

      <Field label={t("seniorityLabel")}>
        <Select
          ariaLabel={t("seniorityAria")}
          value={seniority}
          onChange={setSeniority}
          className="w-full"
          options={["junior", "medior", "senior", "lead"].map((s) => ({ value: s, label: seniorityLabel(s) }))}
        />
      </Field>
      <button
        type="button"
        onClick={runLifecycle}
        disabled={lifecycleActive || jdMissing}
        title={t("lifecycleTitle")}
        className="focus-ring inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-coral text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {lifecycleActive ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        {lifecycleActive ? t("lifecycleRunning") : t("runLifecycle")}
      </button>
      <button type="button" onClick={submit} disabled={running || jdMissing}
        className="focus-ring inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 bg-white text-base font-semibold text-ink hover:border-coral/40 disabled:opacity-50">
        {running ? <Loader2 size={14} className="animate-spin" /> : null}
        {running ? t("reflecting") : t("analyzeOnly")}
      </button>

      {needTasks.length > 0 ? (
        <div className="border-t border-stone-100 pt-2">
          <p className="text-micro font-semibold uppercase tracking-wide text-steel">{t("recent")}</p>
          <ul className="mt-1 space-y-0.5">
            {/* `task`, not `t` — the translator now owns that name in this scope. */}
            {needTasks.slice(0, 6).map((task) => (
              <li key={task.id}>
                <button type="button" onClick={() => selectNeed(task.id)}
                  className={`focus-ring w-full truncate rounded px-1.5 py-1 text-left text-sm ${
                    viewed?.id === task.id ? "bg-coral/10 text-coral" : "text-ink/80 hover:bg-paper"
                  }`}>
                  {task.label?.replace("Need analysis · ", "") || task.id}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
