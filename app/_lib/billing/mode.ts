// Is this deployment SELLING the product, or is somebody running their own copy?
//
// KP is AGPL-3.0 and open-source first (README → "Run it yourself"): the default
// posture of a fresh checkout is a self-hosted install on the operator's own
// machine and, usually, their own model keys. Metering that install makes no
// sense — there is no customer, no invoice, and nobody to upgrade. Before this
// module existed there was no such distinction: `meterGate` ran unconditionally,
// a self-hoster with no billing provider resolved to `PLANS.free`, and their
// SECOND published role was refused with a 402 pointing at a Billing panel that
// could not sell them anything.
//
// So metering is a property of the DEPLOYMENT, not of the code:
//
//   commercial (metered)  — a billing provider is configured, OR this org already
//                           has billing state (it subscribed at some point).
//   self-hosted (unmetered) — neither. Every meter resolves unlimited.
//
// The second clause is the belt to the first's braces. Keying purely on the env
// var would make the hosted product's entire revenue gate depend on one variable
// surviving a deploy; with the state-row clause, an org that has ever transacted
// stays metered even if the credential goes missing. A brand-new org on a
// mis-configured hosted deploy runs unmetered until it subscribes — the failure
// mode is "too generous to a stranger", never "billed a self-hoster".
//
// Provider-agnostic by construction, like the rest of the module: this file lists
// the credential env var of each supported gateway rather than importing polar.ts
// (which stays an implementation detail behind polarGatewayFromEnv). Adding a MoR
// means adding its credential var here alongside its gateway.

/** Credential env vars that mean "a billing provider is wired up". One per gateway. */
const PROVIDER_CREDENTIAL_VARS = ["POLAR_ACCESS_TOKEN"] as const;

/** True when this deployment has a payment provider configured at all. Pure env
 *  read, exported for tests and for the self-hosting docs' "am I metered?" answer. */
export function billingProviderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return PROVIDER_CREDENTIAL_VARS.some((key) => Boolean(env[key]?.trim()));
}
