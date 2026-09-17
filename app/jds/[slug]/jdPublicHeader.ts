// Public JD page header composition. Pure so a candidate share-link render
// cannot grow an operator toolbar without a red test: Edit/Archive/History already
// sit behind `canManage`, and Analyze CV + the job-board Publish teaser must too.

export const PUBLIC_JD_HEADER_ACTIONS = ["apply", "notAccepting", "publish", "analyzeCv"] as const;
export type PublicJdHeaderAction = (typeof PUBLIC_JD_HEADER_ACTIONS)[number];

export function publicJdHeaderActions(opts: {
  canManage: boolean;
  applyOpen: boolean;
}): PublicJdHeaderAction[] {
  const actions: PublicJdHeaderAction[] = [opts.applyOpen ? "apply" : "notAccepting"];
  if (opts.canManage) {
    actions.push("publish", "analyzeCv");
  }
  return actions;
}
