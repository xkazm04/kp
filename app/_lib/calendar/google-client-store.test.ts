// The OAuth client saved through the guided setup (google-client-store.ts): sealed at rest,
// workspace-scoped, preferred over the env pair, and invisible to the grant's own queries.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  GoogleClientInputError,
  getStoredGoogleClient,
  getStoredGoogleClientStatus,
  googleOAuthConfigFor,
  saveGoogleClient,
} from "./google-client-store.ts";
import {
  calendarConnectionsDb,
  deleteCalendarConnection,
  getCalendarConnection,
  getRefreshToken,
  saveCalendarConnection,
} from "./token-store.ts";
import { encryptAtsSecret } from "../ats-secret.ts";

after(() => cleanupUnitDb());

const KEYS = [
  "KP_CALENDAR_SECRET_KEY",
  "KP_SECRET",
  "KP_ATS_SECRET_KEY",
  "KP_CALENDAR_SECRET_KEY_PREVIOUS",
  "KP_SECRET_PREVIOUS",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
] as const;
function only(vars: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}

let wsN = 0;
let ws = "";
beforeEach(() => {
  ws = `ws-client-${++wsN}`;
  only({ KP_CALENDAR_SECRET_KEY: "store-test-key" });
});

const ID = "1234-abc.apps.googleusercontent.com";
const SECRET = "GOCSPX-store-test-secret";
const BASE = "https://kp.example";
const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

const rawRow = (workspaceId: string) =>
  calendarConnectionsDb()
    .prepare(`SELECT client_id, client_secret FROM calendar_connections WHERE workspace_id = ? AND provider = 'google_client'`)
    .get(workspaceId) as { client_id: string; client_secret: string } | undefined;

test("round-trips; the column holds ciphertext, never the plaintext secret", () => {
  const status = saveGoogleClient({ clientId: ` ${ID} `, clientSecret: SECRET }, ws);
  assert.deepEqual(
    { saved: status.saved, clientId: status.clientId, hasSecret: status.hasSecret, unreadable: status.unreadable },
    { saved: true, clientId: ID, hasSecret: true, unreadable: false }
  );
  assert.equal(JSON.stringify(status).includes(SECRET), false, "the status view never carries the secret");
  const row = rawRow(ws);
  assert.ok(row);
  assert.match(row.client_secret, /^v1:/);
  assert.equal(row.client_secret.includes(SECRET), false);
  assert.deepEqual(getStoredGoogleClient(ws), { clientId: ID, clientSecret: SECRET });
});

test("rotation: a secret sealed under the retired key still opens through _PREVIOUS", () => {
  only({ KP_CALENDAR_SECRET_KEY: "old" });
  saveGoogleClient({ clientId: ID, clientSecret: SECRET }, ws);
  only({ KP_CALENDAR_SECRET_KEY: "new" });
  assert.equal(getStoredGoogleClient(ws), null, "the new key alone cannot open it");
  assert.equal(getStoredGoogleClientStatus(ws).unreadable, true, "and the panel is told to re-enter it");
  only({ KP_CALENDAR_SECRET_KEY: "new", KP_CALENDAR_SECRET_KEY_PREVIOUS: "old" });
  assert.deepEqual(getStoredGoogleClient(ws), { clientId: ID, clientSecret: SECRET });
});

test("a blank secret keeps the stored one; a first save needs both", () => {
  assert.throws(() => saveGoogleClient({ clientId: ID, clientSecret: "" }, ws), (e: unknown) => e instanceof GoogleClientInputError && e.reason === "client_secret_required");
  saveGoogleClient({ clientId: ID, clientSecret: SECRET }, ws);
  saveGoogleClient({ clientId: "5678-new.apps.googleusercontent.com", clientSecret: "  " }, ws);
  assert.deepEqual(getStoredGoogleClient(ws), { clientId: "5678-new.apps.googleusercontent.com", clientSecret: SECRET });
});

test("input is validated without echoing it", () => {
  for (const bad of ["", "short", "has space.apps.googleusercontent.com", 42]) {
    assert.throws(() => saveGoogleClient({ clientId: bad, clientSecret: SECRET }, ws), (e: unknown) => e instanceof GoogleClientInputError && e.reason === "client_id_invalid");
  }
  assert.throws(
    () => saveGoogleClient({ clientId: ID, clientSecret: "two words" }, ws),
    (e: unknown) => e instanceof GoogleClientInputError && e.reason === "client_secret_invalid" && !e.message.includes("two words")
  );
});

test("precedence: the stored client wins over env; env-only still works; neither is null", () => {
  const envPair = env({ GOOGLE_OAUTH_CLIENT_ID: "env-id.apps.googleusercontent.com", GOOGLE_OAUTH_CLIENT_SECRET: "env-secret" });
  assert.equal(googleOAuthConfigFor(ws, BASE, env({})), null);
  assert.deepEqual(googleOAuthConfigFor(ws, BASE, envPair), {
    clientId: "env-id.apps.googleusercontent.com",
    clientSecret: "env-secret",
    redirectUri: `${BASE}/api/calendar/google/callback`,
  });
  saveGoogleClient({ clientId: ID, clientSecret: SECRET }, ws);
  assert.deepEqual(googleOAuthConfigFor(ws, BASE, envPair), { clientId: ID, clientSecret: SECRET, redirectUri: `${BASE}/api/calendar/google/callback` });
  assert.equal(googleOAuthConfigFor(`${ws}-other`, BASE, envPair)?.clientId, "env-id.apps.googleusercontent.com", "another workspace never sees it");
});

test("an unreadable stored client falls back to env rather than failing", () => {
  saveGoogleClient({ clientId: ID, clientSecret: SECRET }, ws);
  only({ KP_CALENDAR_SECRET_KEY: "changed" });
  const envPair = env({ GOOGLE_OAUTH_CLIENT_ID: "env-id.apps.googleusercontent.com", GOOGLE_OAUTH_CLIENT_SECRET: "env-secret" });
  assert.equal(googleOAuthConfigFor(ws, BASE, envPair)?.clientId, "env-id.apps.googleusercontent.com");
});

const TOKENS = { accessToken: "ya29.access", refreshToken: "1//refresh", expiresAt: new Date(Date.now() + 3600_000).toISOString(), scopes: [] };

test("the client row is invisible to the grant: no phantom connection, and Disconnect keeps it", () => {
  saveGoogleClient({ clientId: ID, clientSecret: SECRET }, ws);
  assert.equal(getCalendarConnection(ws), null, "a saved client is not a connection");
  saveCalendarConnection({ tokens: TOKENS }, ws);
  assert.equal(getCalendarConnection(ws)?.connected, true);
  assert.equal(deleteCalendarConnection(ws), true);
  assert.equal(getCalendarConnection(ws), null);
  assert.deepEqual(getStoredGoogleClient(ws), { clientId: ID, clientSecret: SECRET }, "reconnecting does not mean re-pasting the client");
});

test("tokens already stored under KP_SECRET still decrypt (the ATS key keeps sealing them)", () => {
  only({ KP_SECRET: "existing-session-secret" });
  saveCalendarConnection({ tokens: TOKENS }, ws);
  // A row written before this change was sealed with encryptAtsSecret directly.
  calendarConnectionsDb()
    .prepare(`UPDATE calendar_connections SET refresh_token = ? WHERE workspace_id = ? AND provider = 'google'`)
    .run(encryptAtsSecret("1//legacy-refresh"), ws);
  assert.equal(getRefreshToken(ws), "1//legacy-refresh");
  // Adding the dedicated calendar key later changes nothing for the tokens.
  only({ KP_SECRET: "existing-session-secret", KP_CALENDAR_SECRET_KEY: "added-later" });
  assert.equal(getRefreshToken(ws), "1//legacy-refresh");
});

test("keyless install: tokens seal under the generated calendar key, and still open once KP_SECRET is set later", () => {
  only({ KP_CALENDAR_SECRET_KEY: "generated-calendar-key" });
  saveCalendarConnection({ tokens: TOKENS }, ws);
  assert.equal(getRefreshToken(ws), "1//refresh");
  only({ KP_CALENDAR_SECRET_KEY: "generated-calendar-key", KP_SECRET: "set-later" });
  assert.equal(getRefreshToken(ws), "1//refresh");
});
