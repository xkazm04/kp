// A leaf on purpose: db/organizations.ts (reached from the db core, so from nearly
// every route) needs only this string, and importing it from org-settings.ts pulled
// that module and its currency formatter into every route's graph (perf-budget.json).

/** What createOrganization writes when nobody gave a name. Not a name of the org's own. */
export const UNNAMED_ORG_NAME = "Untitled organization";
