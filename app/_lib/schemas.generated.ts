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
    evidence: z.array(z.string()),
    credentials: z.array(z.object({
      name: z.string(),
      issuer: z.string(),
      identifier: z.string(),
      expiry: z.string(),
      kind: z.string()
    })).nullish(),
    publications: z.array(z.object({
      title: z.string(),
      venue: z.string(),
      year: z.string(),
      kind: z.string()
    })).nullish(),
    links: z.array(z.string()).nullish()
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
    rationale: z.array(z.string()),
    structureNote: z.string().nullish()
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
    recruiterRiskFlags: z.array(z.string()),
    unprovenSkills: z.array(z.string()).nullish(),
    unprovenSkillStrength: z.record(z.string(), z.number()).nullish(),
    unprovenSkillReason: z.record(z.string(), z.string()).nullish()
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
    }).nullish(),
    runCost: z.object({
      model: z.string().nullish(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      cachedTokens: z.number().nullish(),
      costUsd: z.number().nullish(),
      estimated: z.boolean()
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

export const roleSpecSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  roleFamily: z.string(),
  mustHaves: z.array(z.string()),
  niceToHaves: z.array(z.string()),
  responsibilities: z.array(z.string()),
  languages: z.array(z.string()),
  promptVersion: z.string()
});

export type RoleSpec = z.infer<typeof roleSpecSchema>;

export const roleBriefSchema = z.object({
  schemaVersion: z.number(),
  title: z.string(),
  seniority: z.string(),
  roleFamily: z.string(),
  languages: z.array(z.string()),
  summary: z.string(),
  responsibilities: z.array(z.string()),
  successCriteria: z.array(z.string()),
  requirements: z.array(z.object({
    skill: z.string(),
    kind: z.string(),
    hardness: z.string(),
    weight: z.number(),
    rationale: z.string(),
    provenance: z.string(),
    confidence: z.number(),
    sourceTurn: z.number().nullish()
  })),
  facets: z.array(z.object({
    key: z.string(),
    label: z.string(),
    value: z.string(),
    importance: z.string(),
    provenance: z.string(),
    confidence: z.number(),
    sourceTurn: z.number().nullish()
  })),
  spineProvenance: z.record(z.string(), z.string()),
  promptVersion: z.string()
});

export type RoleBrief = z.infer<typeof roleBriefSchema>;

export const appMasterSpecSchema = z.object({
  schemaVersion: z.number(),
  role: z.object({
    title: z.string(),
    population: z.enum(["human", "agent", "either"]),
    seniority: z.string(),
    rubricVersion: z.string()
  }),
  app: z.object({
    name: z.string(),
    repo: z.object({
      url: z.string().nullish(),
      rootPath: z.string().nullish(),
      mainBranch: z.string()
    }),
    contextMapRef: z.string().nullish(),
    dossierId: z.string().nullish()
  }),
  objectives: z.array(z.object({
    kpiKey: z.string(),
    label: z.string(),
    baseline: z.number().nullish(),
    target: z.number().nullish(),
    unit: z.string(),
    direction: z.enum(["gte", "lte"]),
    windowDays: z.number()
  })),
  mandate: z.object({
    scopeRung: z.number(),
    forbiddenClasses: z.array(z.enum(["test_deletion_or_skip", "suppression_directive", "gate_configuration", "dependency_bump_to_satisfy_check", "credentials_or_permissions", "delivery_configuration"])),
    approvalGates: z.array(z.string()),
    owner: z.string()
  }),
  cadence: z.object({
    triggers: z.array(z.object({
      kind: z.enum(["schedule", "pr", "kpi_tick"]),
      config: z.record(z.string(), z.unknown())
    }))
  }),
  budget: z.object({
    monthlyUsd: z.number(),
    reservationPolicy: z.enum(["estimate", "fixed"]),
    onCap: z.literal("drain")
  }),
  tenure: z.object({
    probationDays: z.number(),
    reviewCadenceDays: z.number(),
    retireCriteria: z.array(z.string())
  }),
  agent: z.object({
    name: z.string(),
    mission: z.string(),
    systemPromptDraft: z.string(),
    connectors: z.array(z.string()),
    maxTurns: z.number().nullish()
  }).nullish(),
  human: z.object({
    jdSlug: z.string(),
    compBandRef: z.string()
  }).nullish(),
  coercionNotes: z.array(z.string()),
  promptVersion: z.string()
});

export type AppMasterSpec = z.infer<typeof appMasterSpecSchema>;

export const repoDossierSchema = z.object({
  dossierId: z.string(),
  repo: z.object({
    url: z.string().nullish(),
    rootPath: z.string().nullish(),
    mainBranch: z.string()
  }),
  source: z.enum(["llm", "heuristic"]),
  generatedAt: z.string(),
  stack: z.array(z.string()),
  size: z.object({
    files: z.number(),
    sourceFiles: z.number(),
    contexts: z.number()
  }),
  declaredGates: z.array(z.string()),
  contexts: z.array(z.object({
    name: z.string(),
    category: z.string(),
    fileCount: z.number()
  })),
  hotSpots: z.array(z.object({
    ref: z.string(),
    note: z.string()
  })),
  riskAreas: z.array(z.object({
    ref: z.string(),
    note: z.string()
  })),
  existingKpis: z.array(z.string()),
  maintainerLoadEstimate: z.string(),
  candidateObjectives: z.array(z.object({
    kpiKey: z.string(),
    label: z.string(),
    baseline: z.number().nullish(),
    target: z.number().nullish(),
    unit: z.string(),
    direction: z.enum(["gte", "lte"]),
    windowDays: z.number()
  })),
  fieldProvenance: z.record(z.string(), z.string()),
  promptVersion: z.string()
});

export type RepoDossier = z.infer<typeof repoDossierSchema>;

export const performanceBackboneSchema = z.object({
  windowDays: z.number(),
  proposalsOpened: z.number(),
  proposalsMerged: z.number(),
  proposalsReverted: z.number(),
  gatePassRate: z.number().nullish(),
  forbiddenClassViolations: z.number(),
  kpiDeltas: z.array(z.object({
    kpiKey: z.string(),
    baseline: z.number().nullish(),
    current: z.number().nullish(),
    target: z.number().nullish(),
    direction: z.enum(["gte", "lte"]),
    windowDays: z.number(),
    measured: z.boolean()
  })),
  budgetReservedUsd: z.number(),
  budgetSettledUsd: z.number(),
  budgetUnmeasured: z.boolean(),
  ledgerConsistent: z.boolean()
});

export type PerformanceBackbone = z.infer<typeof performanceBackboneSchema>;
