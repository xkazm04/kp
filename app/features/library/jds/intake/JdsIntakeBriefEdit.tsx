"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { withEditProvenance } from "@/app/_lib/brief-edit";
import { clearBriefDraft, draftStorage, loadBriefDraft, saveBriefDraft } from "./intakeBriefDraft";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import type { RoleBrief } from "@/app/_lib/rolespec";

// The brief's EDIT mode (UAT drain §2.1 — Tomáš: "chci to opravit, než se z
// toho stane inzerát"). A typed change is `stated` by definition; the
// provenance diff (withEditProvenance) flips only changed/new entries, so an
// edit pass can't launder untouched inferred values into "stated".
//
// The form is the ONLY copy of what was typed — which is why a refused save
// keeps it mounted (JdsIntakeBriefPanel) and why a reload no longer empties it:
// every keystroke lands in a per-intake sessionStorage draft (intakeBriefDraft.ts)
// that is restored on mount and discarded once the edit is saved, cancelled, or
// the row moves under it.

type Req = NonNullable<RoleBrief["requirements"]>[number];
type Facet = NonNullable<RoleBrief["facets"]>[number];

const SENIORITIES = ["junior", "medior", "senior", "lead"] as const;

export function JdsIntakeBriefEdit({
  brief,
  intakeId,
  updatedAt,
  saving,
  onSave,
  onCancel,
}: {
  brief: RoleBrief;
  /** Which session this edit belongs to — the draft key. */
  intakeId: string;
  /** The row version the form was seeded from: a draft typed against a DIFFERENT
   *  one is dropped rather than replayed over whatever landed meanwhile. */
  updatedAt: string | null;
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
  // The draft is restored AFTER mount, never in a useState initializer: the
  // server renders this form from props, and seeding from storage during the
  // first render is a hydration mismatch.
  const restoredRef = useRef(false);

  const draft = (): RoleBrief => ({
    ...brief,
    title,
    seniority,
    requirements,
    facets,
  });

  useEffect(() => {
    // Deferred a tick (the jdsHooks.ts pattern) — no synchronous setState in an
    // effect. A draft whose intake has moved on comes back null and the props win.
    const timer = window.setTimeout(() => {
      const saved = loadBriefDraft(draftStorage(), intakeId, updatedAt);
      if (saved) {
        setTitle(saved.title ?? "");
        setSeniority(saved.seniority ?? "medior");
        setRequirements(saved.requirements ?? []);
        setFacets(saved.facets ?? []);
      }
      restoredRef.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [intakeId, updatedAt]);

  useEffect(() => {
    // Only once the restore pass has run — otherwise the first render's
    // prop-seeded state would overwrite the draft it is about to restore.
    if (!restoredRef.current) return;
    saveBriefDraft(draftStorage(), intakeId, updatedAt, draft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intakeId, updatedAt, title, seniority, requirements, facets]);

  const submit = () => {
    const edited: RoleBrief = {
      ...brief,
      title: title.trim(),
      seniority,
      requirements: requirements.filter((r) => r.skill.trim()),
      facets: facets.filter((f) => f.value.trim()),
    };
    // The draft has served its purpose the moment the edit is handed over: a
    // refused save keeps the FORM mounted (so nothing is lost either way), and a
    // stored draft that outlived its edit is the stale-restore this module
    // exists to prevent.
    clearBriefDraft(draftStorage(), intakeId);
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
        <button
          type="button"
          className={`${BTN_GHOST} h-9 px-3 text-sm`}
          disabled={saving}
          onClick={() => {
            clearBriefDraft(draftStorage(), intakeId);
            onCancel();
          }}
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
