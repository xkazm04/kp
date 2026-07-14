import { NextResponse } from "next/server";
import { analysisCalibrationBandCandidates, pipelineCalibrationBandCandidates } from "@/app/_lib/db";
import { CALIBRATION_BIN_COUNT } from "@/app/_lib/calibration";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonError } from "@/app/_lib/api-response";


// Direction 2 — "every number opens its candidates". The candidates that sit in
// ONE calibration score band (bin), workspace-scoped, so a mis-calibrated bin can
// be opened to see exactly who is in it — each linking onward to the board.
// Reads the SAME scoped calibration producers the curve is built from, so a
// bin's drilldown can never diverge from the dot it was clicked on. Read-only.
//
// ?bin=0..9 (the fixed 10 probability bins) · ?source=pipeline|analysis
//   (default pipeline) · ?roleFamily= mirrors the panel's family selector.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const source = params.get("source") === "analysis" ? "analysis" : "pipeline";
    const roleFamily = params.get("roleFamily");
    const bin = Number(params.get("bin"));
    if (!Number.isInteger(bin) || bin < 0 || bin >= CALIBRATION_BIN_COUNT) {
      return NextResponse.json({ error: "bin must be an integer in [0, 9]." }, { status: 400 });
    }
    // Each bin spans 10 score points; the last bin includes 100 (mirrors the
    // binIndex rule in calibration.ts, where prob === 1 lands in the last bin).
    const loPct = bin * (100 / CALIBRATION_BIN_COUNT);
    const hiPct = (bin + 1) * (100 / CALIBRATION_BIN_COUNT);
    const inclusiveHi = bin === CALIBRATION_BIN_COUNT - 1;
    const ws = await currentWorkspace();
    const family = roleFamily || null;

    if (source === "analysis") {
      const rows = analysisCalibrationBandCandidates(loPct, hiPct, inclusiveHi, family, ws);
      // An analysis is not a board entry — link each by candidate label through the
      // board's text filter (no live entry id), so the shape stays uniform.
      const candidates = rows.map((r) => ({ label: r.label, score: r.score, outcome: r.outcome, entryId: null, live: false }));
      return NextResponse.json({ bin, lo: loPct, hi: hiPct, source, candidates });
    }
    const rows = pipelineCalibrationBandCandidates(loPct, hiPct, inclusiveHi, family, ws);
    const candidates = rows.map((r) => ({ label: r.label, score: r.score, outcome: r.outcome, entryId: r.entryId, live: r.live }));
    return NextResponse.json({ bin, lo: loPct, hi: hiPct, source, candidates });
  } catch (error) {
    return jsonError(error, "Failed to load the score band.");
  }
}
