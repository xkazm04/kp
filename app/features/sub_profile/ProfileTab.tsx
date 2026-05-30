"use client";

import { useEffect, useState } from "react";
import type { SkillRow, EvidenceRow, BuildResult, ProfileRow } from "./ProfileTypes";
import {
  ARCHETYPE_CHOICES,
  ROLE_FAMILIES,
  EDU_LEVELS,
  SENIORITIES,
  ARCHETYPE_LABEL,
} from "./ProfileTypes";
import { Section, Text, Pick, Check } from "./ProfileFields";
import { ProfileEvidenceColumn } from "./ProfileEvidenceColumn";
import { ResultPanel } from "./ProfileResultPanel";

export function ProfileTab() {
  const [choice, setChoice] = useState("auto");
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [expectedGraduation, setExpectedGraduation] = useState("");
  const [wantsDomainChange, setWantsDomainChange] = useState(false);
  const [hasSubstantialExperience, setHasSubstantialExperience] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [roleFamily, setRoleFamily] = useState("software_engineering");
  const [educationLevel, setEducationLevel] = useState("bachelor");
  const [educationDetail, setEducationDetail] = useState("");
  const [languages, setLanguages] = useState("Czech, English");
  const [location, setLocation] = useState("");
  const [availability, setAvailability] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [seniority, setSeniority] = useState("junior");
  const [aspirations, setAspirations] = useState("");

  const [skills, setSkills] = useState<SkillRow[]>([{ skill: "", level: "working", provenance: "self_declared" }]);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([
    { kind: "project", title: "", text: "", skills: "", link: "" },
  ]);

  const [result, setResult] = useState<BuildResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ProfileRow[]>([]);

  const isStudentish = choice === "student" || choice === "auto" || choice === "career_switcher";

  const loadSaved = () =>
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => setSaved((p.profiles as ProfileRow[]) ?? []))
      .catch(() => undefined);
  useEffect(() => {
    loadSaved();
  }, []);

  const splitList = (s: string) =>
    s
      .split(/[,\n;]+/)
      .map((x) => x.trim())
      .filter(Boolean);

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
      if (yearsExperience.trim()) profile.yearsExperience = Number(yearsExperience);
      if (choice === "bau") profile.seniority = seniority;

      const signals = {
        selfDeclared: choice,
        isEnrolled,
        expectedGraduation: expectedGraduation || undefined,
        wantsDomainChange,
        hasSubstantialExperience,
      };

      const r = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, signals, persist }),
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? `Build failed (${r.status}).`);
      setResult(payload as BuildResult);
      if (persist) loadSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Build failed.");
    } finally {
      setLoading(false);
    }
  };

  // Inline field validation: catch a non-numeric "years" (would POST NaN) and a
  // malformed graduation year before the request, and gate Save on validity.
  const yearsError =
    yearsExperience.trim() !== "" && !/^\d{1,2}(\.\d)?$/.test(yearsExperience.trim())
      ? "Enter a number (e.g. 6)."
      : undefined;
  const gradError =
    expectedGraduation.trim() !== "" && !/^(19|20)\d{2}$/.test(expectedGraduation.trim())
      ? "Enter a 4-digit year (e.g. 2026)."
      : undefined;
  const hasFieldErrors = Boolean(yearsError || gradError);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">Workspace</p>
        <h2 className="mt-1 font-serif text-display text-ink">Build a candidate profile</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          A guided intake that works for students and career-switchers, not just experienced hires. We route the
          archetype, collect the signals a thin CV omits (projects, thesis, coursework, aspirations), tag each piece of
          evidence with its <strong>provenance</strong>, and score completeness so you know what to add next.
        </p>
      </header>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Section title="Who is this candidate?">
            <div className="flex flex-wrap gap-2">
              {ARCHETYPE_CHOICES.map((c) => (
                <button
                  key={c.v}
                  type="button"
                  onClick={() => setChoice(c.v)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    choice === c.v ? "border-ink bg-ink text-white" : "border-stone-200 text-ink hover:bg-paper"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
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
            {choice === "bau" || choice === "career_switcher" ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Text
                  label={choice === "career_switcher" ? "Years of prior (other-field) experience" : "Years of experience"}
                  value={yearsExperience}
                  onChange={setYearsExperience}
                  placeholder="6"
                  error={yearsError}
                />
                {choice === "bau" ? (
                  <Pick label="Seniority" value={seniority} onChange={setSeniority} options={SENIORITIES.map((v) => ({ v, label: v }))} />
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
          className="focus-ring h-10 rounded-md border border-stone-200 px-4 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-40"
        >
          {loading ? "Working…" : "Check (preview)"}
        </button>
        <button
          type="button"
          onClick={() => build(true)}
          disabled={loading || hasFieldErrors}
          className="focus-ring h-10 rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          Save profile
        </button>
      </div>

      {error ? <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {result ? <ResultPanel result={result} /> : null}

      {saved.length > 0 ? (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-steel">Saved profiles</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {saved.map((p) => (
              <span key={p.id} className="rounded-md border border-stone-200 bg-paper px-2 py-1 text-xs text-ink">
                {p.label} · {ARCHETYPE_LABEL[p.archetype ?? ""] ?? p.archetype} ·{" "}
                {Math.round((p.completeness ?? 0) * 100)}%
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
