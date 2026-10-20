import { test } from "node:test";
import assert from "node:assert/strict";
import { localizeConfidenceDrivers } from "@/app/features/shared/matchLabels";
import type { Confidence } from "@/app/features/shared/matchTypes";

const translate = Object.assign((key: string) => `local:${key}`, { has: (key: string) => key === "known" });
const confidence = (driverCodes?: Confidence["driverCodes"]): Confidence => ({
  low: 30, high: 70, level: "wide", drivers: ["first", "second"], driverCodes,
});

test("driver codes localize in parallel and preserve the English fallback", () => {
  assert.deepEqual(localizeConfidenceDrivers(confidence([{ code: "known" }, { code: "missing" }]), translate), ["local:known", "second"]);
});

test("a partial driver code list does not discard the remaining driver", () => {
  assert.deepEqual(localizeConfidenceDrivers(confidence([{ code: "known" }]), translate), ["first", "second"]);
  assert.deepEqual(localizeConfidenceDrivers(confidence(), translate), ["first", "second"]);
});
