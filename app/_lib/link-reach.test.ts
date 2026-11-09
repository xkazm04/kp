// Pins linkReach (CX S39): which audience can open a candidate link built on an origin.
// Runner: node:test with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkReach } from "./link-reach.ts";

test("this computer: loopback names and addresses, with or without a port", () => {
  for (const o of [
    "http://localhost:3000",
    "http://LOCALHOST",
    "https://app.localhost:8443",
    "http://127.0.0.1:3000",
    "http://127.10.20.30",
    "http://[::1]:3000",
    "http://0.0.0.0:3000",
    "http://[::]:3000",
    "http://[::ffff:127.0.0.1]:3000",
    "localhost:3000",
  ]) {
    assert.equal(linkReach(o), "this-computer", o);
  }
});

test("local network: private ranges, link-local, mDNS and dotless host names", () => {
  for (const o of [
    "http://10.0.0.5:3000",
    "http://172.16.0.1",
    "http://172.31.255.254",
    "http://192.168.1.20:3000",
    "http://169.254.10.10",
    "http://100.101.102.103",
    "http://[fe80::1]",
    "http://[fd12:3456::1]:3000",
    "http://[::ffff:192.168.0.1]",
    "http://my-laptop.local:3000",
    "http://my-laptop:3000",
  ]) {
    assert.equal(linkReach(o), "local-network", o);
  }
});

test("public: a real host name or a routable address", () => {
  for (const o of [
    "https://jobs.example.com",
    "https://kandidate.example.cz/",
    "http://172.32.0.1",
    "http://172.15.0.1",
    "http://8.8.8.8",
    "http://100.128.0.1",
    "http://[2001:db8::1]",
    "https://localhost.example.com",
  ]) {
    assert.equal(linkReach(o), "public", o);
  }
});

test("never calls an unusable origin public", () => {
  assert.equal(linkReach(""), "this-computer");
  assert.equal(linkReach("   "), "this-computer");
  assert.equal(linkReach("http://"), "this-computer");
});

test("a full candidate URL is judged by its host only", () => {
  assert.equal(linkReach("http://localhost:3000/apply/job-1?lang=cs"), "this-computer");
  assert.equal(linkReach("https://jobs.example.com/apply/job-1"), "public");
});

test("nowhere: the reserved placeholder publicBaseUrl falls back to, and its siblings", () => {
  for (const o of ["https://kandidate.example", "https://kandidate.example/", "http://app.test:3000", "http://x.invalid", "https://example"]) {
    assert.equal(linkReach(o), "nowhere", o);
  }
  assert.equal(linkReach("https://example.com"), "public");
  assert.equal(linkReach("https://mytest.cz"), "public");
});
