# Shared Utility Libraries — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. Integer / hex / short-form IP encodings bypass the SSRF host guard
- **Severity**: High
- **Lens**: ambiguity
- **Category**: ssrf-guard-gap
- **File**: `app/_lib/safe-url.ts:65`
- **Scenario**: An operator (or an attacker who can write an ATS webhook / LLM endpoint) stores `https://2130706433/` (the 32-bit integer form of 127.0.0.1), `https://0x7f000001/`, or the short form `https://127.1/`. `assertPublicHttpsEndpoint` is documented as an "SSRF-grade check" that rejects "a bare IP, loopback, link-local", and its test asserts it "rejects the SSRF pivots" — yet all three of these pass and are returned as a normalized href.
- **Root cause**: `isIpLiteralHost` only recognizes dotted-quad IPv4 (`/^\d{1,3}(\.\d{1,3}){3}$/`) and colon-bearing IPv6. A hostname that is a bare decimal/hex integer, or a class-collapsed short form, contains no dots-in-quads and no colon, so it slips past both the IP-literal check and the `localhost`/`.internal` name checks. The OS resolver later expands `2130706433` back to 127.0.0.1.
- **Impact**: `ats-config-store.ts:103` uses this function as the **standalone** store-time SSRF gate (only `deliver()` adds the resolving `assertPublicHttpsEndpointResolved`). Any current caller that trusts the string-only guard — and any future one that reads the docstring and reasonably assumes completeness — accepts a loopback/metadata target in disguise. The DNS-resolving wrapper mitigates the fetch-with-key paths, but the primitive itself under-delivers on its advertised contract.
- **Fix sketch**: In `isIpLiteralHost`, also reject hosts that are all-digits (`/^\d+$/`), hex (`/^0x[0-9a-f]+$/i`), or fewer than four dotted octets — i.e. anything that isn't a syntactically valid DNS label sequence. Simplest robust rule: require the host to contain a dot AND a non-digit character (a real DNS name always has a TLD letter), rejecting every numeric encoding in one predicate. Add the integer/hex/short-form cases to `safe-url.test.ts`.

## 2. Over-declaring `KP_TRUSTED_PROXY` silently re-opens the exact spoof the limiter closes
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: undocumented-trust-assumption
- **File**: `app/_lib/rate-limit.ts:72`
- **Scenario**: An operator behind a single proxy sets `KP_TRUSTED_PROXY=2` (copied from a two-proxy example, or anticipating a future hop). A request arrives with a client-supplied `X-Forwarded-For: spoofed`, and the one real proxy appends the peer → `"spoofed, realclient"`. `resolveClientIp` computes index `hops.length - trustedHops = 2 - 2 = 0` and returns `"spoofed"` — a fully client-controlled value, so a per-request random XFF mints unlimited fresh buckets.
- **Root cause**: The docstring carefully covers the *under*-declared case ("Clamped to the left-most hop when the chain is shorter than declared") but never warns that *over*-declaring re-enables the client-forgeable region of the header. `trustedProxyHops()` accepts any non-negative integer with no relation to the real topology.
- **Impact**: A plausible misconfiguration silently defeats the abuse-containment control this module exists to provide — and unlike the safe under-throttle failure the module boasts about, this fails *open*.
- **Fix sketch**: Document the over-declaration hazard prominently on `KP_TRUSTED_PROXY` / `resolveClientIp` ("set this to the EXACT number of proxies you control; too high re-trusts client-supplied hops"). Optionally clamp the effective hop index so that the chosen entry can never be a hop the declared proxies didn't append (e.g. treat a chain shorter than `trustedHops` as untrusted → shared bucket, rather than returning its left-most client-controlled entry).

## 3. `distribution.ts` hand-rolls a weaker apply token instead of the shared `randomToken()`
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: token-scheme-drift
- **File**: `app/_lib/distribution.ts:21`
- **Scenario**: A candidate-facing apply token gates `POST`ing submissions to a posting and is described in-file as "effectively a bearer credential [that] must be unguessable". It is minted by a private `token()` returning `randomBytes(16).toString("hex")` — 128 bits, no prefix — while every other public bearer link in the app (offers, schedule, interview, skill-profile, ATS hook) uses the shared `randomToken()` → 192 bits, base64url, prefixed.
- **Root cause**: `random-id.ts` was created explicitly to be the "single source for the app's random id / token format" so the scheme "can never drift between call sites"; `distribution.ts` re-inlines its own, which is the precise drift that helper exists to prevent. The two schemes disagree on entropy (128 vs 192 bits), encoding (hex vs base64url), and prefixing (none vs typed).
- **Impact**: A prefix-less, lower-entropy token in one public surface makes tokens harder to triage in logs and inconsistent to reason about as a security boundary; a reviewer auditing "all public tokens use `randomToken`" would miss this one. Low exploitability (128 bits is still strong), but it is a latent consistency/security-review hazard.
- **Fix sketch**: Replace the private `token()` with `randomToken("app")` (or a suitable prefix) from `./random-id`, deleting the local helper so the posting apply token shares the one audited scheme. Confirm the `[token]` route segment tolerates the base64url prefix format (it already does for offers/schedule).

## 4. `positiveNumericEnv` accepts arbitrarily huge overrides with no upper bound
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: unbounded-tunable
- **File**: `app/_lib/env.ts:32`
- **Scenario**: An operator fat-fingers a scaled knob — e.g. a spawn-buffer ceiling of `KP_SPAWN_BUFFER_MB=99999` (or a stray extra digit) — and the guard happily returns `99999 * 1024 * 1024` bytes because it only rejects NaN / non-finite / ≤ 0. The single documented rule is "accept a positive, finite number", with no ceiling.
- **Root cause**: The function's contract is deliberately one-sided (reject-≤0), and the naming ("positiveNumericEnv") signals only a lower bound, so every call site inherits an unbounded upper range even where the value backs a memory/time budget.
- **Impact**: For a memory ceiling this is a latent OOM/DoS foot-gun from a typo; for the cache TTL it means an accidental multi-year retention. The failure is silent — the app boots and runs with a pathological tunable.
- **Fix sketch**: Add an optional `{ max?: number }` to the options and clamp (`Math.min`) the accepted override to it, warning once when a value is clamped, so memory/time-budget call sites can pass a sane ceiling while unbounded knobs opt out. At minimum, document that the caller owns the upper bound so it is a conscious decision per knob, not a silent default.

## 5. `chunk(arr, size<=0)` returns the whole array as one chunk, defeating the SQL-variable guard
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: guard-degrades-silently
- **File**: `app/_lib/entries-param.ts:50`
- **Scenario**: A caller derives `size` dynamically (or a future refactor passes a mis-computed `0`/negative), and `chunk` returns `[arr]` — the entire id list as a single un-chunked group. That array then feeds an `IN (?,?,…)` and, past ~999 bound variables, throws `SQLITE_MAX_VARIABLE_NUMBER` — exactly the 500 the module was written to prevent.
- **Root cause**: The `size <= 0` branch was added defensively but chose "return everything as one chunk" instead of failing loudly, which inverts the function's purpose (bounding IN-width) precisely when the width bound is broken.
- **Impact**: A latent, silent regression path: the one input that most needs chunking (a broken chunk size) produces the widest possible query. Today `SQL_IN_CHUNK = 400` is a constant so it can't trigger, but the guard invites the exact failure it appears to prevent.
- **Fix sketch**: Treat a non-positive `size` as a programming error — throw, or fall back to a safe minimum (e.g. `Math.max(1, size)`) so the result stays chunked. Either is safer than emitting one unbounded chunk.
