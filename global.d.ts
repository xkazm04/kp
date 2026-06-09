// next-intl type safety (v4 AppConfig augmentation). Wiring the `en` catalog in
// as the `Messages` shape makes every `t("…")` key autocomplete and turns an
// unknown / typo'd key into a COMPILE error — the type half of the
// gap-prevention story (the ESLint `no-literal-string` rule is the other half,
// and scripts/i18n-check.mjs guards en/cs parity). `en` is the source of truth
// for the key set; `cs` must match it (enforced by the parity check).
import en from "./messages/en.json";
import type { Locale } from "./i18n/locales";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
