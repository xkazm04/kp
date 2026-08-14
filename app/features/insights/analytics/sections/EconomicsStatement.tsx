"use client";

// VARIANT A — "Statement". Metaphor: the period statement you could hand to
// finance without editing it.
//
// The baseline spreads cost across four cards and never adds anything up, so
// "what did this period actually cost us" is a question the reader assembles by
// hand. A statement takes responsibility for the arithmetic: line items, unit
// economics per line, and a footed total.
//
// What differs, structurally:
//   • one ruled ledger instead of four panels — money read top to bottom;
//   • every line carries what it BOUGHT (hires) beside what it cost, so a line
//     is judged as unit economics, not as a raw number;
//   • the totals row is the point of the page, not a footnote;
//   • the honesty caveats become numbered notes under the rule, the way a real
//     statement carries them — rather than grey text beside each figure.
//
// The deliberate refusal at its centre: it does NOT print one grand total.
// Recruiter spend is CZK, LLM compute is USD, and the app has no rate to convert
// them. A statement that summed them would be the most confident-looking lie on
// the page, so the total foots per currency and says why.
import { useFormatter, useTranslations } from "next-intl";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { labelOr } from "@/app/_lib/use-enum-label";
import { PANEL } from "@/app/_components/ui/recipes";
import { Defer } from "@/app/_components/ui/Defer";
import { AutomationPanel } from "./sectionChunks";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import type { EconomicsProps } from "./economicsTypes";

/** A note marker — the statement's device for caveats that would otherwise be
 *  grey text nobody reads beside a number. */
function Note({ n }: { n: number }) {
  return <sup className="ml-0.5 font-medium text-coral">{n}</sup>;
}

export function EconomicsStatement({ data, reload, tabScopedSearch }: EconomicsProps) {
  const t = useTranslations("analytics.econ");
  const tc = useTranslations("analytics.channels");
  const { money } = useNumberFormat();
  const format = useFormatter();
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const channelName = (channel: string) => labelOr(tc, `names.${channel}`, channel);

  const windowed = data.windowDays != null;
  const spendRows = data.byChannel.filter((r) => r.spendCzk != null && r.spendCzk > 0);
  const czkSpend = spendRows.reduce((s, r) => s + (r.spendCzk ?? 0), 0);
  const czkHires = spendRows.reduce((s, r) => s + r.hired, 0);
  const compute = data.computeCost;

  // Notes are numbered in the order they first apply, so the markers read in
  // document order rather than by some fixed catalogue of caveats.
  const notes: string[] = [];
  const noteFor = (text: string) => {
    const existing = notes.indexOf(text);
    if (existing >= 0) return existing + 1;
    notes.push(text);
    return notes.length;
  };
  const windowNote = windowed && spendRows.length > 0 ? noteFor(t("noteWindowedSpend")) : null;
  // Only when BOTH legs are on the statement: the note explains why two lines do
  // not add up, so with one currency present it is a caveat about nothing — and
  // its marker hangs off the subtotal row, which does not render without spend.
  const currencyNote = compute && spendRows.length > 0 ? noteFor(t("noteTwoCurrencies")) : null;
  const unpricedNote = compute && compute.unpricedCalls > 0 ? noteFor(t("noteUnpriced", { count: compute.unpricedCalls })) : null;
  const scopeNote = compute && compute.workspaceCount > 1 ? noteFor(t("noteAccountScope", { teams: compute.workspaceCount })) : null;

  return (
    <div className="animate-arrive-in space-y-6">
      <section className={`${PANEL} p-5`}>
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-300 pb-3">
          <h3 className="font-serif text-h2 text-ink">{t("statementTitle")}</h3>
          <p className="text-meta uppercase text-steel">
            {windowed ? t("periodDays", { days: data.windowDays! }) : t("periodAllTime")}
          </p>
        </header>

        {spendRows.length === 0 && !compute ? (
          <p className="mt-4 rounded-md bg-paper p-3 text-base text-steel">{t("statementEmpty")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[38rem] text-base">
              <thead>
                <tr className="border-b border-stone-200 text-left text-meta uppercase text-steel">
                  <th className="pb-2 pr-3 font-semibold">{t("colLine")}</th>
                  <th className="pb-2 pr-3 text-right font-semibold">{t("colCost")}</th>
                  <th className="pb-2 pr-3 text-right font-semibold">{t("colBought")}</th>
                  <th className="pb-2 text-right font-semibold">{t("colPerHire")}</th>
                </tr>
              </thead>

              {/* --- Recruiter spend, in CZK ---------------------------------- */}
              <tbody>
                {spendRows.map((r) => (
                  <tr key={r.channel} className="border-b border-stone-100">
                    <td className="py-2 pr-3 text-ink">{channelName(r.channel)}</td>
                    <td className="py-2 pr-3 text-right text-ink nums">{money(r.spendCzk ?? 0)}</td>
                    <td className="py-2 pr-3 text-right text-steel nums">
                      {t("hiresCount", { n: r.hired })}
                    </td>
                    <td className="py-2 text-right nums">
                      {r.costPerHireCzk != null ? (
                        <span className="font-semibold text-ink">{money(r.costPerHireCzk)}</span>
                      ) : (
                        <span className="text-steel">
                          —{windowNote ? <Note n={windowNote} /> : null}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {spendRows.length > 0 ? (
                  <tr className="border-b-2 border-stone-300 font-semibold">
                    <td className="py-2 pr-3 text-ink">
                      {t("subtotalRecruiter")}
                      {currencyNote ? <Note n={currencyNote} /> : null}
                    </td>
                    <td className="py-2 pr-3 text-right text-ink nums">{money(czkSpend)}</td>
                    <td className="py-2 pr-3 text-right text-steel nums">{t("hiresCount", { n: czkHires })}</td>
                    <td className="py-2 text-right text-ink nums">
                      {czkHires > 0 && !windowed ? money(Math.round(czkSpend / czkHires)) : <span className="text-steel">—</span>}
                    </td>
                  </tr>
                ) : null}
              </tbody>

              {/* --- Compute, in USD. A separate tbody because it is a separate
                      currency and the rule between them is the point. -------- */}
              {compute ? (
                <tbody>
                  <tr className="border-b border-stone-100">
                    <td className="py-2 pr-3 text-ink">
                      {t("lineCompute")}
                      {/* The currency note belongs on BOTH sides of the rule — it
                          is about the pair not summing, not about either line. */}
                      {currencyNote ? <Note n={currencyNote} /> : null}
                      {scopeNote ? <Note n={scopeNote} /> : null}
                      {unpricedNote ? <Note n={unpricedNote} /> : null}
                    </td>
                    <td className="py-2 pr-3 text-right text-ink nums">{usd(compute.costUsd)}</td>
                    <td className="py-2 pr-3 text-right text-steel nums">{t("callsCount", { n: compute.calls })}</td>
                    <td className="py-2 text-right nums">
                      {compute.costPerHireUsd != null ? (
                        <span className="font-semibold text-ink">{usd(compute.costPerHireUsd)}</span>
                      ) : (
                        <span className="text-steel">—</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              ) : null}
            </table>
          </div>
        )}

        {notes.length > 0 ? (
          <ol className="mt-4 space-y-1 border-t border-stone-200 pt-3">
            {notes.map((n, i) => (
              <li key={n} className="flex gap-2 text-sm text-steel">
                <span className="font-medium text-coral">{i + 1}</span>
                <span>{n}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {/* The offsetting entry: what the automation gave back. Stated as its own
            line under the rule rather than as a competing headline — it is a
            credit against the cost above, and reads that way. */}
        {data.automationRoi.hoursSaved > 0 ? (
          <p className="mt-4 rounded-md border border-moss/30 bg-moss/5 px-3 py-2 text-base text-ink">
            {t("credit", { hours: data.automationRoi.hoursSaved, czk: money(data.automationRoi.czkSaved) })}
          </p>
        ) : null}
      </section>

      {/* The ROI ledger keeps its own panel: it is an assumptions surface (an
          editable hourly rate), not a statement line. */}
      <Defer strategy="idle">
        <AutomationPanel
          impact={data.automation}
          roi={data.automationRoi}
          costPerHireCzk={data.costPerHireCzk}
          timeToHireDays={data.medianTimeToHireDays}
          onSaved={reload}
          decisionsHref={buildUrl({ ...clearedTabScopedParams(), tab: "decisions" }, tabScopedSearch)}
        />
      </Defer>
    </div>
  );
}
