"use client";

import { useLocale, useTranslations } from "next-intl";
import { SelectField, type FieldOption } from "@/app/_components/kit";
import { labelize } from "@/app/_lib/format";
import type { Message } from "../channelsCommsHelpers";
import { humanKind, ledgerFacetOptions, type LedgerFacets } from "./channelsKitModel";

/**
 * The ledger's Role / Channel / Type filters (the retired table's column filters), as three compact
 * kit selects on the toolbar's filter line beside the verdict chips. The options are only the values
 * the loaded ledger holds (ledgerFacetOptions, the reader's collation); a facet with nothing to
 * choose is not drawn, and a chosen value that left the ledger stays listed so the select never
 * shows a blank while it still filters.
 */
export function ChannelsKitLedgerFacets({ messages, roleOf, facets, setFacets }: {
  messages: readonly Message[];
  roleOf: (m: Message) => string | null;
  facets: LedgerFacets;
  setFacets: (next: LedgerFacets) => void;
}) {
  const tc = useTranslations("channels.comms");
  const tt = useTranslations("table.filters");
  const locale = useLocale();
  const opts = ledgerFacetOptions(messages, roleOf, locale);
  const facet = (key: keyof LedgerFacets, column: string, values: string[], show: (v: string) => string) => {
    const value = facets[key];
    if (values.length === 0 && !value) return null;
    const listed = value && !values.includes(value) ? [value, ...values] : values;
    const options: FieldOption[] = [{ value: "", label: tt("allOf", { column }) }, ...listed.map((v) => ({ value: v, label: show(v) }))];
    return (
      <SelectField
        key={key}
        label={tt("filterColumn", { column })}
        value={value}
        options={options}
        size="sm"
        onChange={(v) => setFacets({ ...facets, [key]: v })}
      />
    );
  };
  return (
    <>
      {facet("role", tc("colRole"), opts.role, (v) => v)}
      {facet("channel", tc("colChannel"), opts.channel, labelize)}
      {facet("kind", tc("colType"), opts.kind, humanKind)}
    </>
  );
}
