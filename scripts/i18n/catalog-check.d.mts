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
export declare function checkCatalogs(
  catalogs: { locale: string; data: unknown }[],
  defaultLocale: string
): {
  problems: string[];
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
