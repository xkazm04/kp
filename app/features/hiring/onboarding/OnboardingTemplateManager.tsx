"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ONBOARDING_PRESETS } from "@/app/_lib/onboarding";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";

// Tier 3 (docs/design/loading-choreography.md): this is a click-only editor — nobody
// sees it until "New template" is pressed — so it lives in its own chunk and
// is code-split out of the tab's initial bundle (see the next/dynamic import
// in OnboardingTab.tsx).

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
          <TextInput
            type="text"
            value={val}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
            sizeVariant="sm"
            className="flex-1"
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
export function TemplateManager({ onCancel, onSaved }: { onCancel: () => void; onSaved: (id: string) => void }) {
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
        <Select
          ariaLabel={t("fromPreset")}
          value=""
          onChange={applyPreset}
          size="sm"
          className="ml-2 font-normal"
          options={[
            { value: "", label: t("choosePreset"), disabled: true },
            ...ONBOARDING_PRESETS.map((p) => ({ value: p.id, label: `${p.name} — ${p.industry}` })),
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
