// Types for the operator rotation script, so the unit test that drives its engine
// (app/_lib/llm-secret.test.ts) type-checks like the rest of the tree. The script
// itself stays plain `node`-runnable JS — see its header for why.

/** One column holding an at-rest secret, and which master secret keys it. */
export type SecretColumn = {
  table: string;
  column: string;
  /** "KP_SECRET" rotates always; "ats" only when KP_ATS_SECRET_KEY is unset. */
  keyedBy: "KP_SECRET" | "ats";
};

export type RotateColumnResult = {
  table: string;
  column: string;
  scanned: number;
  rewritten: number;
  skipped: number;
  unreadable: number;
  /** Present and true when the table or column does not exist in this DB. */
  missing?: boolean;
};

export declare const SECRET_COLUMNS: SecretColumn[];

export declare function rotateColumn(
  db: unknown,
  table: string,
  column: string,
  options?: { dryRun?: boolean }
): RotateColumnResult;

export declare function rotateDatabaseSecrets(
  db: unknown,
  options?: { dryRun?: boolean; env?: Record<string, string | undefined> }
): { atsDecoupled: boolean; results: RotateColumnResult[] };
