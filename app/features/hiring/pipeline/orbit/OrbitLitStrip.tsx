"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import type { LitSet } from "./overview/overviewParts";
import type { OrbitWords } from "./orbitWords";

/** Names listed before the disclosure; "Show all N" lists the rest, each still a press to its record. */
const NAMES = 8;

/**
 * The queue the Overview opened the orbit with, still lit ("The Orbit, Lit"): what it is, its people by
 * name, the most urgent first (each a kit link to their record, the lit set as prev / next), and the way
 * back to everyone. Past the first eight a disclosure ("Show all N", the lanes' own words) lists every
 * one of them, so each lit person is one press away by keyboard too (the canvas dots are not controls).
 * Esc clears the lit set, one rung before the ring focus.
 */
export function OrbitLitStrip({ lit, words, onPerson, onClear }: { lit: LitSet; words: OrbitWords; onPerson: (e: Entry) => void; onClear: () => void }) {
  const tl = useTranslations("overviewLit");
  const [all, setAll] = useState(false);
  const many = lit.entries.length > NAMES;
  const shown = all || !many ? lit.entries : lit.entries.slice(0, NAMES);
  return (
    <section className={lit.needs ? "ob-lit is-needs" : "ob-lit"} aria-label={tl("lit.aria")} data-role="orbit-lit">
      <b>{lit.label}</b>
      <span className="ob-lit__names">
        {shown.map((e) => (
          <Button key={e.id} label={e.candidateLabel} variant="link" size="sm" onClick={() => onPerson(e)} />
        ))}
        {many ? (
          <Button
            label={all ? words.t("showFewer") : words.t("showAll", { count: lit.entries.length })}
            variant="ghost"
            size="sm"
            aria-expanded={all}
            onClick={() => setAll((v) => !v)}
          />
        ) : null}
      </span>
      <Button label={tl("lit.clear")} variant="link" size="sm" onClick={onClear} tip={words.t("backTip")} />
    </section>
  );
}
