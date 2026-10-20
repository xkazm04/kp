"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import type { Reason } from "../../cohortTypes";
import { signed } from "./matrixModel";
import { usePhrase } from "./usePhrase";

/**
 * One reason: its phrase, its points ONLY when the rating is a formula (signed when they are a term
 * of the sum, "N not earned" when they are what a miss cost), and its evidence one press away.
 */
function ReasonItem({ r, id, role }: { r: Reason; id: string; role: "part" | "forgone" | undefined }) {
  const t = useTranslations("analyzeCohort.layerMatrix.readout");
  const phrase = usePhrase();
  const [open, setOpen] = useState(false);
  const ev = r.evidence ?? [];
  return (
    <li className="mx-reason" data-tone={r.tone}>
      <span className="mx-reason__line">
        <span className="mx-reason__phrase">{phrase(r.phrase)}</span>
        {r.points != null && role === "part" ? <span className="mx-reason__pts k-nums">{signed(r.points)}</span> : null}
        {r.points != null && role === "forgone" ? <span className="mx-reason__forgone k-nums">{t("forgone", { n: Math.abs(r.points) })}</span> : null}
      </span>
      {ev.length ? (
        <>
          <Button variant="link" size="sm" label={t("evidence")} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="mx-reason__ev" />
          {open ? (
            <ul id={id} className="mx-reason__evidence">
              {ev.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

/** A titled list of reasons; an empty one says so, never leaves a blank. */
export function MatrixReasons({ title, tone, reasons, roles, idBase }: {
  title: string;
  tone: "pro" | "con" | "note";
  reasons: readonly Reason[];
  roles: ReadonlyMap<Reason, "part" | "forgone">;
  idBase: string;
}) {
  const t = useTranslations("analyzeCohort.layerMatrix.readout");
  return (
    <section className="mx-reasons" data-tone={tone}>
      <h4 className="mx-reasons__h">
        {title} <span className="k-nums">{reasons.length}</span>
      </h4>
      {reasons.length ? (
        <ul className="mx-reasons__list">
          {reasons.map((r, i) => (
            <ReasonItem key={i} r={r} role={roles.get(r)} id={`${idBase}-${tone}-${i}`} />
          ))}
        </ul>
      ) : (
        <p className="mx-reasons__none">{t("none")}</p>
      )}
    </section>
  );
}
