import type { Dispatch, SetStateAction } from "react";
import type { SkillRow, EvidenceRow } from "./ProfileTypes";
import { SKILL_LEVELS, PROVENANCE, EVIDENCE_KINDS } from "./ProfileTypes";
import { Section, AddBtn, RemoveBtn, upd } from "./ProfileFields";

export function ProfileEvidenceColumn({
  skills,
  setSkills,
  evidence,
  setEvidence,
}: {
  skills: SkillRow[];
  setSkills: Dispatch<SetStateAction<SkillRow[]>>;
  evidence: EvidenceRow[];
  setEvidence: Dispatch<SetStateAction<EvidenceRow[]>>;
}) {
  return (
    <div className="space-y-4">
      <Section title="Skills (self-rated)">
        <div className="space-y-1.5">
          {skills.map((s, i) => (
            <div key={i} className="flex gap-1.5">
              <input
                value={s.skill}
                onChange={(e) => setSkills(upd(skills, i, { skill: e.target.value }))}
                placeholder="React"
                className="focus-ring h-9 flex-1 rounded-md border border-stone-200 px-2 text-base"
              />
              <select
                value={s.level}
                onChange={(e) => setSkills(upd(skills, i, { level: e.target.value }))}
                className="focus-ring h-9 rounded-md border border-stone-200 px-1 text-sm"
              >
                {SKILL_LEVELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              <select
                value={s.provenance}
                onChange={(e) => setSkills(upd(skills, i, { provenance: e.target.value }))}
                className="focus-ring h-9 rounded-md border border-stone-200 px-1 text-sm"
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
                  className="focus-ring h-9 rounded-md border border-stone-200 px-1 text-sm"
                >
                  {EVIDENCE_KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                <input
                  value={e.title}
                  onChange={(ev) => setEvidence(upd(evidence, i, { title: ev.target.value }))}
                  placeholder="Title (e.g. Bachelor thesis: recommender app)"
                  className="focus-ring h-9 flex-1 rounded-md border border-stone-200 px-2 text-base"
                />
                <RemoveBtn onClick={() => setEvidence(evidence.filter((_, j) => j !== i))} />
              </div>
              <textarea
                value={e.text}
                onChange={(ev) => setEvidence(upd(evidence, i, { text: ev.target.value }))}
                placeholder="What you built / did, your role, the outcome"
                rows={2}
                className="focus-ring mt-1.5 w-full rounded-md border border-stone-200 px-2 py-1 text-base"
              />
              <div className="mt-1.5 flex gap-1.5">
                <input
                  value={e.skills}
                  onChange={(ev) => setEvidence(upd(evidence, i, { skills: ev.target.value }))}
                  placeholder="skills: React, TypeScript"
                  className="focus-ring h-9 flex-1 rounded-md border border-stone-200 px-2 text-base"
                />
                <input
                  value={e.link}
                  onChange={(ev) => setEvidence(upd(evidence, i, { link: ev.target.value }))}
                  placeholder="github / demo link"
                  className="focus-ring h-9 flex-1 rounded-md border border-stone-200 px-2 text-base"
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
  );
}
