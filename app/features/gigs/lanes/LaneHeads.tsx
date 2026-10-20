"use client";

import { useTranslations } from "next-intl";
import type { SpecialistRow } from "../logic/wire";

// A lane's row head (GigsLanes.tsx): the gig type, how many gigs it holds, and its gig
// agents - how many are at work, and how many are still being hired or have retired.

const HIRING = new Set(["dispatched", "pending_approval", "onboarding"]);

export function TypeHead({ name, gigs, personas }: { name: string; gigs: number; personas: readonly SpecialistRow[] }) {
  const t = useTranslations("gigs");
  const active = personas.filter((p) => p.hire?.status === "active").length;
  const hiring = personas.filter((p) => p.hire && HIRING.has(p.hire.status)).length;
  const retired = personas.filter((p) => p.hire?.status === "retired").length;
  return (
    <>
      <div className="nn">{name}</div>
      <div className="hire">
        <span>{t("lanes.typeGigs", { count: gigs })}</span>
        {active > 0 ? (
          <span className="ok">
            <i className="mk ok" aria-hidden /> {t("lanes.typeAtWork", { count: active })}
          </span>
        ) : null}
        {hiring > 0 ? <span>{t("lanes.typeHiring", { count: hiring })}</span> : null}
        {retired > 0 ? <span>{t("lanes.typeRetired", { count: retired })}</span> : null}
        {personas.length === 0 ? <span>{t("lanes.typeNoAgents")}</span> : null}
      </div>
    </>
  );
}
