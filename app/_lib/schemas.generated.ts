// AUTO-GENERATED — DO NOT EDIT.
// Source of truth: pipeline/jobfit/models.py
// Regenerate with: python -m pipeline.jobfit.codegen

import { z } from "zod";

export const analysisResultSchema = z.object({
  candidate: z.object({
    name: z.string().nullish(),
    rawText: z.string(),
    yearsExperience: z.number(),
    currentSeniority: z.string(),
    roleFamily: z.string(),
    skills: z.array(z.string()),
    educationLevel: z.string(),
    languages: z.array(z.string()),
    traits: z.array(z.string()),
    evidence: z.array(z.string())
  }),
  score: z.object({
    total: z.number(),
    experience: z.number(),
    skills: z.number(),
    roleSeniority: z.number(),
    education: z.number(),
    traits: z.number()
  }),
  salary: z.object({
    currency: z.string(),
    period: z.string(),
    minimum: z.number(),
    maximum: z.number(),
    midpoint: z.number(),
    confidence: z.string(),
    rationale: z.array(z.string())
  }),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  recommendations: z.array(z.string()),
  explanation: z.string(),
  sanityChecks: z.array(z.string()),
  jobFit: z.object({
    score: z.number(),
    summary: z.string(),
    matchingSkills: z.array(z.string()),
    missingSkills: z.array(z.string()),
    seniorityAlignment: z.string(),
    roleAlignment: z.string(),
    salaryAssessment: z.string(),
    recommendations: z.array(z.string()),
    interviewTalkingPoints: z.array(z.string()),
    cvRewriteSuggestions: z.array(z.string()),
    mustProveEvidence: z.array(z.string()),
    negotiationAngle: z.string(),
    recruiterRiskFlags: z.array(z.string())
  }).nullish(),
  metadata: z.object({
    analysisEngine: z.string(),
    textExtractor: z.string(),
    model: z.string().nullish(),
    parsingNotes: z.array(z.string()),
    groundingSources: z.array(z.string()),
    deterministicEvidence: z.object({
      detectedRoleFamily: z.string(),
      detectedSeniority: z.string().nullish(),
      anchorBand: z.array(z.number()),
      detectedSignals: z.array(z.string()),
      detectedSkills: z.array(z.string()),
      detectedCompanyType: z.string().nullish(),
      detectedCompanyModifiers: z.array(z.string())
    }).nullish()
  }).nullish(),
  marketEvidence: z.object({
    summary: z.string(),
    suggestedMinimum: z.number().nullish(),
    suggestedMaximum: z.number().nullish(),
    confidence: z.string(),
    sources: z.array(z.string()),
    notes: z.array(z.string())
  }).nullish(),
  extractionQuality: z.object({
    pypdfSkills: z.number(),
    geminiSkills: z.number(),
    pypdfLetterSpacingHits: z.number(),
    geminiLetterSpacingHits: z.number(),
    pypdfTextLength: z.number(),
    geminiTextLength: z.number(),
    recommendation: z.string()
  }).nullish(),
  extractionComparison: z.object({
    pypdfText: z.string(),
    geminiText: z.string()
  }).nullish(),
  companyContext: z.object({
    companyType: z.string(),
    salaryEffect: z.string(),
    adjustmentFactor: z.number(),
    rationale: z.array(z.string())
  }).nullish(),
  evidenceTrace: z.object({
    experience: z.array(z.string()),
    skills: z.array(z.string()),
    seniority: z.array(z.string()),
    education: z.array(z.string()),
    salary: z.array(z.string())
  }).nullish(),
  interviewKit: z.object({
    summary: z.string(),
    questions: z.array(z.object({
      bucket: z.string(),
      question: z.string(),
      evidenceGap: z.string(),
      starScaffold: z.object({
        situation: z.string(),
        task: z.string(),
        action: z.string(),
        result: z.string()
      })
    }))
  }).nullish(),
  keywordCoverage: z.object({
    coveragePercent: z.number(),
    hits: z.array(z.object({
      keyword: z.string(),
      inJd: z.number(),
      inCv: z.number(),
      matched: z.boolean(),
      status: z.enum(["matched", "missing", "over_used"])
    })),
    missing: z.array(z.string()),
    overUsed: z.array(z.string()),
    hitsTotal: z.number().nullish(),
    missingTotal: z.number().nullish(),
    overUsedTotal: z.number().nullish()
  }).nullish(),
  softSignals: z.object({
    displayName: z.string().nullish(),
    antipatterns: z.array(z.object({
      key: z.string(),
      kind: z.string(),
      label: z.string(),
      detail: z.string(),
      evidence: z.array(z.string()),
      confidence: z.number(),
      source: z.string(),
      needsConfirmation: z.boolean(),
      suggestedProbe: z.string(),
      probeKind: z.string().nullish()
    })),
    strengths: z.array(z.object({
      key: z.string(),
      kind: z.string(),
      label: z.string(),
      detail: z.string(),
      evidence: z.array(z.string()),
      confidence: z.number(),
      source: z.string(),
      needsConfirmation: z.boolean(),
      suggestedProbe: z.string(),
      probeKind: z.string().nullish()
    })),
    summary: z.string()
  }).nullish(),
  v2Profile: z.record(z.string(), z.unknown()).nullish()
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;
