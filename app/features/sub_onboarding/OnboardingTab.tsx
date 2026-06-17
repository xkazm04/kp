"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, FileSignature, ListChecks, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { ENTRY_QUESTIONNAIRE_FIELDS, type OnboardingTask, type OnboardingTaskState } from "@/app/_lib/onboarding";

type HiredCandidate = { entryId: string; candidateLabel: string | null; jobTitle: string | null; runId: string | null };
type RunSummary = {
  id: string;
  candidateLabel: string | null;
  jobTitle: string | null;
  status: string;
  progress: { done: number; total: number; pct: number; complete: boolean };
};
type Signature = { id: string; document: string; status: string; signer: string | null; signedAt: string | null };
type RunDetail = {
  run: { id: string; candidateLabel: string | null; jobTitle: string | null; status: string };
  tasks: OnboardingTask[];
  states: OnboardingTaskState[];
  intake: Record<string, string> | null;
  signatures: Signature[];
  progress: { done: number; total: number; pct: number; complete: boolean };
};

export function OnboardingTab() {
  const t = useTranslations("onboarding");
  const [hired, setHired] = useState<HiredCandidate[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const r = await fetch("/api/onboarding");
    const p = await r.json();
    setHired(p.hired ?? []);
    setRuns(p.runs ?? []);
    setLoading(false);
  }, []);

  // Mount load inlined as an async IIFE (setState lands after the await — the
  // allowed effect shape); `reload` covers the handler re-fetches.
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch("/api/onboarding");
      const p = await r.json();
      if (!live) return;
      setHired(p.hired ?? []);
      setRuns(p.runs ?? []);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  const start = async (entryId: string) => {
    const r = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId }),
    });
    const p = await r.json();
    await reload();
    if (p.run?.id) setSelected(p.run.id);
  };

  if (selected) {
    return <RunDetailView runId={selected} onBack={() => { setSelected(null); void reload(); }} />;
  }

  const toOnboard = hired.filter((h) => !h.runId);

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-meta uppercase tracking-wide text-coral">{t("eyebrow")}</p>
      <h1 className="mt-1 font-serif text-display text-ink">{t("title")}</h1>
      <p className="mt-1 text-base text-steel">{t("intro")}</p>

      {loading ? (
        <p className="mt-6 text-base text-steel">{t("loading")}</p>
      ) : (
        <>
          <section className="mt-6">
            <p className="text-meta uppercase tracking-wide text-steel">{t("readyTitle")}</p>
            {toOnboard.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed border-stone-300 p-3 text-sm text-steel">{t("readyEmpty")}</p>
            ) : (
              <ul className="mt-2 space-y-2" role="list">
                {toOnboard.map((h) => (
                  <li key={h.entryId} className="flex items-center justify-between gap-2 rounded-md border border-stone-200 bg-white p-3">
                    <div>
                      <p className="font-semibold text-ink">{h.candidateLabel ?? t("aCandidate")}</p>
                      {h.jobTitle ? <p className="text-meta text-steel">{h.jobTitle}</p> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void start(h.entryId)}
                      className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel"
                    >
                      <UserPlus size={14} /> {t("startCta")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <p className="text-meta uppercase tracking-wide text-steel">{t("runsTitle")}</p>
            {runs.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed border-stone-300 p-3 text-sm text-steel">{t("runsEmpty")}</p>
            ) : (
              <ul className="mt-2 space-y-2" role="list">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(r.id)}
                      className="focus-ring flex w-full items-center justify-between gap-3 rounded-md border border-stone-200 bg-white p-3 text-left hover:border-coral/40"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-semibold text-ink">
                          {r.candidateLabel ?? t("aCandidate")}
                          {r.progress.complete ? (
                            <span className="rounded-full bg-moss/15 px-2 py-0.5 text-meta font-semibold uppercase text-moss">
                              {t("complete")}
                            </span>
                          ) : null}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="h-1.5 w-32 overflow-hidden rounded-full bg-stone-100">
                            <span className="block h-full rounded-full bg-coral" style={{ width: `${r.progress.pct}%` }} />
                          </span>
                          <span className="text-meta text-steel">{t("progress", { done: r.progress.done, total: r.progress.total })}</span>
                        </div>
                      </div>
                      <ChevronRight size={16} className="shrink-0 text-steel" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function RunDetailView({ runId, onBack }: { runId: string; onBack: () => void }) {
  const t = useTranslations("onboarding");
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [doc, setDoc] = useState("");

  // Load the run detail on mount / when the selected run changes — inline IIFE so
  // setState lands after the await (the allowed effect shape). patch() refreshes
  // detail directly thereafter, so no separate reusable loader is needed.
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch(`/api/onboarding/${encodeURIComponent(runId)}`);
      const p = (await r.json()) as RunDetail;
      if (!live) return;
      setDetail(p);
      setAnswers(p.intake ?? {});
    })();
    return () => {
      live = false;
    };
  }, [runId]);

  const patch = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/onboarding/${encodeURIComponent(runId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setDetail((await r.json()) as RunDetail);
  };

  if (!detail) return <p className="mx-auto max-w-3xl text-base text-steel">{t("loading")}</p>;

  const doneIds = new Set(detail.states.filter((s) => s.done).map((s) => s.taskId));
  // next-intl rejects template-literal keys → resolve field labels via a literal map.
  const fieldLabels: Record<string, string> = {
    preferredName: t("field.preferredName"),
    tshirtSize: t("field.tshirtSize"),
    dietaryNeeds: t("field.dietaryNeeds"),
    equipmentPrefs: t("field.equipmentPrefs"),
    emergencyContact: t("field.emergencyContact"),
    startDateConfirm: t("field.startDateConfirm"),
  };

  return (
    <div className="mx-auto max-w-3xl">
      <button type="button" onClick={onBack} className="focus-ring text-sm font-semibold text-coral hover:underline">
        ← {t("back")}
      </button>
      <h1 className="mt-2 font-serif text-h1 text-ink">{detail.run.candidateLabel ?? t("aCandidate")}</h1>
      {detail.run.jobTitle ? <p className="mt-0.5 text-base text-steel">{detail.run.jobTitle}</p> : null}

      {/* Checklist */}
      <section className="mt-6 rounded-md border border-stone-200 bg-white p-4">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <ListChecks size={13} /> {t("checklist")} · {t("progress", { done: detail.progress.done, total: detail.progress.total })}
        </p>
        <ul className="mt-3 space-y-2" role="list">
          {detail.tasks.map((task) => {
            const done = doneIds.has(task.id);
            return (
              <li key={task.id}>
                <label className="flex cursor-pointer items-center gap-2.5 text-base text-ink">
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={(e) => void patch({ action: "task", taskId: task.id, done: e.target.checked })}
                    className="h-4 w-4 accent-coral"
                  />
                  <span className={done ? "text-steel line-through" : ""}>{task.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Pre-boarding entry questionnaire */}
      <section className="mt-6 rounded-md border border-stone-200 bg-white p-4">
        <p className="text-meta uppercase tracking-wide text-steel">{t("questionnaire")}</p>
        <p className="mt-1 text-sm text-steel">{t("questionnaireNote")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {ENTRY_QUESTIONNAIRE_FIELDS.map((field) => (
            <label key={field} className="block">
              <span className="text-meta text-steel">{fieldLabels[field]}</span>
              <input
                type="text"
                value={answers[field] ?? ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [field]: e.target.value }))}
                onBlur={() => void patch({ action: "intake", answers })}
                className="focus-ring mt-1 w-full rounded-md border border-stone-200 bg-white p-2 text-sm text-ink"
              />
            </label>
          ))}
        </div>
      </section>

      {/* E-signature (provider seam) */}
      <section className="mt-6 rounded-md border border-stone-200 bg-white p-4">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <FileSignature size={13} /> {t("signatures")}
        </p>
        <p className="mt-1 rounded-md bg-amber-50 px-2.5 py-1.5 text-meta text-amber-800">{t("signSeamNote")}</p>
        {detail.signatures.length > 0 ? (
          <ul className="mt-3 space-y-2" role="list">
            {detail.signatures.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-base">
                <span className="text-ink">{s.document}</span>
                {s.status === "signed" ? (
                  <span className="inline-flex items-center gap-1 text-meta font-semibold uppercase text-moss">
                    <Check size={13} /> {t("signed")}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void patch({ action: "sign", signatureId: s.id, signer: detail.run.candidateLabel ?? "Signed" })}
                    className="focus-ring rounded-md border border-stone-200 px-2.5 py-1 text-sm font-semibold text-coral hover:bg-coral/5"
                  >
                    {t("markSigned")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={doc}
            onChange={(e) => setDoc(e.target.value)}
            placeholder={t("docPlaceholder")}
            className="focus-ring h-9 min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-2 text-sm text-ink"
          />
          <button
            type="button"
            disabled={!doc.trim()}
            onClick={() => {
              void patch({ action: "request_sign", document: doc });
              setDoc("");
            }}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel disabled:opacity-40"
          >
            <FileSignature size={14} /> {t("requestSign")}
          </button>
        </div>
      </section>
    </div>
  );
}
