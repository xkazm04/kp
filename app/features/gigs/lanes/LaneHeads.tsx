"use client";

import { useTranslations } from "next-intl";
import type { GigArena } from "@/app/_lib/gigs/types";
import type { Niche } from "../logic/niches";
import { useGigsFormat } from "../data/useGigsFormat";

// A lane's row head (GigsLanes.tsx): the niche with its working hire leading and the
// earlier copies folded under it, or the unrouted pool with its way to hire one.

const ARENA_KEY: Readonly<Record<GigArena, string>> = { freelance: "F", oss_bounty: "O", security: "S", competition: "C" };

export function NicheHead({ niche }: { niche: Niche }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const lead = niche.lead;
  const leadStatus = lead.hire ? fmt.hireStatus(lead.hire.status) : t("specialists.noHire");
  const earlierStates = [...new Set(niche.earlier.map((h) => (h.hire ? fmt.hireStatus(h.hire.status) : t("specialists.noHire")).toLowerCase()))].join(", ");
  return (
    <>
      <div className="nn">
        <span className="arena-key" role="img" aria-label={fmt.arena(niche.arena)}>
          {ARENA_KEY[niche.arena]}
        </span>
        {niche.label}
      </div>
      <div className="hire">
        {lead.hire?.status === "active" ? (
          <span className="ok">
            <i className="mk ok" aria-hidden /> {leadStatus}
          </span>
        ) : (
          <span>{leadStatus}</span>
        )}
        <span>{t("lanes.since", { date: fmt.date(lead.createdAt) })}</span>
      </div>
      {niche.earlier.length > 0 ? (
        <details className="fold-inline">
          <summary>{t("lanes.earlier", { count: niche.earlier.length, states: earlierStates })}</summary>
          <ul>
            {niche.hires.map((h) => (
              <li key={h.id}>
                {t("lanes.hireLine", {
                  name: h.name,
                  status: h.hire ? fmt.hireStatus(h.hire.status) : t("specialists.noHire"),
                  date: fmt.date(h.createdAt),
                })}
                {h.hire?.personaName ? ` · ${h.hire.personaName}` : null}
                {" · "}
                {h.registry === "available" ? t("specialists.fromRegistry") : t("specialists.fromSeed")}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="hire">{lead.registry === "available" ? t("specialists.fromRegistry") : t("specialists.fromSeed")}</p>
      )}
    </>
  );
}

export function PoolHead({ onHire }: { onHire: () => void }) {
  const t = useTranslations("gigs");
  return (
    <>
      <div className="nn pool">
        <i className="mk none" aria-hidden /> {t("lanes.pool")}
      </div>
      <div className="hire">
        <span>{t("lanes.poolSub")}</span>
        <button type="button" className="linkbtn" onClick={onHire}>
          {t("lanes.hireOne")}
        </button>
      </div>
    </>
  );
}
