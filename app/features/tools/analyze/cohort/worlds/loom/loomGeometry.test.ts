import { test } from "node:test";
import assert from "node:assert/strict";
import { GAP, KNOT_H, RIGHT, cutPaths, floatPath, layoutLoom, selvedgePath, slackAmp, warpPath } from "./loomGeometry.ts";

test("twenty threads fit kp's narrow frame (944px) with knots that hold a three-digit rating", () => {
  const geo = layoutLoom(944, 20, 7);
  assert.equal(geo.xs.length, 20);
  assert.ok(geo.pitch >= 36, `pitch ${geo.pitch}`);
  assert.ok(geo.knotW >= 30 && geo.knotW < geo.pitch, `knot ${geo.knotW} in pitch ${geo.pitch}`);
  assert.ok(geo.xs[19] + geo.pitch / 2 <= 944 - RIGHT + 0.01);
  assert.ok(geo.xs[0] - geo.pitch / 2 >= geo.gutter - 0.01);
  assert.equal(geo.ys.length, 7);
  assert.ok(geo.ys[1] - geo.ys[0] > KNOT_H.strong * 2, "rows leave room for a float between them");
  assert.ok(geo.clothEnd > geo.fell && geo.height > geo.clothEnd);
});

test("the layout depends on width and count only, and widens the gutter on a wide frame", () => {
  assert.deepEqual(layoutLoom(1392, 20, 7), layoutLoom(1392, 20, 7));
  assert.ok(layoutLoom(1392, 20, 7).gutter > layoutLoom(944, 20, 7).gutter);
  assert.ok(layoutLoom(1392, 20, 7).pitch > layoutLoom(944, 20, 7).pitch);
});

test("a tag never runs past the right edge: the last ones are clipped, the first ones are full", () => {
  const geo = layoutLoom(944, 20, 7);
  const cos = Math.cos((58 * Math.PI) / 180);
  geo.xs.forEach((x, i) => assert.ok(x + geo.tagMax[i] * cos <= 944 || geo.tagMax[i] === 48, `tag ${i}`));
  assert.equal(geo.tagMax[0], 150);
  assert.ok(geo.tagMax[19] < geo.tagMax[0]);
});

test("a warp keeps the same command structure taut and slack (CSS can tween it)", () => {
  const geo = layoutLoom(944, 20, 7);
  const behind = [false, false, true, false, false, false, false];
  const taut = warpPath(100, geo, geo.fell, behind, 0);
  const slack = warpPath(100, geo, geo.fell, behind, slackAmp(geo.pitch));
  const shape = (d: string) => d.replace(/[-\d.]+/g, "n");
  assert.equal(shape(taut), shape(slack));
  assert.notEqual(taut, slack);
  assert.equal((taut.match(/M/g) ?? []).length, 8, "beam->7 rows->end = 8 spans");
});

test("a thread that passes behind a row leaves a gap around it", () => {
  const geo = layoutLoom(944, 20, 7);
  const behind = [false, true, false, false, false, false, false];
  const d = warpPath(50, geo, geo.fell, behind, 0);
  const y1 = geo.ys[1];
  assert.ok(d.includes(`50 ${y1 - GAP}`), "the span above stops short");
  assert.ok(d.includes(`M50 ${y1 + GAP}`), "the span below starts after the gap");
  assert.ok(!d.includes(`50 ${y1}Q`) && !d.includes(` 50 ${y1}M`), "no span touches the row");
});

test("a float needs two knots and lifts above the row; a selvedge and a cut are drawn", () => {
  assert.equal(floatPath([10], 100, 26), null);
  const d = floatPath([300, 100, 200], 100, 26)!;
  assert.ok(d.startsWith("M100 "), "left to right");
  const ys = [...d.matchAll(/[MQ ]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2]));
  assert.ok(ys.every((y) => y < 100), "every point is above the row");
  assert.ok(selvedgePath(50, 0, 100).split("M").length > 4);
  const cut = cutPaths(40, 132);
  assert.ok(cut.stub.endsWith("154") && cut.fray.length > 0);
});
