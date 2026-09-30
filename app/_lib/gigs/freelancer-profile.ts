// Who the freelancer is, in the operator's own words: the ONE place a bid's introduction may
// claim experience (gig_brief_cli.py / gig_proposal_cli.py read it as trusted input, outside the
// fenced listing data). A model never invents years or a specialty; it may only restate this.
// Operator's call (2026-09-30): "introduce as web developer with 10+ year experience".
// Override per install with KP_GIG_FREELANCER_INTRO (a phrase that completes "I am ...").

export const GIG_FREELANCER_INTRO_DEFAULT = "a web developer with more than 10 years of experience";
/** The longest intro a bid carries; a longer one is a mistake, not a profile. */
export const GIG_FREELANCER_INTRO_MAX = 200;

/** The freelancer's introduction: the env override when it is a usable phrase, else the default. Pure. */
export function gigFreelancerIntro(env: Record<string, string | undefined> = process.env): string {
  const v = env.KP_GIG_FREELANCER_INTRO?.replace(/\s+/g, " ").trim();
  return v && v.length <= GIG_FREELANCER_INTRO_MAX ? v : GIG_FREELANCER_INTRO_DEFAULT;
}
