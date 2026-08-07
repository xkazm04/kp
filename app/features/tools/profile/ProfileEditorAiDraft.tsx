"use client";

// AI-assisted draft panel split out of ProfileEditor.tsx: owns its own open/text/loading/
// error/note state and the /api/profile/draft fetch; hands the hydrated draft back to the
// parent editor via onApplied so the parent's form state stays the single source of truth.
import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";
import { Textarea } from "./ProfileFields";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useErrorMessage } from "@/app/_lib/use-error-message";

export type ProfileDraft = {
  profile: ProfilePayload;
  signals?: { isEnrolled?: boolean; expectedGraduation?: string | null; wantsDomainChange?: boolean; hasSubstantialExperience?: boolean };
  archetype?: string;
};

export function ProfileEditorAiDraft({ onApplied }: { onApplied: (draft: ProfileDraft) => void }) {
  const t = useTranslations("profile.editor");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const enumLabel = useEnumLabel();

  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const runDraft = async () => {
    if (!aiText.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    setAiNote(null);
    try {
      const r = await fetch("/api/profile/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiText }),
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(errMsg(payload, t("draftFailedStatus", { status: r.status })));
      onApplied(payload);
      const label = enumLabel("archetype", payload.archetype);
      setAiNote(t("draftedAs", { label, pct: Math.round((payload.confidence ?? 0) * 100) }));
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : t("aiDraftFailed"));
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-3">
      <button
        type="button"
        onClick={() => setAiOpen((v) => !v)}
        aria-expanded={aiOpen}
        className="focus-ring flex w-full items-center gap-2 rounded text-left text-sm font-semibold text-ink"
      >
        <Sparkles size={15} className="text-coral" aria-hidden />
        {t("draftToggle")}
        <span className="ml-1 font-normal text-steel">{t("draftHint")}</span>
        <span className="ml-auto text-steel">{aiOpen ? "−" : "+"}</span>
      </button>
      {aiOpen ? (
        <div className="mt-2.5">
          <Textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            rows={4}
            placeholder={t("draftPlaceholder")}
            className="bg-white px-3 py-2 text-ink"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runDraft}
              disabled={aiLoading || !aiText.trim()}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel disabled:opacity-40"
            >
              <Wand2 size={14} /> {aiLoading ? t("drafting") : t("draftWithAi")}
            </button>
            <span className="text-sm text-steel">{t("draftSavedHint")}</span>
          </div>
          {aiNote ? <p className="mt-2 text-sm font-medium text-moss" role="status">{aiNote}</p> : null}
          {aiError ? <p className="mt-2 text-sm text-red-700" role="alert">{aiError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
