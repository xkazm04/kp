// Pins the candidate-link origin contract (idea-e6c66bcd): both client and server
// resolve outward-facing links through publicBaseUrl with one explicit precedence
// — APP_BASE_URL, then the NEXT_PUBLIC_ mirror, then the live request/window
// origin — so a proxy or a localhost recruiter can't make candidate links diverge.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { publicBaseUrl } from "./public-base-url.ts";

const ORIGINAL_APP = process.env.APP_BASE_URL;
const ORIGINAL_PUBLIC = process.env.NEXT_PUBLIC_APP_BASE_URL;

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  setEnv("APP_BASE_URL", ORIGINAL_APP);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", ORIGINAL_PUBLIC);
});

test("falls back to the runtime origin when nothing is configured", () => {
  setEnv("APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  assert.equal(publicBaseUrl("https://app.example.com"), "https://app.example.com");
});

test("APP_BASE_URL wins over the runtime origin (the deploy-time footgun fix)", () => {
  setEnv("APP_BASE_URL", "https://public.example.com");
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  // The recruiter is on localhost but candidates must get the public host.
  assert.equal(publicBaseUrl("http://localhost:3000"), "https://public.example.com");
});

test("uses the NEXT_PUBLIC_ mirror when the server-only var is unset", () => {
  setEnv("APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", "https://mirror.example.com");
  assert.equal(publicBaseUrl("http://localhost:3000"), "https://mirror.example.com");
});

test("APP_BASE_URL takes precedence over the NEXT_PUBLIC_ mirror server-side", () => {
  setEnv("APP_BASE_URL", "https://server.example.com");
  setEnv("NEXT_PUBLIC_APP_BASE_URL", "https://mirror.example.com");
  assert.equal(publicBaseUrl("http://localhost:3000"), "https://server.example.com");
});

test("strips a trailing slash so appending a path never doubles up", () => {
  setEnv("APP_BASE_URL", "https://public.example.com/");
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  assert.equal(publicBaseUrl("http://localhost:3000") + "/offer/abc", "https://public.example.com/offer/abc");
});

test("ignores a blank/whitespace override and falls through to the origin", () => {
  setEnv("APP_BASE_URL", "   ");
  setEnv("NEXT_PUBLIC_APP_BASE_URL", "");
  assert.equal(publicBaseUrl("https://app.example.com"), "https://app.example.com");
});

test("returns empty string when neither an override nor an origin is available (SSR before hydration)", () => {
  setEnv("APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  assert.equal(publicBaseUrl(""), "");
  assert.equal(publicBaseUrl(undefined), "");
});
