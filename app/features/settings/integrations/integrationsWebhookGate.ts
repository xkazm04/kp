// The one non-obvious RULE the webhook panel enforces, lifted out of the component so
// it can be pinned by a test. `POST /api/ats/test` has no body: it pings the STORED
// endpoint with the STORED secret and knows nothing about what is in the form. So a
// ping fired against a typed-but-unsaved URL reports "Delivered: endpoint responded
// 200" about the PREVIOUS address, under the new one on screen — proof the ping never
// earned, on the panel whose whole design is about not doing that.
//
// It lived as a one-line expression inside IntegrationsWebhookPanel.tsx with nothing
// asserting it, which is how a rule of this shape quietly loosens (`url !== savedUrl`
// dropped, or `!!savedUrl` alone kept) during an unrelated edit.

/**
 * Whether "Send test" may be offered.
 *
 * Both halves are load-bearing:
 *   • something must actually be STORED (an unconfigured deployment has nothing to
 *     ping, and `deliver()` would answer "No webhook URL configured"), and
 *   • the field must MATCH what the server last confirmed — including whitespace and
 *     case, because those are what would make it a different endpoint.
 */
export function webhookTestable(savedUrl: string, url: string): boolean {
  return !!savedUrl && url === savedUrl;
}
