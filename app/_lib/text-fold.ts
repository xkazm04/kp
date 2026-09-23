// The ONE case-and-diacritic fold, in JS and as the `kp_fold` SQL function: NFD,
// combining marks stripped, lower-cased, so a recruiter who cannot type Č finds Čapek.
//
// The process shares ONE connection (core.ts ensureDb) and `db.function()` REPLACES a
// same-named function. jobs.ts and devcase-ledger.ts used to register different
// `kp_fold`s, so whichever ran second redefined the other for the whole process. Every
// store registers this one now; never define another. Import-free: it rides the jobs,
// dev-case and analyses route graphs.

/** Case- and diacritic-insensitive search/sort key. */
export function foldText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** A string folds; anything else (NULL above all) passes through, so
 *  `kp_fold(NULLIF(col, '')) IS NULL` still means "missing". */
const kpFold = (value: unknown): unknown => (typeof value === "string" ? foldText(value) : value);

export type FoldableDb = {
  function(name: string, options: { deterministic?: boolean }, fn: (value: unknown) => unknown): unknown;
};

const registered = new WeakSet<object>();

/** Register `kp_fold` once per connection and hand the connection back. */
export function registerKpFold<T extends FoldableDb>(db: T): T {
  if (!registered.has(db)) {
    db.function("kp_fold", { deterministic: true }, kpFold);
    registered.add(db);
  }
  return db;
}
