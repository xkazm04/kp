/*
 * Plausible analytics — env-gated, cookieless, fire-and-forget.
 *
 * Two exports:
 *
 *   <PlausibleScript />  — renders the Plausible script tag ONLY when
 *     NEXT_PUBLIC_PLAUSIBLE_DOMAIN is set (the site's registered domain, e.g.
 *     "kandidate.example"). Unset ⇒ renders nothing: dev, self-hosted and
 *     privacy-first deploys ship ZERO analytics bytes. Mounted once in
 *     app/layout.tsx. Server-component-safe (no hooks, no state). `defer`
 *     satisfies @next/next/no-sync-scripts and keeps it off the critical path.
 *
 *   track(event, props?) — typed custom-event helper for client code.
 *     Guarded on window.plausible: when the script isn't mounted (no domain
 *     configured, blocked by the visitor, or not yet loaded) it is a silent
 *     no-op. Never throws, never blocks, never awaited — analytics must not be
 *     able to break or delay a product flow. Cookieless by construction
 *     (Plausible sets no cookies and stores nothing on the visitor).
 *
 * App-side events wired today:
 *   workspace_entered { plan? }  — session-nav.enterWorkspace (landing CTAs)
 *   demo_started                 — SimulationProvider's /?sim=auto auto-start
 *   checkout_started { item }    — BillingTab.startCheckout (plan or pack id)
 * Landing CTA events are the layout owner's side (this module just supplies
 * the primitives).
 */

// track() lives in ./track.ts (a plain .ts module) so non-JSX callers — and the
// Node test runner's type stripping, which loads .ts but not .tsx — can import
// it without pulling a JSX file. Re-exported here so components use one path.
export { track, type TrackProps } from "./track";

const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

/** The Plausible script include — nothing rendered unless the domain env is set. */
export function PlausibleScript() {
  if (!PLAUSIBLE_DOMAIN) return null;
  return <script defer data-domain={PLAUSIBLE_DOMAIN} src="https://plausible.io/js/script.js" />;
}
