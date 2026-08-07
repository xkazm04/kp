import { formatSalaryRange } from "@/app/_lib/format";

// bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #5): render the winnability
// coach's salary band through the shared salary formatter (APP_CURRENCY + the app's
// grouping) instead of a local `cs-CZ` + hardcoded "CZK" template. Every salary
// surface then reads the same currency/locale and can't drift if APP_CURRENCY ever
// changes or the app serves a non-CZK deployment. The coach's bands are bare
// [min, max] denominated in APP_CURRENCY by contract (see salary-band.ts), so no
// per-band currency is threaded — the shared helper defaults to APP_CURRENCY.
// The `locale` argument is the READER's locale (format.ts number-locale contract):
// this module is locale-dumb, so the client panel threads next-intl's active locale
// in. Omitting it keeps the English default, which is what the tests assert.
export function fmtBand(band: [number, number] | null, locale?: string): string | null {
  return band ? formatSalaryRange(band[0], band[1], { locale }) : null;
}
