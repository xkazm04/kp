// The ONE case-and-diacritic fold, in JS and as the `kp_fold` SQL function.
//
// A recruiter who cannot type Č still finds Čapek: NFD, combining marks stripped,
// lower-cased. The jobs browse sorts through it (jobs.ts TEXT_KEY), the dev-case ledger
// and History search through it (`instr(kp_fold(haystack), ?)` with the needle folded
// HERE, so both sides are the same function).
//
// Why a module of its own. The process shares ONE better-sqlite3 connection
// (core.ts ensureDb), and `db.function()` REPLACES a function of the same name. Two
// stores used to register their own `kp_fold` on it - jobs.ts (this fold, NULL passes
// through) and devcase-ledger.ts (toLocaleLowerCase, NULL -> '') - each guarding only
// its own re-registration, so whichever ran second silently redefined the other's for
// the life of the process: the ledger stopped matching 'šablona', or the jobs browse
// sorted missing values first. Every store now registers this function, so the order
// no longer matters. Never register a different `kp_fold` anywhere else.
//
// Import-free on purpose: it rides the jobs, dev-case and analyses route graphs.

/** Case- and diacritic-insensitive search/sort key. */
export function foldText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The SQL twin: a string folds, anything else (NULL above all) passes through, so
 *  `kp_fold(NULLIF(col, '')) IS NULL` still means "missing". */
function kpFold(value: unknown): unknown {
  return typeof value === "string" ? foldText(value) : value;
}

/** The slice of a better-sqlite3 connection this module touches (structural, so no
 *  runtime import of the driver). */
export type FoldableDb = {
  function(name: string, options: { deterministic?: boolean }, fn: (value: unknown) => unknown): unknown;
};

const registered = new WeakSet<object>();

/** Register `kp_fold` on `db` once per connection (a reset test connection re-applies
 *  it) and hand the connection back, so a store reads `registerKpFold(ensureDb())`. */
export function registerKpFold<T extends FoldableDb>(db: T): T {
  if (!registered.has(db)) {
    db.function("kp_fold", { deterministic: true }, kpFold);
    registered.add(db);
  }
  return db;
}
