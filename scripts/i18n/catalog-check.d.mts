// The gate itself is plain ESM (scripts/ runs on node, not through tsc); this
// declaration exists so the fixtures in i18n/catalog-check.test.ts can import it
// under the repo's `noImplicitAny`.
export declare function stringUnits(catalog: unknown): {
  units: Map<string, string>;
  nonStrings: { address: string; value: unknown }[];
  arrays: Map<string, number>;
};
export declare function countStrings(value: unknown): number;
export declare function dashError(value: string): string | null;
export type SourceSuspect = {
  address: string;
  locales: string[];
  failures: { locale: string; checks: string[] }[];
};
export declare function sourceSuspects(
  findings: { locale: string; address: string; check: string }[],
  floor?: number
): SourceSuspect[];
export declare function checkCatalogs(
  catalogs: { locale: string; data: unknown }[],
  defaultLocale: string
): {
  problems: string[];
  sourceSuspects: SourceSuspect[];
  baseKeys: string[];
  coverage: {
    locales: number;
    defaultStrings: number;
    listStrings: number;
    lists: number;
    totalUnits: number;
    totalCounted: number;
  };
};
export declare function controlCharError(value: string): string | null;
export declare function carriedLiterals(value: string): [string, string][];
export declare function missingLiterals(
  baseValue: string,
  value: string
): { kind: string; literal: string; need: number; have: number }[];
export declare function literalErrors(baseValue: string, value: string): string[];
export declare function syntaxError(value: string, locale: string): string | null;
