"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ONBOARDING_PRESETS } from "@/app/_lib/onboarding";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";

// Tier 3 (docs/design/loading-choreography.md): this is a click-only editor — nobody
// sees it until "New template" is pressed — so it lives in its own chunk and
// is code-split out of the tab's initial bundle (see the next/dynamic import
// in OnboardingTab.tsx).

// F16 — an editor row carries the canonical id/key its text came from, or null when
// the recruiter authored/edited it. That reference is what survives into the DB row
// and lets every reader resolve the label in THEIR language (app/_lib/onboarding.ts
// header). Editing the text drops the ref on purpose: a recruiter who rewrote
// "Order laptop and equipment" must not have their wording silently replaced by the
// catalog's the next time someone opens the run.
type EditorRow = { ref: string | null; label: string };
const authored = (label: string): EditorRow => ({ ref: null, label });

// Editable add/remove text-row list, shared by the template editor's tasks +
// questionnaire (module-level so typing doesn't remount the inputs / lose focus).
function EditableRows({
  items,
  onChange,
  placeholder,
  addLabel,
  removeLabel,
}: {
  items: EditorRow[];
  onChange: (next: EditorRow[]) => void;
  placeholder: string;
  addLabel: string;
  removeLabel: string;
}) {
  return (
    <div className="mt-1.5 space-y-1.5">
      {items.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <TextInput
            type="text"
            value={row.label}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((v, j) => (j === i ? authored(e.target.value) : v)))}
            sizeVariant="sm"
            className="flex-1"
          />
          <button
            type="button"
            aria-label={removeLabel}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="focus-ring rounded-md p-1 text-steel hover:text-coral"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, authored("")])} className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline">
        <Plus size={12} /> {addLabel}
      </button>
    </div>
  );
}

// Create an onboarding template from an industry preset, then edit its tasks +
// pre-boarding questionnaire (P1-4 — the questionnaire is editable data, no longer a
// frozen const). Sends each row's canonical id/key when it still has one (F16), so
// the store keeps the reference the render sites localize from; an authored row goes
// label-only and the store derives + bounds its id/key.
export function TemplateManager({ onCancel, onSaved }: { onCancel: () => void; onSaved: (id: string) => void }) {
  const t = useTranslations("onboarding");
  // Save failures resolve from the machine `code`, never the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [name, setName] = useState("");
  const [tasks, setTasks] = useState<EditorRow[]>([authored("")]);
  const [questions, setQuestions] = useState<EditorRow[]>([authored("")]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The preset's own copy, in the language of the recruiter filling the form in — the
  // dropdown and these prefilled inputs are UI, and the recruiter has to be able to
  // read what they are about to save. The catalog key travels alongside as `ref`, so
  // what lands in the DB is the reference, not this rendering of it.
  const presetLabel = (prefix: "task" | "field", ref: string, fallback: string) => {
    const key = `${prefix}.${ref}`;
    return t.has(key as Parameters<typeof t.has>[0]) ? t(key as Parameters<typeof t>[0]) : fallback;
  };
  const presetName = (p: (typeof ONBOARDING_PRESETS)[number]) => {
    const key = `preset.${p.id}.name`;
    return t.has(key as Parameters<typeof t.has>[0]) ? t(key as Parameters<typeof t>[0]) : p.name;
  };
  const presetIndustry = (p: (typeof ONBOARDING_PRESETS)[number]) => {
    const key = `preset.${p.id}.industry`;
    return t.has(key as Parameters<typeof t.has>[0]) ? t(key as Parameters<typeof t>[0]) : p.industry;
  };

  const applyPreset = (id: string) => {
    const preset = ONBOARDING_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setName(presetName(preset));
    setTasks(preset.tasks.map((x) => ({ ref: x.id, label: presetLabel("task", x.id, x.label) })));
    setQuestions(preset.questionnaire.map((x) => ({ ref: x.key, label: presetLabel("field", x.key, x.label) })));
  };

  const save = async () => {
    const clean = (rows: EditorRow[]) => rows.map((r) => ({ ...r, label: r.label.trim() })).filter((r) => r.label);
    const cleanTasks = clean(tasks);
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
          // An untouched preset row sends its canonical id/key; coerceTasks and
          // coerceQuestionnaire preserve an explicit one and only slugify a
          // label-only (authored) row.
          tasks: cleanTasks.map((row) => (row.ref ? { id: row.ref, label: row.label } : { label: row.label })),
          questionnaire: clean(questions).map((row) => (row.ref ? { key: row.ref, label: row.label } : { label: row.label })),
        }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(errMsg(p, t("saveFailed")));
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
        <Select
          ariaLabel={t("fromPreset")}
          value=""
          onChange={applyPreset}
          size="sm"
          className="ml-2 font-normal"
          options={[
            { value: "", label: t("choosePreset"), disabled: true },
            ...ONBOARDING_PRESETS.map((p) => ({ value: p.id, label: `${presetName(p)} — ${presetIndustry(p)}` })),
          ]}
        />
      </label>

      <TextInput
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("templateNamePlaceholder")}
        sizeVariant="sm"
        className="mt-3 font-semibold"
      />

      <p className="mt-3 text-meta uppercase tracking-wide text-steel">{t("tasksLabel")}</p>
      <EditableRows items={tasks} onChange={setTasks} placeholder={t("taskPlaceholder")} addLabel={t("addTask")} removeLabel={t("removeRow")} />

      <p className="mt-3 text-meta uppercase tracking-wide text-steel">{t("questionsLabel")}</p>
      <EditableRows
        items={questions}
        onChange={setQuestions}
        placeholder={t("questionPlaceholder")}
        addLabel={t("addQuestion")}
        removeLabel={t("removeRow")}
      />

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
