"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { withEditProvenance } from "@/app/_lib/brief-edit";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import type { RoleBrief } from "@/app/_lib/rolespec";

// The brief's EDIT mode (UAT drain §2.1 — Tomáš: "chci to opravit, než se z
// toho stane inzerát"). A typed change is `stated` by definition; the
// provenance diff (withEditProvenance) flips only changed/new entries, so an
// edit pass can't launder untouched inferred values into "stated".

type Req = NonNullable<RoleBrief["requirements"]>[number];
type Facet = NonNullable<RoleBrief["facets"]>[number];

const SENIORITIES = ["junior", "medior", "senior", "lead"] as const;

export function JdsIntakeBriefEdit({
  brief,
  saving,
  onSave,
  onCancel,
}: {
  brief: RoleBrief;
  saving: boolean;
  onSave: (edited: RoleBrief) => void | Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations("library.tab.intake.edit");
  const tBrief = useTranslations("library.tab.intake.brief");
  const [title, setTitle] = useState(brief.title ?? "");
  const [seniority, setSeniority] = useState(brief.seniority ?? "medior");
  const [requirements, setRequirements] = useState<Req[]>(brief.requirements ?? []);
  const [facets, setFacets] = useState<Facet[]>(brief.facets ?? []);
  const [newSkill, setNewSkill] = useState("");
  const [newSkillKind, setNewSkillKind] = useState<"must_have" | "nice_to_have">("must_have");
  const [newFacetLabel, setNewFacetLabel] = useState("");
  const [newFacetValue, setNewFacetValue] = useState("");

  const submit = () => {
    const edited: RoleBrief = {
      ...brief,
      title: title.trim(),
      seniority,
      requirements: requirements.filter((r) => r.skill.trim()),
      facets: facets.filter((f) => f.value.trim()),
    };
    void onSave(withEditProvenance(brief, edited));
  };

  const setReq = (i: number, patch: Partial<Req>) =>
    setRequirements((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <div>
        <div className={META_LABEL}>{tBrief("role")}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input className={`${FIELD} h-9 flex-1 min-w-[12rem]`} value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className={`${FIELD} h-9`} value={seniority} onChange={(e) => setSeniority(e.target.value)}>
            {SENIORITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <div className={META_LABEL}>{tBrief("dealbreakers")} / {tBrief("niceToHave")}</div>
        <div className="mt-1.5 space-y-2">
          {requirements.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input className={`${FIELD} h-9 flex-1 min-w-[10rem]`} value={r.skill} onChange={(e) => setReq(i, { skill: e.target.value })} />
              <select
                className={`${FIELD} h-9`}
                value={r.kind}
                onChange={(e) => setReq(i, { kind: e.target.value as Req["kind"] })}
              >
                <option value="must_have">{tBrief("dealbreakers")}</option>
                <option value="nice_to_have">{tBrief("niceToHave")}</option>
              </select>
              <button type="button" className={`${BTN_GHOST} h-9 px-2 text-sm`} onClick={() => setRequirements((l) => l.filter((_, j) => j !== i))}>
                {t("remove")}
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${FIELD} h-9 flex-1 min-w-[10rem]`}
              placeholder={t("skillPlaceholder")}
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
            />
            <select className={`${FIELD} h-9`} value={newSkillKind} onChange={(e) => setNewSkillKind(e.target.value as typeof newSkillKind)}>
              <option value="must_have">{tBrief("dealbreakers")}</option>
              <option value="nice_to_have">{tBrief("niceToHave")}</option>
            </select>
            <button
              type="button"
              className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
              disabled={!newSkill.trim()}
              onClick={() => {
                setRequirements((l) => [
                  ...l,
                  {
                    skill: newSkill.trim(),
                    kind: newSkillKind,
                    hardness: newSkillKind === "must_have" ? "prerequisite" : "learnable",
                    weight: newSkillKind === "must_have" ? 0.8 : 0.4,
                    rationale: "",
                    provenance: "stated",
                    confidence: 1,
                    sourceTurn: null,
                  },
                ]);
                setNewSkill("");
              }}
            >
              {t("addRequirement")}
            </button>
          </div>
        </div>
      </div>
      <div>
        <div className={META_LABEL}>{tBrief("context")}</div>
        <div className="mt-1.5 space-y-2">
          {facets.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="text-body text-steel">{f.label || f.key}:</span>
              <input
                className={`${FIELD} h-9 flex-1 min-w-[10rem]`}
                value={f.value}
                onChange={(e) => setFacets((l) => l.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
              <button type="button" className={`${BTN_GHOST} h-9 px-2 text-sm`} onClick={() => setFacets((l) => l.filter((_, j) => j !== i))}>
                {t("remove")}
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${FIELD} h-9 w-40`}
              placeholder={t("facetLabelPlaceholder")}
              value={newFacetLabel}
              onChange={(e) => setNewFacetLabel(e.target.value)}
            />
            <input
              className={`${FIELD} h-9 flex-1 min-w-[10rem]`}
              placeholder={t("facetValuePlaceholder")}
              value={newFacetValue}
              onChange={(e) => setNewFacetValue(e.target.value)}
            />
            <button
              type="button"
              className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
              disabled={!newFacetValue.trim()}
              onClick={() => {
                setFacets((l) => [
                  ...l,
                  {
                    key: newFacetLabel.trim().toLowerCase().replace(/\s+/g, "_") || "note",
                    label: newFacetLabel.trim() || t("facetLabelPlaceholder"),
                    value: newFacetValue.trim(),
                    importance: "valuable",
                    provenance: "stated",
                    confidence: 1,
                    sourceTurn: null,
                  },
                ]);
                setNewFacetLabel("");
                setNewFacetValue("");
              }}
            >
              {t("addFacet")}
            </button>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={`${BTN_PRIMARY} h-9 px-4 text-sm`} disabled={saving} onClick={submit}>
          {t("save")}
        </button>
        <button type="button" className={`${BTN_GHOST} h-9 px-3 text-sm`} disabled={saving} onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
