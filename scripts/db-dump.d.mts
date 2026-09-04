// db-dump.mjs is plain ESM (scripts/ runs on bare node, not through tsc); this
// declaration exists so app/_lib/db/rollback-drill.test.ts can import the
// redaction vocabulary under the repo's `noImplicitAny` — specifically to assert
// ORG_CONFIG_TABLES still mirrors ORG_CONFIG_NOT_PORTABLE in app/_lib/tenancy.ts,
// which the script cannot import because it cannot load TypeScript.
export declare const DUMP_FORMAT: string;
export declare const DUMP_VERSION: number;
export declare const ORG_CONFIG_TABLES: ReadonlySet<string>;
export declare const CREDENTIAL_TABLES: ReadonlySet<string>;
export declare const SECRET_COLUMN_RE: RegExp;
export declare function redactionPlan(
  table: string,
  columns: { name: string; pk: number }[]
): Set<string>;
export declare function redactedValue(
  table: string,
  column: string,
  rowIndex: number,
  original: unknown
): unknown;
