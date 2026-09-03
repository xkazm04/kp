"use client";

import { useTranslations } from "next-intl";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import type { Audit, LC } from "./types";

const ACTOR: Record<string, string> = {
  auto: "bg-coral/15 text-coral",
  human: "bg-moss/15 text-moss",
  system: "bg-stone-200 text-steel",
};

// What the automation is doing right now, and the immutable record of what it did.
//
// Everything INSIDE the two lists is audit payload and stays canonical English in
// every locale, exactly like the decision chain's `approvedBy` (see
// docs/architecture/localization.md): the lifecycle `stage` and `detail`, and the
// audit row's `actor` / `action` / `reason` are fields of a sealed, machine-readable
// record — `set_promote_floor`, `floor → 70 (from calibration)`. Translating them
// would make the same event read differently depending on who opened the page, which
// is precisely what an audit trail must not do. Only the chrome around them is
// localized.
export function AuditPanel({ lifecycles, audit }: { lifecycles: LC[]; audit: Audit[] }) {
  const t = useTranslations("control");
  const rel = useRelativeTime();

  return (
    <>
      <section className="mt-6">
        <h2 className={META_LABEL}>{t("lifecycles.heading", { count: lifecycles.length })}</h2>
        {lifecycles.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed border-stone-200 p-3 text-micro text-steel">{t("lifecycles.empty")}</p>
        ) : (
          <ul className={`mt-2 divide-y divide-stone-100 ${PANEL}`}>
            {lifecycles.map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-micro">
                <span className="w-28 shrink-0 truncate font-semibold text-ink">{l.title}</span>
                <span className={`rounded-full bg-paper px-2 py-0.5 ${META_LABEL}`}>{l.stage}</span>
                <span className="min-w-0 flex-1 truncate text-steel">{l.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className={META_LABEL}>{t("audit.heading", { count: audit.length })}</h2>
        <ul className={`mt-2 divide-y divide-stone-100 ${PANEL}`}>
          {audit.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-micro">
              <span className={`w-20 shrink-0 truncate rounded-full px-1.5 py-0.5 text-center text-meta uppercase ${ACTOR[a.actor] ?? "bg-stone-200 text-steel"}`}>
                {a.actor}
              </span>
              <span className="w-28 shrink-0 truncate font-semibold text-ink">{a.action}</span>
              <span className="min-w-0 flex-1 truncate text-steel">{a.reason}</span>
              <span className="shrink-0 text-micro text-steel">{rel(a.createdAt)}</span>
            </li>
          ))}
          {audit.length === 0 ? <li className="px-3 py-2 text-micro text-steel">{t("audit.empty")}</li> : null}
        </ul>
      </section>
    </>
  );
}
