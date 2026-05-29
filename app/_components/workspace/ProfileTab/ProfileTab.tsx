"use client";

import { useEffect, useState } from "react";

type SkillRow = { skill: string; level: string; provenance: string };
type EvidenceRow = { kind: string; title: string; text: string; skills: string; link: string };

type BuildResult = {
  archetype: string;
  confidence: number;
  reasons: string[];
  completeness: number;
  missing: string[];
  saved?: { id: string } | null;
};

type ProfileRow = {
  id: string;
  label: string;
  archetype: string | null;
  role_family: string | null;
  completeness: number | null;
};

const ARCHETYPE_CHOICES = [
  { v: "auto", label: "Auto-detect" },
  { v: "bau", label: "Experienced" },
  { v: "student", label: "Student / early-career" },
  { v: "career_switcher", label: "Career-switcher" },
];
const ROLE_FAMILIES = [
  { v: "software_engineering", label: "Software" },
  { v: "data_ai", label: "Data / AI" },
  { v: "product_project", label: "Product / Project" },
];
const EDU_LEVELS = ["unknown", "university", "bachelor", "master", "phd"];
const SENIORITIES = ["junior", "medior", "senior", "lead"];
const SKILL_LEVELS = ["foundational", "working", "strong"];
const PROVENANCE = [
  "self_declared",
  "coursework",
  "academic_project",
  "thesis",
  "personal_project",
  "open_source",
  "internship",
  "professional",
  "certification",
  "extracurricular",
];
const EVIDENCE_KINDS = [
  "project",
  "thesis",
  "internship",
  "course",
  "extracurricular",
  "certification",
  "job",
  "other",
];
const ARCHETYPE_LABEL: Record<string, string> = {
  bau: "Experienced",
  student: "Student / early-career",
  career_switcher: "Career-switcher",
};

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
                <Text label="Expected graduation" value={expectedGraduation} onChange={setExpectedGraduation} placeholder="e.g. 2026" />
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

        <div className="space-y-4">
          <Section title="Skills (self-rated)">
            <div className="space-y-1.5">
              {skills.map((s, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    value={s.skill}
                    onChange={(e) => setSkills(upd(skills, i, { skill: e.target.value }))}
                    placeholder="React"
                    className="focus-ring h-9 flex-1 rounded-md border border-stone-200 px-2 text-sm"
                  />
                  <select
                    value={s.level}
                    onChange={(e) => setSkills(upd(skills, i, { level: e.target.value }))}
                    className="focus-ring h-9 rounded-md border border-stone-200 px-1 text-xs"
                  >
                    {SKILL_LEVELS.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                  <select
                    value={s.provenance}
                    onChange={(e) => setSkills(upd(skills, i, { provenance: e.target.value }))}
                    className="focus-ring h-9 rounded-md border border-stone-200 px-1 text-xs"
                  >
                    {PROVENANCE.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                  <RemoveBtn onClick={() => setSkills(skills.filter((_, j) => j !== i))} />
                </div>
              ))}
            </div>
            <AddBtn label="+ skill" onClick={() => setSkills([...skills, { skill: "", level: "working", provenance: "self_declared" }])} />
          </Section>

          <Section title="Evidence (projects, thesis, internships, activities)">
            <div className="space-y-2">
              {evidence.map((e, i) => (
                <div key={i} className="rounded-md border border-stone-200 p-2">
                  <div className="flex gap-1.5">
                    <select
                      value={e.kind}
                      onChange={(ev) => setEvidence(upd(evidence, i, { kind: ev.target.value }))}
                      className="focus-ring h-9 rounded-md border border-stone-200 px-1 text-xs"
                    >
                      {EVIDENCE_KINDS.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                    <input
                      value={e.title}
                      onChange={(ev) => setEvidence(upd(evidence, i, { title: ev.target.value }))}
                      placeholder="Title (e.g. Bachelor thesis: recommender app)"
                      className="focus-ring h-9 flex-1 rounded-md border border-stone-200 px-2 text-sm"
                    />
                    <RemoveBtn onClick={() => setEvidence(evidence.filter((_, j) => j !== i))} />
                  </div>
                  <textarea
                    value={e.text}
                    onChange={(ev) => setEvidence(upd(evidence, i, { text: ev.target.value }))}
                    placeholder="What you built / did, your role, the outcome"
                    rows={2}
                    className="focus-ring mt-1.5 w-full rounded-md border border-stone-200 px-2 py-1 text-sm"
                  />
                  <div className="mt-1.5 flex gap-1.5">
                    <input
                      value={e.skills}
                      onChange={(ev) => setEvidence(upd(evidence, i, { skills: ev.target.value }))}
                      placeholder="skills: React, TypeScript"
                      className="focus-ring h-9 flex-1 rounded-md border border-stone-200 px-2 text-sm"
                    />
                    <input
                      value={e.link}
                      onChange={(ev) => setEvidence(upd(evidence, i, { link: ev.target.value }))}
                      placeholder="github / demo link"
                      className="focus-ring h-9 flex-1 rounded-md border border-stone-200 px-2 text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
            <AddBtn
              label="+ evidence"
              onClick={() => setEvidence([...evidence, { kind: "project", title: "", text: "", skills: "", link: "" }])}
            />
          </Section>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
        <button
          type="button"
          onClick={() => build(false)}
          disabled={loading}
          className="focus-ring h-10 rounded-md border border-stone-200 px-4 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-40"
        >
          {loading ? "Working…" : "Check (preview)"}
        </button>
        <button
          type="button"
          onClick={() => build(true)}
          disabled={loading}
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

function ResultPanel({ result }: { result: BuildResult }) {
  const pct = Math.round((result.completeness ?? 0) * 100);
  return (
    <div className="mt-4 rounded-lg border border-stone-200 bg-paper/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-white">
          {ARCHETYPE_LABEL[result.archetype] ?? result.archetype}
        </span>
        <span className="text-xs text-steel">confidence {Math.round((result.confidence ?? 0) * 100)}%</span>
        {result.saved?.id ? (
          <span className="ml-auto text-xs text-green-700">saved · {result.saved.id}</span>
        ) : (
          <span className="ml-auto text-xs text-steel">preview (not saved)</span>
        )}
      </div>
      {result.reasons?.length ? (
        <p className="mt-1 text-xs text-steel">Routing: {result.reasons.join("; ")}</p>
      ) : null}

      <div className="mt-3">
        <div className="flex justify-between text-xs text-steel">
          <span className="font-semibold uppercase tracking-wide">Completeness</span>
          <span>{pct}%</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-stone-100">
          <div className={`h-2 rounded-full ${pct >= 70 ? "bg-green-500" : "bg-coral"}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      {result.missing?.length ? (
        <div className="mt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-steel">Add next</p>
          <ul className="mt-1 list-disc pl-4 text-xs text-ink">
            {result.missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-xs text-green-700">Profile looks complete for its archetype.</p>
      )}
    </div>
  );
}

function upd<T>(arr: T[], i: number, patch: Partial<T>): T[] {
  return arr.map((x, j) => (j === i ? { ...x, ...patch } : x));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-steel">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[11px] uppercase tracking-wide text-steel">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="focus-ring h-9 rounded-md border border-stone-200 px-2 text-sm"
      />
    </label>
  );
}

function Pick({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-steel">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring h-9 rounded-md border border-stone-200 bg-white px-2 text-sm capitalize"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-coral" />
      {label}
    </label>
  );
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="focus-ring mt-2 rounded-md border border-dashed border-stone-300 px-2 py-1 text-xs text-steel hover:bg-paper">
      {label}
    </button>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="focus-ring rounded-md px-2 text-sm text-steel hover:text-red-600" aria-label="Remove">
      ×
    </button>
  );
}
