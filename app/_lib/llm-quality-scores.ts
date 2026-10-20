/** Measured LLM quality scores — the output of the Python bench matrix
 *  (`pipeline/jobfit/llm/bench`), judged by the Claude CLI, baked by
 *  `bake_quality.py`. GENERATED — re-bake, don't hand-edit. See
 *  docs/architecture/llm-model-matrix.md.
 *  Baked from a run at 2026-08-12T00:49:23.000Z. */
import type { QualityScores } from "./llm-quality";

export const QUALITY_SCORES: QualityScores = {
  "measuredAt": "2026-08-12T00:49:23.000Z",
  "judge": "fable-5",
  "limit": 4,
  "models": [
    "gemini-3.6-flash",
    "deepseek-v4-flash",
    "claude-sonnet-5",
    "claude-opus-5"
  ],
  "cells": {
    "automation_offer": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13561,
        "costPerTaskUsd": 0.003795
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 17484,
        "costPerTaskUsd": 0.000571
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 3,
        "llmRate": 0.75,
        "p50Ms": 51186,
        "costPerTaskUsd": 0.20456
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 15992,
        "costPerTaskUsd": 0.231733
      }
    },
    "automation_outreach": {
      "gemini-3.6-flash": {
        "relevance": 6.0,
        "correctness": 9.0,
        "adherence": 8.0,
        "score": 7.0,
        "valid": true,
        "judges": 3,
        "llmRate": 0.75,
        "p50Ms": 16875,
        "costPerTaskUsd": 0.003471
      },
      "deepseek-v4-flash": {
        "relevance": 8.0,
        "correctness": 8.0,
        "adherence": 7.0,
        "score": 7.0,
        "valid": true,
        "judges": 3,
        "llmRate": 0.75,
        "p50Ms": 10327,
        "costPerTaskUsd": 0.000338
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 8.0,
        "score": 7.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 39030,
        "costPerTaskUsd": 0.178485
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 18883,
        "costPerTaskUsd": 0.230484
      }
    },
    "automation_rejection": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13733,
        "costPerTaskUsd": 0.00423
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.5,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 25492,
        "costPerTaskUsd": 0.000823
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 34694,
        "costPerTaskUsd": 0.175507
      },
      "claude-opus-5": {
        "relevance": 9.5,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 23992,
        "costPerTaskUsd": 0.238468
      }
    },
    "automation_screen": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 7234,
        "costPerTaskUsd": 0.002242
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 10335,
        "costPerTaskUsd": 0.000296
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 16250,
        "costPerTaskUsd": 0.148001
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 16343,
        "costPerTaskUsd": 0.233536
      }
    },
    "campaign_pack": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 17264,
        "costPerTaskUsd": 0.012365
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 38257,
        "costPerTaskUsd": 0.000956
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 35788,
        "costPerTaskUsd": 0.184428
      },
      "claude-opus-5": {
        "relevance": 9.5,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 30890,
        "costPerTaskUsd": 0.273011
      }
    },
    "devcase_analyze": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 8921,
        "costPerTaskUsd": 0.004142
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 17921,
        "costPerTaskUsd": 0.000508
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 23320,
        "costPerTaskUsd": 0.158278
      },
      "claude-opus-5": {
        "relevance": 10.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 42444,
        "costPerTaskUsd": 0.275177
      }
    },
    "devcase_case_design": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 7.5,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 19976,
        "costPerTaskUsd": 0.012682
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 39640,
        "costPerTaskUsd": 0.000999
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.0,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 54952,
        "costPerTaskUsd": 0.206835
      },
      "claude-opus-5": {
        "relevance": 9.5,
        "correctness": 9.0,
        "adherence": 8.5,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 89499,
        "costPerTaskUsd": 0.357903
      }
    },
    "devcase_interview_scenario": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 10250,
        "costPerTaskUsd": 0.007351
      },
      "deepseek-v4-flash": {
        "relevance": 8.0,
        "correctness": 8.5,
        "adherence": 8.0,
        "score": 7.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 17210,
        "costPerTaskUsd": 0.00071
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.5,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 29725,
        "costPerTaskUsd": 0.179298
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 22663,
        "costPerTaskUsd": 0.267636
      }
    },
    "devcase_role_design": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 10069,
        "costPerTaskUsd": 0.00498
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 24554,
        "costPerTaskUsd": 0.000754
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 16975,
        "costPerTaskUsd": 0.164102
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13351,
        "costPerTaskUsd": 0.247063
      }
    },
    "group_compare": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 10484,
        "costPerTaskUsd": 0.00428
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13054,
        "costPerTaskUsd": 0.000428
      },
      "claude-sonnet-5": {
        "relevance": 9.5,
        "correctness": 9.0,
        "adherence": 10.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 16827,
        "costPerTaskUsd": 0.147776
      },
      "claude-opus-5": {
        "relevance": 10.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13312,
        "costPerTaskUsd": 0.232341
      }
    },
    "interview_prep": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13953,
        "costPerTaskUsd": 0.007503
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 30874,
        "costPerTaskUsd": 0.00077
      },
      "claude-sonnet-5": {
        "relevance": 9.5,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 43273,
        "costPerTaskUsd": 0.186239
      },
      "claude-opus-5": {
        "relevance": 10.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 42515,
        "costPerTaskUsd": 0.274363
      }
    },
    "interview_scorecard": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 8.5,
        "score": 7.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 9852,
        "costPerTaskUsd": 0.004204
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 16351,
        "costPerTaskUsd": 0.00057
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 17117,
        "costPerTaskUsd": 0.159212
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13367,
        "costPerTaskUsd": 0.237712
      }
    },
    "jd_ingest": {
      "gemini-3.6-flash": {
        "relevance": 8.5,
        "correctness": 6.5,
        "adherence": 8.5,
        "score": 7.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13264,
        "costPerTaskUsd": 0.006236
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 22062,
        "costPerTaskUsd": 0.000773
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 19273,
        "costPerTaskUsd": 0.163731
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13062,
        "costPerTaskUsd": 0.245046
      }
    },
    "match_reasoning": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 9093,
        "costPerTaskUsd": 0.003608
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 14085,
        "costPerTaskUsd": 0.00046
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 15531,
        "costPerTaskUsd": 0.166938
      },
      "claude-opus-5": {
        "relevance": 10.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 18960,
        "costPerTaskUsd": 0.245359
      }
    },
    "weight_proposal": {
      "gemini-3.6-flash": {
        "relevance": 5.5,
        "correctness": 5.5,
        "adherence": 6.0,
        "score": 5.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 63374,
        "costPerTaskUsd": 0.05591
      },
      "deepseek-v4-flash": {
        "relevance": 8.5,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 145296,
        "costPerTaskUsd": 0.006006
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 3,
        "llmRate": 0.75,
        "p50Ms": 151250,
        "costPerTaskUsd": 0.543102
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 74585,
        "costPerTaskUsd": 0.584153
      }
    }
  },
  "targets": {
    "gemini-3.6-flash": {
      "provider": "gemini",
      "model": "gemini-3.6-flash"
    },
    "deepseek-v4-flash": {
      "provider": "qwen",
      "model": "deepseek-v4-flash"
    },
    "claude-sonnet-5": {
      "provider": "claude_cli",
      "model": "claude-sonnet-5"
    },
    "claude-opus-5": {
      "provider": "claude_cli",
      "model": "claude-opus-5"
    }
  }
};

/** True once a matrix run has been baked in (so the UI can hide the scorecard
 *  before any measurement exists). */
export function hasQualityScores(): boolean {
  return QUALITY_SCORES.models.length > 0 && Object.keys(QUALITY_SCORES.cells).length > 0;
}
