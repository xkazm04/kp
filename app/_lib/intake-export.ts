import type { RoleBrief } from "./rolespec";

// The "hand it to the director/inspector" artifact (UAT drain §2.2, Eva:
// "obhájím to před ředitelem — čím?"): brief + numbered transcript + provenance
// annotations as one markdown document. Pure builder — labels arrive from the
// caller (next-intl translated), so the export reads in the dialog's language.

export type IntakeExportLabels = {
  title: string;
  role: string;
  seniority: string;
  outcomes: string;
  dealbreakers: string;
  niceToHave: string;
  languages: string;
  context: string;
  transcript: string;
  provenance: Record<string, string>; // stated | inferred | default → label
  weight: string;
  confidence: string;
  fromTurn: string; // e.g. "turn"
  agent: string;
  requestor: string;
  system: string;
};

export type IntakeExportInput = {
  title: string;
  createdAt?: string;
  brief: RoleBrief | null;
  transcript: { role: string; text: string; at?: string }[];
};

function prov(labels: IntakeExportLabels, value?: string): string {
  return labels.provenance[value ?? "default"] ?? value ?? "";
}

function reqLine(labels: IntakeExportLabels, r: NonNullable<RoleBrief["requirements"]>[number]): string {
  const bits = [
    `**${r.skill}**`,
    `${labels.weight} ${Math.round((r.weight ?? 0) * 100)}%`,
    `${labels.confidence} ${Math.round((r.confidence ?? 0) * 100)}%`,
    prov(labels, r.provenance),
  ];
  if (r.sourceTurn != null) bits.push(`${labels.fromTurn} [${r.sourceTurn}]`);
  const line = `- ${bits.join(" · ")}`;
  return r.rationale ? `${line}\n  - ${r.rationale}` : line;
}

export function buildIntakeExportMarkdown(input: IntakeExportInput, labels: IntakeExportLabels): string {
  const brief = input.brief;
  const lines: string[] = [`# ${labels.title}: ${input.title || "—"}`];
  if (input.createdAt) lines.push(`_${input.createdAt}_`);
  if (brief) {
    lines.push("", `## ${labels.role}`);
    const seniorityStated = brief.spineProvenance?.seniority === "stated";
    lines.push(
      `${brief.title || "—"} — ${labels.seniority}: ${brief.seniority ?? "—"} (${prov(
        labels,
        brief.spineProvenance?.seniority
      )})${seniorityStated ? "" : " ⚠"}`
    );
    const musts = (brief.requirements ?? []).filter((r) => r.kind === "must_have");
    const nices = (brief.requirements ?? []).filter((r) => r.kind === "nice_to_have");
    if ((brief.successCriteria ?? []).length) {
      lines.push("", `## ${labels.outcomes}`);
      for (const s of brief.successCriteria ?? []) lines.push(`- ${s}`);
    }
    if (musts.length) {
      lines.push("", `## ${labels.dealbreakers}`);
      for (const r of musts) lines.push(reqLine(labels, r));
    }
    if (nices.length) {
      lines.push("", `## ${labels.niceToHave}`);
      for (const r of nices) lines.push(reqLine(labels, r));
    }
    if ((brief.languages ?? []).length) {
      lines.push("", `## ${labels.languages}`, (brief.languages ?? []).join(", "));
    }
    if ((brief.facets ?? []).length) {
      lines.push("", `## ${labels.context}`);
      for (const f of brief.facets ?? []) {
        const bits = [prov(labels, f.provenance)];
        if (f.sourceTurn != null) bits.push(`${labels.fromTurn} [${f.sourceTurn}]`);
        lines.push(`- **${f.label || f.key}**: ${f.value} _(${bits.join(" · ")})_`);
      }
    }
  }
  lines.push("", `## ${labels.transcript}`);
  const roleLabel: Record<string, string> = {
    interviewer: labels.agent,
    candidate: labels.requestor,
    system: labels.system,
  };
  input.transcript.forEach((t, i) => {
    lines.push(`\n**[${i}] ${roleLabel[t.role] ?? t.role}:** ${t.text}`);
  });
  return lines.join("\n") + "\n";
}
