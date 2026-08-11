/** Measured LLM quality scores — the output of the Python bench matrix
 *  (`pipeline/jobfit/llm/bench`), judged by the Claude CLI, baked by
 *  `bake_quality.py`. GENERATED — re-bake, don't hand-edit. See
 *  docs/architecture/llm-model-matrix.md.
 *  Baked from a run at 2026-08-11T13:45:50.000Z. */
import type { QualityScores } from "./llm-quality";

export const QUALITY_SCORES: QualityScores = {
  "measuredAt": "2026-08-11T13:45:50.000Z",
  "judge": "fable-5",
  "limit": 2,
  "models": [
    "gemini-3.6-flash",
    "deepseek-v4-flash",
    "claude-sonnet-5",
    "claude-opus-5"
  ],
  "cells": {
    "automation_offer": {
      "gemini-3.6-flash": {
        "relevance": 8.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 7976
      },
      "deepseek-v4-flash": {
        "relevance": 7.5,
        "correctness": 9.0,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 17038
      },
      "claude-sonnet-5": {
        "relevance": 7.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 24031
      },
      "claude-opus-5": {
        "relevance": 8.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 17562
      }
    },
    "automation_outreach": {
      "gemini-3.6-flash": {
        "relevance": 5.0,
        "correctness": 6.5,
        "adherence": 7.0,
        "score": 5.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 8632
      },
      "deepseek-v4-flash": {
        "relevance": 5.0,
        "correctness": 7.5,
        "adherence": 5.5,
        "score": 5.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 12289
      },
      "claude-sonnet-5": {
        "relevance": 4.5,
        "correctness": 6.5,
        "adherence": 6.0,
        "score": 5.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 32757
      },
      "claude-opus-5": {
        "relevance": 5.5,
        "correctness": 8.5,
        "adherence": 7.5,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 17211
      }
    },
    "automation_rejection": {
      "gemini-3.6-flash": {
        "relevance": 5.5,
        "correctness": 4.0,
        "adherence": 7.5,
        "score": 5.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10250
      },
      "deepseek-v4-flash": {
        "relevance": 6.0,
        "correctness": 5.0,
        "adherence": 7.5,
        "score": 5.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 13320
      },
      "claude-sonnet-5": {
        "relevance": 6.5,
        "correctness": 6.5,
        "adherence": 8.0,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 28858
      },
      "claude-opus-5": {
        "relevance": 5.5,
        "correctness": 5.0,
        "adherence": 7.0,
        "score": 5.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 24616
      }
    },
    "automation_screen": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 5694
      },
      "deepseek-v4-flash": {
        "relevance": 8.5,
        "correctness": 6.5,
        "adherence": 9.0,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 7765
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 19210
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.5,
        "score": 8.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 19382
      }
    },
    "campaign_pack": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 20179
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 30233
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 41515
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 34382
      }
    },
    "devcase_analyze": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10406
      },
      "deepseek-v4-flash": {
        "relevance": 8.5,
        "correctness": 7.5,
        "adherence": 8.0,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 14562
      },
      "claude-sonnet-5": {
        "relevance": 9.5,
        "correctness": 7.5,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 30601
      },
      "claude-opus-5": {
        "relevance": 9.5,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 53038
      }
    },
    "devcase_case_design": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 19406
      },
      "deepseek-v4-flash": {
        "relevance": 8.5,
        "correctness": 8.5,
        "adherence": 7.0,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 36937
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.5,
        "score": 8.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 60593
      },
      "claude-opus-5": {
        "relevance": 9.5,
        "correctness": 9.0,
        "adherence": 8.5,
        "score": 8.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 97210
      }
    },
    "devcase_interview_scenario": {
      "gemini-3.6-flash": {
        "relevance": 8.5,
        "correctness": 8.0,
        "adherence": 7.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 12085
      },
      "deepseek-v4-flash": {
        "relevance": 8.5,
        "correctness": 7.5,
        "adherence": 7.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 20554
      },
      "claude-sonnet-5": {
        "relevance": 8.0,
        "correctness": 7.5,
        "adherence": 6.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 20749
      },
      "claude-opus-5": {
        "relevance": 9.5,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 28054
      }
    },
    "devcase_role_design": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10796
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 13851
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 20499
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 6.5,
        "adherence": 8.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 26516
      }
    },
    "group_compare": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 10.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10422
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 9358
      },
      "claude-sonnet-5": {
        "relevance": 9.5,
        "correctness": 8.0,
        "adherence": 9.5,
        "score": 9.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 22453
      },
      "claude-opus-5": {
        "relevance": 10.0,
        "correctness": 9.5,
        "adherence": 8.5,
        "score": 8.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 22218
      }
    },
    "interview_prep": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 10.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 1,
        "llmRate": 0.5,
        "p50Ms": 11483
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 1,
        "llmRate": 0.5,
        "p50Ms": 13702
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 29913
      },
      "claude-opus-5": {
        "relevance": 9.5,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 43030
      }
    },
    "interview_scorecard": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10008
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 8.5,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 20070
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 9.0,
        "score": 9.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 23038
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.5,
        "score": 8.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 19343
      }
    },
    "jd_ingest": {
      "gemini-3.6-flash": {
        "relevance": 5.0,
        "correctness": 3.5,
        "adherence": 4.0,
        "score": 4.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10179
      },
      "deepseek-v4-flash": {
        "relevance": 8.0,
        "correctness": 6.0,
        "adherence": 6.0,
        "score": 6.0,
        "valid": true,
        "judges": 1,
        "llmRate": 0.5,
        "p50Ms": 11922
      },
      "claude-sonnet-5": {
        "relevance": 8.5,
        "correctness": 5.5,
        "adherence": 7.0,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 22202
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 6.5,
        "adherence": 7.0,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 18375
      }
    },
    "match_reasoning": {
      "gemini-3.6-flash": {
        "relevance": 9.0,
        "correctness": 9.0,
        "adherence": 8.5,
        "score": 8.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 7226
      },
      "deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 11992
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 19906
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 26030
      }
    },
    "weight_proposal": {
      "gemini-3.6-flash": {
        "relevance": 6.0,
        "correctness": 8.0,
        "adherence": 7.5,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 63577
      },
      "deepseek-v4-flash": {
        "relevance": 8.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 127444
      },
      "claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 6.0,
        "adherence": 9.0,
        "score": 7.0,
        "valid": true,
        "judges": 1,
        "llmRate": 0.5,
        "p50Ms": 140922
      },
      "claude-opus-5": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 78905
      }
    }
  }
};

/** True once a matrix run has been baked in (so the UI can hide the scorecard
 *  before any measurement exists). */
export function hasQualityScores(): boolean {
  return QUALITY_SCORES.models.length > 0 && Object.keys(QUALITY_SCORES.cells).length > 0;
}
