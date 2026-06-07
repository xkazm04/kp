"use client";

import { useState } from "react";
import { ArrowLeft, Sparkles, Wand2 } from "lucide-react";
import type { SkillRow, EvidenceRow, BuildResult, ProfilePayload } from "./ProfileTypes";
import {
  ARCHETYPE_CHOICES,
  ARCHETYPE_LABEL,
  ROLE_FAMILIES,
  EDU_LEVELS,
  SENIORITIES,
} from "./ProfileTypes";
import { Section, Text, Pick, Check, Textarea } from "./ProfileFields";
import { ProfileEvidenceColumn } from "./ProfileEvidenceColumn";
import { ResultPanel } from "./ProfileResultPanel";
import { hydrate, SKILL_FALLBACK, EVIDENCE_FALLBACK, archetypeFieldVisibility, archetypeScopedProfileFields } from "./ProfileForm";
import { SegmentedControl } from "@/app/_components/SegmentedControl";

export type EditorMode = "create" | "edit" | "duplicate";

export function ProfileEditor({
  mode,
  editingId,
  initialPayload,
  onSaved,
  onCancel,
}: {
  mode: EditorMode;
  editingId: string | null;
  initialPayload: ProfilePayload | null;
  onSaved: (savedId: string) => void;
  onCancel: () => void;
}) {
  // hydrate() maps a stored payload (edit/duplicate) — or null (blank create) —
  // into form state honestly: it never pre-fills education/languages/seniority the
  // candidate didn't declare, so a blank intake's completeness reflects real input
  // rather than unchosen defaults (idea-fa7d5360). Create and edit are identical now.
  const init = hydrate(initialPayload);

  const [choice, setChoice] = useState(init.choice);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [expectedGraduation, setExpectedGraduation] = useState("");
  const [wantsDomainChange, setWantsDomainChange] = useState(false);
  const [hasSubstantialExperience, setHasSubstantialExperience] = useState(false);

  const [displayName, setDisplayName] = useState(init.displayName);
  const [roleFamily, setRoleFamily] = useState(init.roleFamily);
  const [educationLevel, setEducationLevel] = useState(init.educationLevel);
  const [educationDetail, setEducationDetail] = useState(init.educationDetail);
  const [languages, setLanguages] = useState(init.languages);
  const [location, setLocation] = useState(init.location);
  const [availability, setAvailability] = useState(init.availability);
  const [yearsExperience, setYearsExperience] = useState(init.yearsExperience);
  const [seniority, setSeniority] = useState(init.seniority);
  const [aspirations, setAspirations] = useState(init.aspirations);

  const [skills, setSkills] = useState<SkillRow[]>(init.skills.length ? init.skills : SKILL_FALLBACK);
  const [evidence, setEvidence] = useState<EvidenceRow[]>(init.evidence.length ? init.evidence : EVIDENCE_FALLBACK);

  const [result, setResult] = useState<BuildResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI assist: draft the whole intake from free-text notes, then let the
  // recruiter edit before saving (AI proposes, human confirms).
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const isStudentish = choice === "student" || choice === "auto" || choice === "career_switcher";
  // Years/seniority visibility for the chosen archetype. The render conditions below
  // and build()'s submission both read this one map, so what is shown is exactly what
  // is saved — no hidden, retained state can leak into the payload (idea-7ac9e45f).
  const fieldVis = archetypeFieldVisibility(choice);

  // Push an AI (or any) hydrated draft into the live form fields. Reuses the same
  // payload→form mapping as edit/duplicate so there is one source of that logic.
  const applyDraft = (draft: {
    profile: ProfilePayload;
    signals?: { isEnrolled?: boolean; expectedGraduation?: string | null; wantsDomainChange?: boolean; hasSubstantialExperience?: boolean };
    archetype?: string;
  }) => {
    // A drafted profile is source data — reflect it faithfully so the AI's
    // omissions aren't backfilled with values the candidate never gave.
    const h = hydrate(draft.profile);
    setChoice(draft.archetype || h.choice);
    setDisplayName(h.displayName);
    setRoleFamily(h.roleFamily);
    setEducationLevel(h.educationLevel);
    setEducationDetail(h.educationDetail);
    setLanguages(h.languages);
    setLocation(h.location);
    setAvailability(h.availability);
    setYearsExperience(h.yearsExperience);
    setSeniority(h.seniority);
    setAspirations(h.aspirations);
    setSkills(h.skills.length ? h.skills : SKILL_FALLBACK);
    setEvidence(h.evidence.length ? h.evidence : EVIDENCE_FALLBACK);
    const s = draft.signals ?? {};
    setIsEnrolled(Boolean(s.isEnrolled));
    setExpectedGraduation(s.expectedGraduation ?? "");
    setWantsDomainChange(Boolean(s.wantsDomainChange));
    setHasSubstantialExperience(Boolean(s.hasSubstantialExperience));
  };

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
      if (!r.ok) throw new Error(payload.error ?? `Draft failed (${r.status}).`);
      applyDraft(payload);
      const label = ARCHETYPE_LABEL[payload.archetype] ?? payload.archetype;
      setAiNote(`Drafted as ${label} (${Math.round((payload.confidence ?? 0) * 100)}% confidence). Review and edit below, then Save.`);
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : "AI draft failed.");
    } finally {
      setAiLoading(false);
    }
  };

  const splitList = (s: string) =>
    s
      .split(/[,\n;]+/)
      .map((x) => x.trim())
      .filter(Boolean);

  // persist=false → dry-run preview (always POST, never writes). persist=true →
  // POST a new row (create/duplicate) or PUT the edited row.
  const build = async (persist: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const profile: Record<string, unknown> = {
        displayName: displayName || undefined,
        roleFamily,
        educationLevel,
        educationDetail,
        languages: splitList(languages),
        location: location || undefined,
        availability: availability || undefined,
        aspirations: splitList(aspirations),
        skillClaims: skills
          .filter((s) => s.skill.trim())
          .map((s) => ({ skill: s.skill.trim(), level: s.level, provenance: s.provenance })),
        evidence: evidence
          .filter((e) => e.title.trim() || e.text.trim())
          .map((e) => ({
            kind: e.kind,
            title: e.title.trim(),
            text: e.text.trim(),
            skills: splitList(e.skills),
            link: e.link.trim() || undefined,
          })),
      };
      // Submit years/seniority strictly by archetype visibility (idea-7ac9e45f): the
      // useState values persist across an archetype switch, but a field the form hid
      // for the selected archetype is never persisted. Shares its visibility source
      // with the inputs below, so the saved payload matches what is on screen.
      Object.assign(profile, archetypeScopedProfileFields(choice, yearsExperience, seniority));

      const signals = {
        selfDeclared: choice,
        isEnrolled,
        expectedGraduation: expectedGraduation || undefined,
        wantsDomainChange,
        hasSubstantialExperience,
      };

      const isEdit = persist && mode === "edit" && editingId;
      const r = await fetch("/api/profile", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { id: editingId, profile, signals } : { profile, signals, persist }),
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? `Build failed (${r.status}).`);
      setResult(payload as BuildResult);
      if (persist) {
        const savedId = (payload.saved as { id?: string } | null)?.id ?? editingId ?? "";
        onSaved(savedId);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Build failed.");
    } finally {
      setLoading(false);
    }
  };

  // Inline field validation: catch a non-numeric "years" (would POST NaN) and a
  // malformed graduation year before the request, and gate Save on validity.
  // Validate years only while the field is visible for the chosen archetype — a
  // stale, hidden value won't be submitted, so it must not block Save either.
  const yearsError =
    fieldVis.years && yearsExperience.trim() !== "" && !/^\d{1,2}(\.\d)?$/.test(yearsExperience.trim())
      ? "Enter a number (e.g. 6)."
      : undefined;
  const gradError =
    expectedGraduation.trim() !== "" && !/^(19|20)\d{2}$/.test(expectedGraduation.trim())
      ? "Enter a 4-digit year (e.g. 2026)."
      : undefined;
  const hasFieldErrors = Boolean(yearsError || gradError);

  const heading =
    mode === "edit" ? "Edit candidate profile" : mode === "duplicate" ? "Duplicate candidate profile" : "Build a candidate profile";
  const saveLabel = mode === "edit" ? "Save changes" : "Save profile";

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring -ml-1 inline-flex items-center gap-1 rounded text-sm font-semibold text-steel hover:text-coral"
        >
          <ArrowLeft size={14} /> Back to profiles
        </button>
        <h2 className="mt-2 font-serif text-display text-ink">{heading}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          A guided intake that works for students and career-switchers, not just experienced hires. We route the
          archetype, collect the signals a thin CV omits (projects, thesis, coursework, aspirations), tag each piece of
          evidence with its <strong>provenance</strong>, and score completeness so you know what to add next.
        </p>
      </header>

      <div className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-3">
        <button
          type="button"
          onClick={() => setAiOpen((v) => !v)}
          aria-expanded={aiOpen}
          className="focus-ring flex w-full items-center gap-2 rounded text-left text-sm font-semibold text-ink"
        >
          <Sparkles size={15} className="text-coral" aria-hidden />
          Draft from notes with AI
          <span className="ml-1 font-normal text-steel">— paste a CV blurb, LinkedIn, or notes; we structure + route it</span>
          <span className="ml-auto text-steel">{aiOpen ? "−" : "+"}</span>
        </button>
        {aiOpen ? (
          <div className="mt-2.5">
            <Textarea
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              rows={4}
              placeholder="e.g. 3rd-year CS student at ČVUT, expected 2026. Built a React recommender app for her thesis (on GitHub). Did a summer internship in Python. Wants a junior frontend role. Czech + English."
              className="bg-white px-3 py-2 text-ink"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={runDraft}
                disabled={aiLoading || !aiText.trim()}
                className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel disabled:opacity-40"
              >
                <Wand2 size={14} /> {aiLoading ? "Drafting…" : "Draft with AI"}
              </button>
              <span className="text-sm text-steel">Fills the fields below — nothing is saved until you click Save.</span>
            </div>
            {aiNote ? <p className="mt-2 text-sm font-medium text-moss" role="status">{aiNote}</p> : null}
            {aiError ? <p className="mt-2 text-sm text-red-700" role="alert">{aiError}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Section title="Who is this candidate?">
            <SegmentedControl
              label="Candidate archetype"
              value={choice}
              onChange={setChoice}
              options={ARCHETYPE_CHOICES.map((c) => ({ value: c.v, label: c.label }))}
            />
            {isStudentish ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Check label="Currently enrolled" checked={isEnrolled} onChange={setIsEnrolled} />
                <Text label="Expected graduation" value={expectedGraduation} onChange={setExpectedGraduation} placeholder="e.g. 2026" error={gradError} />
                <Check label="Wants to change field" checked={wantsDomainChange} onChange={setWantsDomainChange} />
                <Check label="Has prior pro experience" checked={hasSubstantialExperience} onChange={setHasSubstantialExperience} />
              </div>
            ) : null}
          </Section>

          <Section title="Basics">
            <div className="grid gap-2 sm:grid-cols-2">
              <Text label="Name" value={displayName} onChange={setDisplayName} placeholder="Jana Nováková" />
              <Pick label="Target field" value={roleFamily} onChange={setRoleFamily} options={ROLE_FAMILIES} />
              <Pick label="Education level" value={educationLevel} onChange={setEducationLevel} options={EDU_LEVELS.map((v) => ({ v, label: v }))} />
              <Text label="Languages" value={languages} onChange={setLanguages} placeholder="Czech, English" />
              <Text label="Location" value={location} onChange={setLocation} placeholder="Praha" />
              <Text label="Availability" value={availability} onChange={setAvailability} placeholder="from July, part-time now" />
            </div>
            <Text
              className="mt-2"
              label="Study programme & specialisation"
              value={educationDetail}
              onChange={setEducationDetail}
              placeholder="CS, ČVUT FEL — focus on ML"
            />
            {fieldVis.years ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Text
                  label={choice === "career_switcher" ? "Years of prior (other-field) experience" : "Years of experience"}
                  value={yearsExperience}
                  onChange={setYearsExperience}
                  placeholder="6"
                  error={yearsError}
                />
                {fieldVis.seniority ? (
                  <Pick
                    label="Seniority"
                    value={seniority}
                    onChange={setSeniority}
                    // Offer an explicit "not set" option when seniority is empty (an
                    // edited profile that never declared one) so the select shows the
                    // true state instead of defaulting its display to "junior".
                    options={(seniority ? SENIORITIES : ["", ...SENIORITIES]).map((v) => ({ v, label: v || "not set" }))}
                  />
                ) : null}
              </div>
            ) : null}
            <Text
              className="mt-2"
              label="Aspirations / target roles"
              value={aspirations}
              onChange={setAspirations}
              placeholder="Junior frontend developer, ML engineer"
            />
          </Section>
        </div>

        <ProfileEvidenceColumn skills={skills} setSkills={setSkills} evidence={evidence} setEvidence={setEvidence} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
        <button
          type="button"
          onClick={() => build(false)}
          disabled={loading || hasFieldErrors}
          className="focus-ring h-10 rounded-md border border-stone-200 px-4 text-base font-semibold text-ink hover:bg-paper disabled:opacity-40"
        >
          {loading ? "Working…" : "Check (preview)"}
        </button>
        <button
          type="button"
          onClick={() => build(true)}
          disabled={loading || hasFieldErrors}
          className="focus-ring h-10 rounded-md bg-ink px-4 text-base font-semibold text-white disabled:opacity-40"
        >
          {saveLabel}
        </button>
      </div>

      {error ? <p className="mt-3 rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p> : null}
      {result ? <ResultPanel result={result} /> : null}
    </section>
  );
}
