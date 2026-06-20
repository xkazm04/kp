"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, FileSignature, ListChecks, Plus, Trash2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { ONBOARDING_PRESETS, type OnboardingTask, type OnboardingTaskState, type QuestionnaireField } from "@/app/_lib/onboarding";

type HiredCandidate = { entryId: string; candidateLabel: string | null; jobTitle: string | null; runId: string | null };
type RunSummary = {
  id: string;
  candidateLabel: string | null;
  jobTitle: string | null;
  status: string;
  progress: { done: number; total: number; pct: number; complete: boolean };
};
type Signature = { id: string; document: string; status: string; signer: string | null; signedAt: string | null };
type Template = { id: string; name: string; tasks: OnboardingTask[]; questionnaire: QuestionnaireField[] };
type RunDetail = {
  run: { id: string; candidateLabel: string | null; jobTitle: string | null; status: string };
  tasks: OnboardingTask[];
  questionnaire: QuestionnaireField[];
  states: OnboardingTaskState[];
  intake: Record<string, string> | null;
  signatures: Signature[];
  progress: { done: number; total: number; pct: number; complete: boolean };
};

export function OnboardingTab() {
  const t = useTranslations("onboarding");
  const [hired, setHired] = useState<HiredCandidate[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applyData = useCallback((p: { hired?: HiredCandidate[]; runs?: RunSummary[]; templates?: Template[] }) => {
    setHired(p.hired ?? []);
    setRuns(p.runs ?? []);
    const tpls = p.templates ?? [];
    setTemplates(tpls);
    setTemplateId((cur) => cur || tpls[0]?.id || "");
    setLoading(false);
  }, []);

  const reload = useCallback(async () => {
    const r = await fetch("/api/onboarding");
    applyData(await r.json());
  }, [applyData]);

  // Mount load inlined as an async IIFE (setState lands after the await — the
  // allowed effect shape); `reload` covers the handler re-fetches.
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch("/api/onboarding");
      const p = await r.json();
      if (!live) return;
      applyData(p);
    })();
    return () => {
      live = false;
    };
  }, [applyData]);

  const start = async (entryId: string) => {
    const r = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId, templateId: templateId || undefined }),
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
            {toOnboard.length > 0 && templates.length > 0 ? (
              <label className="mt-2 flex flex-wrap items-center gap-2 text-sm text-steel">
                {t("withTemplate")}
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="focus-ring rounded-md border border-stone-200 bg-white px-2 py-1 text-sm text-ink"
                >
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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

          <section className="mt-8">
            <div className="flex items-center justify-between gap-2">
              <p className="text-meta uppercase tracking-wide text-steel">{t("templatesTitle")}</p>
              {!newOpen ? (
                <button
                  type="button"
                  onClick={() => setNewOpen(true)}
                  className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-coral hover:bg-coral/5"
                >
                  <Plus size={14} /> {t("newTemplate")}
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-steel">{t("templatesNote")}</p>
            {newOpen ? (
              <TemplateManager
                onCancel={() => setNewOpen(false)}
                onSaved={async (id) => {
                  setNewOpen(false);
                  await reload();
                  setTemplateId(id);
                }}
              />
            ) : null}
            <ul className="mt-3 space-y-2" role="list">
              {templates.map((tpl) => (
                <li key={tpl.id} className="rounded-md border border-stone-200 bg-white p-3">
                  <p className="font-semibold text-ink">{tpl.name}</p>
                  <p className="text-meta text-steel">{t("templateMeta", { tasks: tpl.tasks.length, questions: tpl.questionnaire.length })}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

// Editable add/remove text-row list, shared by the template editor's tasks +
// questionnaire (module-level so typing doesn't remount the inputs / lose focus).
function EditableRows({
  items,
  onChange,
  placeholder,
  addLabel,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
}) {
  return (
    <div className="mt-1.5 space-y-1.5">
      {items.map((val, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={val}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
            className="focus-ring h-8 flex-1 rounded-md border border-stone-200 bg-white px-2 text-sm text-ink"
          />
          <button
            type="button"
            aria-label="remove"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="focus-ring rounded-md p-1 text-steel hover:text-coral"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ""])} className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline">
        <Plus size={12} /> {addLabel}
      </button>
    </div>
  );
}

// Create an onboarding template from an industry preset, then edit its tasks +
// pre-boarding questionnaire (P1-4 — the questionnaire is editable data, no longer a
// frozen const). Sends label-only rows; the store derives ids/keys + bounds them.
function TemplateManager({ onCancel, onSaved }: { onCancel: () => void; onSaved: (id: string) => void }) {
  const t = useTranslations("onboarding");
  const [name, setName] = useState("");
  const [tasks, setTasks] = useState<string[]>([""]);
  const [questions, setQuestions] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (id: string) => {
    const preset = ONBOARDING_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setName(preset.name);
    setTasks(preset.tasks.map((x) => x.label));
    setQuestions(preset.questionnaire.map((x) => x.label));
  };

  const save = async () => {
    const cleanTasks = tasks.map((l) => l.trim()).filter(Boolean);
    if (!name.trim()) return setError(t("nameRequired"));
    if (cleanTasks.length === 0) return setError(t("needTask"));
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_template",
          name: name.trim(),
          tasks: cleanTasks.map((label) => ({ label })),
          questionnaire: questions.map((l) => l.trim()).filter(Boolean).map((label) => ({ label })),
        }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || t("saveFailed"));
      onSaved(p.template.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-md border border-coral/30 bg-coral/5 p-3">
      <label className="block text-sm font-semibold text-steel">
        {t("fromPreset")}
        <select
          defaultValue=""
          onChange={(e) => applyPreset(e.target.value)}
          className="focus-ring ml-2 rounded-md border border-stone-200 bg-white px-2 py-1 text-sm font-normal text-ink"
        >
          <option value="" disabled>
            {t("choosePreset")}
          </option>
          {ONBOARDING_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.industry}
            </option>
          ))}
        </select>
      </label>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("templateNamePlaceholder")}
        className="focus-ring mt-3 h-9 w-full rounded-md border border-stone-200 bg-white px-2.5 text-sm font-semibold text-ink"
      />

      <p className="mt-3 text-meta uppercase tracking-wide text-steel">{t("tasksLabel")}</p>
      <EditableRows items={tasks} onChange={setTasks} placeholder={t("taskPlaceholder")} addLabel={t("addTask")} />

      <p className="mt-3 text-meta uppercase tracking-wide text-steel">{t("questionsLabel")}</p>
      <EditableRows items={questions} onChange={setQuestions} placeholder={t("questionPlaceholder")} addLabel={t("addQuestion")} />

      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="focus-ring inline-flex h-9 items-center rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
        >
          {saving ? t("saving") : t("saveTemplate")}
        </button>
        <button type="button" onClick={onCancel} className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel hover:bg-stone-50">
          {t("cancel")}
        </button>
      </div>
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
          {detail.questionnaire.map((field) => (
            <label key={field.key} className="block">
              <span className="text-meta text-steel">{fieldLabels[field.key] ?? field.label}</span>
              <input
                type="text"
                value={answers[field.key] ?? ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [field.key]: e.target.value }))}
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
