/*
 * Pure accessible-name builder for the CzMap choropleth regions.
 *
 * The map encodes each region's metric purely as a heat-ramp fill, and the
 * value only ever appears in a visually-adjacent detail card — so a keyboard /
 * screen-reader visitor who focuses a region path hears just its name and none
 * of the data. This helper folds the region's VALUE (open-vacancy count + median
 * earnings, the same two figures the sighted RegionDetail card shows) into the path's
 * accessible name, so the figure travels with the focused element instead of
 * being decoupled into colour.
 *
 * It is kept pure (no React, no next-intl) so it is unit-testable under the bare
 * `node --test` runner: the caller supplies the already-localised label words
 * from the `jobMarket` i18n namespace, and this module only decides how the
 * numbers and words are stitched together (incl. the missing-median branch).
 */
import { fmtInt, fmtCzk, isFigure, type Region } from "./data";

/** The localised words the region announcement stitches its numbers between —
 *  supplied by the caller from the `jobMarket.map` catalog so the accessible
 *  name localises with the rest of the page. */
export interface RegionLabelText {
  /** noun phrase after the vacancy count, e.g. "open vacancies" */
  vacancies: string;
  /** label before the median value, e.g. "median earnings" */
  median: string;
  /** used in place of the median when a region has no median figure */
  medianUnavailable: string;
}

/**
 * Build the accessible name a map region announces. Always carries both figures
 * (matching the detail card), and degrades to `medianUnavailable` when a region
 * has no median so the label never announces a bare "—".
 *
 * e.g. `regionAriaLabel(praha, text)` → "Hlavní město Praha: 7 163 open
 * vacancies, median earnings 53 600 Kč".
 */
export function regionAriaLabel(region: Region, text: RegionLabelText): string {
  const vacancies = `${fmtInt(region.vacancies)} ${text.vacancies}`;
  const median =
    isFigure(region.medianSalary)
      ? `${text.median} ${fmtCzk(region.medianSalary)}`
      : text.medianUnavailable;
  return `${region.name}: ${vacancies}, ${median}`;
}
