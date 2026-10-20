"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { CatalogEntry, SourceRow } from "../logic/wire";
import { sendJson } from "../data/useGigsData";
import { adapterLabel, type Key } from "./wireConfig";

/** "Add a wire": the catalog's creatable adapters, in a popover opened from the key row. */
export function AddWire({
  id,
  entries,
  sources,
  onChanged,
  fmtArena,
}: {
  id: string;
  entries: readonly CatalogEntry[];
  sources: readonly SourceRow[];
  onChanged: () => Promise<unknown>;
  fmtArena: (a: string) => string;
}) {
  const t = useTranslations("gigs");
  return (
    <div id={id} popover="auto" className="pop">
      <h3 className="t-h3">{t("wires.addTitle", { count: entries.length })}</h3>
      {entries.map((c) => (
        <AddRow key={c.adapter} entry={c} already={sources.filter((s) => s.adapter === c.adapter).length} onChanged={onChanged} fmtArena={fmtArena} />
      ))}
    </div>
  );
}

function AddRow({ entry, already, onChanged, fmtArena }: { entry: CatalogEntry; already: number; onChanged: () => Promise<unknown>; fmtArena: (a: string) => string }) {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  async function add() {
    setBusy(true);
    setError(null);
    setAdded(false);
    const res = await sendJson("/api/gigs/sources", "POST", { adapter: entry.adapter });
    setBusy(false);
    if (!res.ok) setError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
    else {
      setAdded(true);
      await onChanged();
    }
  }

  const keyNote = entry.needsKey
    ? t("wires.needsVars", { vars: entry.envVars.join(" + ") })
    : entry.envVars.length > 0
      ? t("wires.keysOptional")
      : t("wires.keysNone");

  return (
    <div className="pi">
      <span className={`tier ${entry.tier}`} role="img" aria-label={t("sources.tier", { tier: entry.tier })}>
        {entry.tier}
      </span>
      <span>
        <b>{adapterLabel(t, entry, entry.adapter)}</b>
        <span className="d">
          {[entry.arena ? fmtArena(entry.arena) : null, entry.host ?? t("wires.noHost"), keyNote].filter(Boolean).join(" · ")}
        </span>
        {entry.declines ? <span className="d coral">{t(`sources.declines.${entry.declines}` as Key)}</span> : null}
        {entry.tier === "B" ? <span className="d">{t("sources.addTierB")}</span> : null}
        {added ? (
          <span role="status" className="d moss">
            {t("wires.added")}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="d coral">
            {error}
          </span>
        ) : null}
      </span>
      <button type="button" className="btn quiet" disabled={busy} onClick={() => void add()}>
        {already > 0 ? t("sources.addAnother", { count: already }) : t("sources.add")}
      </button>
    </div>
  );
}
