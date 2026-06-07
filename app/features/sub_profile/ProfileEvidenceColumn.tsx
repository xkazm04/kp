import type { Dispatch, SetStateAction } from "react";
import type { SkillRow, EvidenceRow } from "./ProfileTypes";
import { SKILL_LEVELS, PROVENANCE, EVIDENCE_KINDS } from "./ProfileTypes";
import { Section, Input, Select, Textarea, AddBtn, RemoveBtn, upd } from "./ProfileFields";

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
              <Input
                value={s.skill}
                onChange={(e) => setSkills(upd(skills, i, { skill: e.target.value }))}
                placeholder="React"
                className="flex-1"
              />
              <Select
                value={s.level}
                onChange={(e) => setSkills(upd(skills, i, { level: e.target.value }))}
                className="px-1 text-sm"
              >
                {SKILL_LEVELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </Select>
              <Select
                value={s.provenance}
                onChange={(e) => setSkills(upd(skills, i, { provenance: e.target.value }))}
                className="px-1 text-sm"
              >
                {PROVENANCE.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
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
                <Select
                  value={e.kind}
                  onChange={(ev) => setEvidence(upd(evidence, i, { kind: ev.target.value }))}
                  className="px-1 text-sm"
                >
                  {EVIDENCE_KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </Select>
                <Input
                  value={e.title}
                  onChange={(ev) => setEvidence(upd(evidence, i, { title: ev.target.value }))}
                  placeholder="Title (e.g. Bachelor thesis: recommender app)"
                  className="flex-1"
                />
                <RemoveBtn onClick={() => setEvidence(evidence.filter((_, j) => j !== i))} />
              </div>
              <Textarea
                value={e.text}
                onChange={(ev) => setEvidence(upd(evidence, i, { text: ev.target.value }))}
                placeholder="What you built / did, your role, the outcome"
                rows={2}
                className="mt-1.5 px-2 py-1"
              />
              <div className="mt-1.5 flex gap-1.5">
                <Input
                  value={e.skills}
                  onChange={(ev) => setEvidence(upd(evidence, i, { skills: ev.target.value }))}
                  placeholder="skills: React, TypeScript"
                  className="flex-1"
                />
                <Input
                  value={e.link}
                  onChange={(ev) => setEvidence(upd(evidence, i, { link: ev.target.value }))}
                  placeholder="github / demo link"
                  className="flex-1"
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
