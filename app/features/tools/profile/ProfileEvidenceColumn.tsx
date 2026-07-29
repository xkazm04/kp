import type { Dispatch, SetStateAction } from "react";
import { useTranslations } from "next-intl";
import type { SkillRow, EvidenceRow } from "@/app/features/shared/profileTypes";
import { SKILL_LEVELS, PROVENANCE, EVIDENCE_KINDS } from "@/app/features/shared/profileTypes";
import { Section, Input, Select, Textarea, AddBtn, RemoveBtn, upd } from "./ProfileFields";
import { rowId } from "./ProfileForm";
import { FIELD_DOM_ID } from "./profileCompletenessFields";

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
  const t = useTranslations("profile.evidence");
  return (
    <div className="space-y-4">
      <Section title={t("skillsTitle")} id={FIELD_DOM_ID.skills}>
        <div className="space-y-1.5">
          {skills.map((s, i) => (
            <div key={s._id ?? i} className="flex gap-1.5">
              <Input
                value={s.skill}
                onChange={(e) => setSkills(upd(skills, i, { skill: e.target.value }))}
                placeholder={t("skillPlaceholder")}
                className="flex-1"
              />
              <Select
                value={s.level}
                onChange={(v) => setSkills(upd(skills, i, { level: v }))}
                className="px-1 text-sm"
                options={SKILL_LEVELS.map((l) => ({ value: l, label: l }))}
              />
              <Select
                value={s.provenance}
                onChange={(v) => setSkills(upd(skills, i, { provenance: v }))}
                className="px-1 text-sm"
                options={PROVENANCE.map((p) => ({ value: p, label: p }))}
              />
              <RemoveBtn onClick={() => setSkills(skills.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
        <AddBtn label={t("addSkill")} onClick={() => setSkills([...skills, { skill: "", level: "working", provenance: "self_declared", _id: rowId() }])} />
      </Section>

      <Section title={t("evidenceTitle")} id={FIELD_DOM_ID.evidence}>
        <div className="space-y-2">
          {evidence.map((e, i) => (
            <div key={e._id ?? i} className="rounded-md border border-stone-200 p-2">
              <div className="flex gap-1.5">
                <Select
                  value={e.kind}
                  onChange={(v) => setEvidence(upd(evidence, i, { kind: v }))}
                  className="px-1 text-sm"
                  options={EVIDENCE_KINDS.map((k) => ({ value: k, label: k }))}
                />
                <Input
                  value={e.title}
                  onChange={(ev) => setEvidence(upd(evidence, i, { title: ev.target.value }))}
                  placeholder={t("evidenceTitlePlaceholder")}
                  className="flex-1"
                />
                <RemoveBtn onClick={() => setEvidence(evidence.filter((_, j) => j !== i))} />
              </div>
              <Textarea
                value={e.text}
                onChange={(ev) => setEvidence(upd(evidence, i, { text: ev.target.value }))}
                placeholder={t("evidenceTextPlaceholder")}
                rows={2}
                className="mt-1.5 px-2 py-1"
              />
              <div className="mt-1.5 flex gap-1.5">
                <Input
                  value={e.skills}
                  onChange={(ev) => setEvidence(upd(evidence, i, { skills: ev.target.value }))}
                  placeholder={t("evidenceSkillsPlaceholder")}
                  className="flex-1"
                />
                <Input
                  value={e.link}
                  onChange={(ev) => setEvidence(upd(evidence, i, { link: ev.target.value }))}
                  placeholder={t("evidenceLinkPlaceholder")}
                  className="flex-1"
                />
              </div>
            </div>
          ))}
        </div>
        <AddBtn
          label={t("addEvidence")}
          onClick={() => setEvidence([...evidence, { kind: "project", title: "", text: "", skills: "", link: "", _id: rowId() }])}
        />
      </Section>
    </div>
  );
}
