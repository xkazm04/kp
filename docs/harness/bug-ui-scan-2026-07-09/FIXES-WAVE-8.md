# Fix Wave 8 — ATS security tail & secret/credential handling (7 Highs)

> 4 fix commits (`07e3e7a`, `dabbb96`, `6bc0dca`, `05402ae`) + 1 tenancy chore (`9a5a48f`), **7 Highs closed**.
> Baseline preserved: tsc 0 · node unit 1466 → **1500** · python 860 OK · i18n 3238 → **3239** × 4 · `next build` ✓.

Mostly authorization and secret-at-rest: who can touch the ATS integration, whether its secret
survives an export, whether a login can be brute-forced, whether a key rotation brands honest
credentials as fraud.

## Commits

| Commit | Finding(s) | Fix |
|---|---|---|
| `07e3e7a` | ats #2, #3, #4 | `requireOperator()` on all ATS routes; AES-256-GCM secret-at-rest (`KP_ATS_SECRET_KEY`); a delivery ledger with backoff + dead-letter. |
| `dabbb96` | auth #4, shared-utils #2 | Persisted per-account + per-IP login throttle; DNS-rebind resolver applied to the provider base URL. |
| `6bc0dca` | model-api-key #1 | The key-test canary maps every path to a stable error code and scrubs key material — no raw SDK text to the client. |
| `05402ae` | skill-matrix #1 | Credential MAC keyed on a dedicated `KP_SKILL_PROFILE_KEY` with per-row `key_id`; a config error renders `unverifiable`, never `tampered`. |
| `9a5a48f` | — | Classify the two new lazy tables in the tenancy manifest. |

## The bugs

**ATS was authenticated, not authorized.** Any org member could redirect candidate-PII egress or
clear the signing secret — the routes checked only for a valid session. Now `requireOperator()`,
the same primitive guarding the workspace export and the automation/decision surfaces.

**The signing secret rode out in the backup.** It sat plaintext in `ats_config`, and the whole-DB
export dumps every table — so the "write-only secret" doctrine (`getAtsConfig` returns only
`hasSecret`) was defeated by the export door. Now AES-256-GCM at rest; the export carries only
ciphertext, decrypted transiently to sign.

**`candidate.hired` could vanish.** `deliver` treated any HTTP response, including 5xx, as success,
with no retry. Now non-2xx/network/bad-key are failures recorded in a ledger, retried with
exponential backoff, and dead-lettered after 6 attempts.

**Login had no throttle.** Once per-account identity existed, `/api/auth/login` was open to
credential stuffing. A persisted per-account (primary) + per-IP throttle refuses with 429 before
the scrypt cost, records misses uniformly (no user-existence oracle), and clears on success.

**DNS rebinding.** `assertPublicHttpsEndpoint` vets only the literal host, so a name resolving to a
private/metadata IP slipped through at the provider base-URL check. The resolving guard (built for
the ATS boundary in a prior wave) is now generic and applied here — kept server-only, out of
`safe-url.ts`, which `"use client"` components import.

**A rotation branded honest credentials fraud.** The skill-profile verification MAC was keyed on
`KP_SECRET` with no versioning, so rotating the auth secret turned every issued credential red
"TAMPERED" to third parties. Now a dedicated key with per-row `key_id` (same shape as the Wave-7
decision chain), and a tri-state verdict so a *config* error shows `unverifiable`, never `tampered`.

**The canary leaked.** The provider-key test returned raw SDK error text on the exit-0 path — a key
leak if an SDK echoes the key. Now every path maps to one of 9 stable codes with a key-scrub
backstop.

## ⚠ Deploy — new env vars (cumulative across waves)

| Var | Wave | Required? | Notes |
|---|---|---|---|
| `KP_DECISION_HMAC_KEY` (+`_ID`, +`_<retiredId>`) | 7 | **prod** | audit-chain MAC; rotate-never-remove |
| `KP_SKILL_PROFILE_KEY` (+`_ID`, +`_<oldId>`, +`_LEGACY_KEY`) | 8 | **prod** | credential MAC; without it, verification falls to legacy/KP_SECRET |
| `KP_ATS_SECRET_KEY` | 8 | optional | ATS secret-at-rest; falls back to `KP_SECRET` |

All new schema (columns + the `ats_delivery`/`login_attempts` tables) applies via idempotent DDL at
boot — no manual migration.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc | 0 | 0 |
| node unit | 1466 | **1500** |
| python | 860 OK | 860 OK |
| i18n | 3238 × 4 | 3239 × 4 |
| `next build` | ✓ | ✓ |

Every fix non-vacuous by neuter → red → restore.

## Patterns (catalogue items 26–27)

26. **One trust level for the write door and the export door.** The ATS secret was write-only at
    the API but plaintext in the backup — a lower bar on the export path than the write path.
    Whatever gates a secret's *writes* must gate (or encrypt) its every *read*, including the
    whole-DB export.
27. **A rotatable key that gates an integrity check needs versioning, or rotation becomes an
    outage.** Three surfaces this run (decision chain, skill credential, and by analogy any MAC on
    stored data) got the same fix: a dedicated key + per-row `key_id` + legacy-prefix compatibility.
    When a MAC key can rotate, store which key signed each row.

## What remains

Highs: **48 of 66 closed**, 18 open. Next: the dev-case Python cluster (`calibrate` corpus
overwrite, `--resume` blindness, `expected_keys`, seed mutability), the Python CLI/LLM robustness
tail, then candidate flows and the UI/a11y group.
