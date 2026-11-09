import test from "node:test";
import assert from "node:assert/strict";
import { crossSiteWriteRefused, isSameOriginExempt, SAME_ORIGIN_EXEMPT_PATHS, type SameOriginInput } from "./same-origin";
import { isPublicPath } from "./public-routes";

const base: SameOriginInput = {
  method: "POST",
  pathname: "/api/pipeline/m-1-2",
  origin: null,
  secFetchSite: null,
  host: "kp.example.com",
  forwardedHost: null,
};
const req = (o: Partial<SameOriginInput>) => crossSiteWriteRefused({ ...base, ...o });

test("cross-site Origin is refused", () => assert.equal(req({ origin: "https://evil.example" }), true));
test("matching Origin is allowed", () => assert.equal(req({ origin: "https://kp.example.com" }), false));
test("no Origin and no Sec-Fetch-Site (CLI / server-to-server) is allowed", () => assert.equal(req({}), false));
test("Sec-Fetch-Site cross-site is refused even with no Origin", () => assert.equal(req({ secFetchSite: "cross-site" }), true));
test("Sec-Fetch-Site same-origin and none are allowed", () => {
  assert.equal(req({ secFetchSite: "same-origin" }), false);
  assert.equal(req({ secFetchSite: "none" }), false);
});
test("Origin null is refused", () => assert.equal(req({ origin: "null" }), true));
test("forwarded-host match is allowed behind a reverse proxy", () => {
  const o = { host: "127.0.0.1:3000", forwardedHost: "kp.example.com", origin: "https://kp.example.com" };
  assert.equal(req(o), false);
  assert.equal(req({ ...o, origin: "https://evil.example" }), true);
});
test("configured base URL host is allowed", () =>
  assert.equal(req({ host: "internal:3000", origin: "https://kp.example.com", baseUrl: "https://kp.example.com" }), false));
test("GET/HEAD/OPTIONS are never refused", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) assert.equal(req({ method, origin: "https://evil.example", secFetchSite: "cross-site" }), false);
});
test("PUT, PATCH and DELETE are checked", () => {
  for (const method of ["PUT", "PATCH", "DELETE", "post"]) assert.equal(req({ method, origin: "https://evil.example" }), true);
});
test("non-/api paths are out of scope", () => assert.equal(req({ pathname: "/login", origin: "https://evil.example" }), false));
test("an exempt webhook path is allowed with a foreign Origin", () => {
  for (const p of SAME_ORIGIN_EXEMPT_PATHS) {
    const pathname = p.endsWith("/") ? p + "x" : p;
    assert.equal(req({ pathname, origin: "https://evil.example", secFetchSite: "cross-site" }), false, pathname);
  }
});
test("exempt set is explicit, public, and excludes candidate token doors", () => {
  assert.deepEqual([...SAME_ORIGIN_EXEMPT_PATHS], [
    "/api/billing/webhook",
    "/api/devcase/inbound",
    "/api/comms/callback",
    "/api/channels/inbound",
    "/api/agents/report/",
  ]);
  for (const p of SAME_ORIGIN_EXEMPT_PATHS) assert.equal(isPublicPath(p.endsWith("/") ? p + "x" : p), true, p);
  for (const p of ["/api/offer/tok", "/api/apply/1", "/api/schedule/tok", "/api/interview/connect", "/api/stop/t", "/api/billing/webhookx"])
    assert.equal(isSameOriginExempt(p), false, p);
});
test("Origin null is refused even when the Host header is literally 'null'", () =>
  assert.equal(req({ origin: "null", host: "null" }), true));
