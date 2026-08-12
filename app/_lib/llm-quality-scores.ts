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
        "p50Ms": 13561
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 17484
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 3,
        "llmRate": 0.75,
        "p50Ms": 51186
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 15992
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
        "p50Ms": 16875
      },
      "deepseek-v4-flash": {
        "relevance": 8.0,
        "correctness": 8.0,
        "adherence": 7.0,
        "score": 7.0,
        "valid": true,
        "judges": 3,
        "llmRate": 0.75,
        "p50Ms": 10327
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 8.0,
        "score": 7.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 39030
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 18883
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
        "p50Ms": 13733
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.5,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 25492
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 34694
      },
      "claude-opus-5": {
        "relevance": 9.5,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 23992
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
        "p50Ms": 7234
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 10335
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 16250
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 16343
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
        "p50Ms": 17264
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 38257
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 35788
      },
      "claude-opus-5": {
        "relevance": 9.5,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 30890
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
        "p50Ms": 8921
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 17921
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 23320
      },
      "claude-opus-5": {
        "relevance": 10.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 42444
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
        "p50Ms": 19976
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 39640
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.0,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 54952
      },
      "claude-opus-5": {
        "relevance": 9.5,
        "correctness": 9.0,
        "adherence": 8.5,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 89499
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
        "p50Ms": 10250
      },
      "deepseek-v4-flash": {
        "relevance": 8.0,
        "correctness": 8.5,
        "adherence": 8.0,
        "score": 7.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 17210
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.5,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 29725
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 22663
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
        "p50Ms": 10069
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 24554
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 16975
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13351
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
        "p50Ms": 10484
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13054
      },
      "claude-sonnet-5": {
        "relevance": 9.5,
        "correctness": 9.0,
        "adherence": 10.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 16827
      },
      "claude-opus-5": {
        "relevance": 10.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13312
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
        "p50Ms": 13953
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 30874
      },
      "claude-sonnet-5": {
        "relevance": 9.5,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 43273
      },
      "claude-opus-5": {
        "relevance": 10.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 42515
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
        "p50Ms": 9852
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 16351
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 17117
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13367
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
        "p50Ms": 13264
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 22062
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 19273
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 13062
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
        "p50Ms": 9093
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 14085
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 15531
      },
      "claude-opus-5": {
        "relevance": 10.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 18960
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
        "p50Ms": 63374
      },
      "deepseek-v4-flash": {
        "relevance": 8.5,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 145296
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 3,
        "llmRate": 0.75,
        "p50Ms": 151250
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 4,
        "llmRate": 1.0,
        "p50Ms": 74585
      }
    }
  }
};

/** True once a matrix run has been baked in (so the UI can hide the scorecard
 *  before any measurement exists). */
export function hasQualityScores(): boolean {
  return QUALITY_SCORES.models.length > 0 && Object.keys(QUALITY_SCORES.cells).length > 0;
}
