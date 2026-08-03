# Integrations — Google Calendar and inbound ATS connections

The credential surface for the outside systems kp reads from. Two integrations live here,
both optional, both degrading to the app's keyless behaviour when they are not configured:

- **Google Calendar** — free/busy lookups so a proposed interview slot is one the
  interviewer can actually make, plus the event write-back for a confirmed interview.
- **ATS connections** — per-provider API credentials for reading applications out of an
  applicant tracking system (Recruitee, Recruitis, Teamio).

Outbound egress (the signed `kp.ats.v1` write-back webhook) is a different seam and is
documented in [../comms/outbound-export.md](../comms/outbound-export.md); its UI still
lives on the Background tasks tab.

## Entry point

**Workspace → Settings → Integrations** (`?tab=integrations`,
`app/features/settings/integrations/IntegrationsTab.tsx`). Operator-gated in the same
sense as the routes it calls: every endpoint behind this tab runs `requireOperator()`, and
in open mode (no `KP_OPERATOR_PASSWORD`) it stays open for local dev.

The tab is also the **landing target of the Google OAuth callback** — the callback route
redirects to `/?tab=integrations&calendar=<code>` and the calendar panel renders that code
as a banner, then strips the param from the URL so a reload cannot replay a stale outcome.

## Google Calendar

### Flow

1. **Connect** is a plain link to `GET /api/calendar/google/start`, not a fetch: that route
   sets an httpOnly CSRF state cookie (32 random bytes, 10-minute TTL) and 302s to Google's
   consent screen, which only a top-level navigation can follow.
2. Google returns to `GET /api/calendar/google/callback`, which compares the state with
   `timingSafeEqual`, exchanges the code, and stores the grant.
3. Whatever happens, the operator lands back on this tab with a `calendar=<code>` param.
4. **Disconnect** issues `DELETE /api/calendar/google`, which **revokes at Google first**
   and only then drops the row — deleting locally without revoking would leave a live grant
   nobody can see or withdraw from kp. The response reports `revokedAtGoogle` separately,
   and the UI says so when the revoke did not confirm.

### Scopes, and partial grants

kp requests exactly two narrow scopes (`app/_lib/calendar/google-oauth.ts`):
`calendar.freebusy` (busy intervals only — no titles, attendees or locations) and
`calendar.events` (write the interview). Google lets a user untick either one on the
consent screen, which yields a "successful" connection that silently cannot do half its
job. `missingScopes()` computes the shortfall, `saveCalendarConnection` stores it, and the
calendar panel renders it as an amber *Partial access granted* block with a Reconnect
action. The callback distinguishes this case with its own status code
(`connected_partial`).

A grant with **no refresh token** is refused outright rather than stored: it would expire
within the hour and present as "it worked, then stopped working tomorrow".

### The nine callback outcomes

`app/_lib/calendar/callback-status.ts` is the canonical list —
`CALENDAR_CALLBACK_STATUSES` — and the callback route's redirect helper is typed against
it, so a new outcome is a compile error until it is added. Every code has a title + a
what-to-do line in all four locales, and
`app/features/settings/integrations/integrationsCatalog.test.ts` asserts that mapping by
**set equality** in every locale. (`npm run i18n:check` cannot catch a gap here: four
identically-incomplete catalogs are in perfect parity with each other.)

| Code | Tone | Meaning |
| --- | --- | --- |
| `connected` | ok | Full grant stored |
| `connected_partial` | warn | Stored, but a scope was unticked |
| `cancelled` | warn | User pressed Cancel on Google's screen |
| `google_error` | error | Google returned an error other than `access_denied` |
| `state_mismatch` | error | Forged callback, or the consent screen sat past the state TTL |
| `no_code` | error | Callback carried no authorization code |
| `not_configured` | error | OAuth client env vars vanished mid-flow |
| `no_refresh_token` | error | Google withheld the refresh token — deliberately not stored |
| `exchange_failed` | error | The code→token exchange threw |

An unrecognized code still renders (generic error copy plus the raw value) rather than a
blank banner.

### Without credentials

With no `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`, `googleOAuthConfig()`
returns null and the panel renders a *Not configured on this deployment* block naming the
two variables and the exact redirect URI to register in Google Cloud — no Connect button
that would bounce off the start route's 503. **Scheduling keeps working:**
`proposeFreeSlots` (`app/_lib/calendar/available-slots.ts`) falls back to
`proposeSlots`'s local arithmetic and reports `calendarChecked: false`, so a caller never
claims a slot was calendar-confirmed when nothing was checked.

## ATS connections (inbound)

One connection per provider — `ATS_PROVIDERS = ["recruitee", "recruitis", "teamio"]`, an
allowlist because `provider` namespaces every external id in `ats_links`. Each carries a
base URL, an API token and a field map.

- **Base URL** is validated through `assertPublicHttpsEndpoint` (https only, no IP
  literals or internal hosts) — kp sends an authenticated request there, so an SSRF-able
  base URL would hand the credential to a metadata service.
- **Token** is write-only end to end: encrypted at rest (AES-256-GCM, `ats-secret.ts`),
  never returned by `GET` (`hasToken` only). Leaving the field blank on an edit keeps the
  stored token; the form never sends `apiToken: ""`, which the store reads as *clear*.
- **Removal** asks the links question out loud. Forgetting the external-id links makes the
  next sync re-import every application as new (duplicating the pipeline); keeping them
  re-adopts bindings to records that may since have been erased. Neither is a safe default,
  so the confirm step carries an unticked checkbox matching the route's `forgetLinks` opt-in
  and the result reports how many links were dropped.
- **Enabled** parks a connection without deleting its credentials or its links.

The field map (`app/_lib/ats/field-map.ts`) is *not* editable from this tab yet — see
Known gaps.

## Surface

| Path | Role |
| --- | --- |
| `app/features/settings/integrations/IntegrationsTab.tsx` | Tab shell; calendar panel eager, ATS panel deferred |
| `app/features/settings/integrations/IntegrationsCalendarPanel.tsx` | Connect / status / partial-grant / disconnect |
| `app/features/settings/integrations/IntegrationsCallbackBanner.tsx` | Renders one OAuth callback outcome |
| `app/features/settings/integrations/IntegrationsAtsPanel.tsx` | List + save/remove orchestration |
| `app/features/settings/integrations/IntegrationsAtsForm.tsx` | Add/update form |
| `app/features/settings/integrations/IntegrationsAtsRow.tsx` | One stored connection + removal confirm |
| `app/_lib/calendar/callback-status.ts` | Canonical callback vocabulary + tone + scope slug |
| `app/_lib/calendar/google-oauth.ts` | Scopes, consent URL, token exchange, revoke, `missingScopes` |
| `app/_lib/calendar/token-store.ts` | Encrypted per-workspace grant; `getCalendarConnection` never returns a token |
| `app/_lib/calendar/free-busy.ts`, `available-slots.ts` | Busy-interval reasoning; slot proposal that degrades |
| `app/_lib/calendar/google-calendar.ts` | `fetchBusy` (null = unknown, `[]` = checked and clear) |
| `app/_lib/ats/connections-store.ts` | Per-provider credentials + `ATS_PROVIDERS` |
| `app/api/calendar/google/{start,callback}/route.ts`, `app/api/calendar/google/route.ts` | OAuth start, callback, status + revoke-first DELETE |
| `app/api/ats/connections/route.ts` | GET / POST / DELETE inbound connections |

## Data model

- `calendar_connections` — PK `(workspace_id, provider)`. One connection per **workspace**,
  not per recruiter: a team schedules against a shared hiring calendar. Columns:
  `account_email`, `calendar_id` (default `primary`), encrypted `refresh_token` /
  `access_token`, `access_expires_at`, `scopes_json`, `missing_scopes_json`, `connected_at`.
- `ats_connections` — PK `provider`. `base_url`, encrypted `api_token`, `field_map_json`,
  `enabled`, `updated_at`.

## Known gaps

- **The field map has no UI.** A connection saved here uses the stored map (or an empty
  one), and an empty map has no `externalId` path — so a sync using it fails loudly rather
  than importing under a bad identity. Editing it still requires a `POST` with a `fieldMap`
  body.
- **`ats_connections` is not workspace-keyed** (unlike `calendar_connections`), so ATS
  credentials are installation-wide. Only the *links* are per-workspace.
- **Calendar connections are per workspace, not per interviewer.** Free/busy therefore
  reflects one shared calendar. The row is already keyed by workspace + account email, so
  adding a user dimension is additive.
- **No "test connection" action** for ATS, unlike the outbound webhook's test ping — a
  wrong token surfaces at the first sync.
- `account_email` is never populated by the callback (no userinfo call), so a connected
  calendar shows *Unknown account* until it is set another way.
