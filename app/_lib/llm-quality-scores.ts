/** Measured LLM quality scores — the output of the Python bench matrix
 *  (`pipeline/jobfit/llm/bench`), judged by the Claude CLI, baked by
 *  `bake_quality.py`. GENERATED — re-bake, don't hand-edit. See
 *  docs/LLM_MODEL_MATRIX.md.
 *  Baked from a run at 2026-07-07T11:35:59.000Z. */
import type { QualityScores } from "./llm-quality";

export const QUALITY_SCORES: QualityScores = {
  "measuredAt": "2026-07-07T11:35:59.000Z",
  "judge": "claude-cli",
  "limit": 2,
  "models": [
    "z-ai/glm-5.2",
    "deepseek/deepseek-v4-flash",
    "xiaomi/mimo-v2.5-pro",
    "openai/gpt-5.4-mini",
    "anthropic/claude-sonnet-5",
    "google/gemini-3.5-flash",
    "tencent/hy3"
  ],
  "cells": {
    "automation_offer": {
      "z-ai/glm-5.2": {
        "relevance": 9.0,
        "correctness": 6.0,
        "adherence": 7.5,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 17359
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 6.5,
        "adherence": 8.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10046
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 7.5,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 36062
      },
      "openai/gpt-5.4-mini": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 2303
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 9913
      },
      "google/gemini-3.5-flash": {
        "relevance": 9.0,
        "correctness": 6.5,
        "adherence": 8.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 2827
      },
      "tencent/hy3": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 35789
      }
    },
    "automation_outreach": {
      "z-ai/glm-5.2": {
        "relevance": 7.5,
        "correctness": 6.0,
        "adherence": 6.5,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 13428
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 6.5,
        "correctness": 6.5,
        "adherence": 5.0,
        "score": 5.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 8874
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 8.0,
        "correctness": 5.5,
        "adherence": 6.0,
        "score": 6.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 19851
      },
      "openai/gpt-5.4-mini": {
        "relevance": 7.0,
        "correctness": 7.5,
        "adherence": 6.0,
        "score": 6.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 1937
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 7.5,
        "correctness": 7.0,
        "adherence": 6.5,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10375
      },
      "google/gemini-3.5-flash": {
        "relevance": 7.5,
        "correctness": 6.0,
        "adherence": 7.0,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 2843
      },
      "tencent/hy3": {
        "relevance": 7.5,
        "correctness": 7.0,
        "adherence": 5.5,
        "score": 5.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 11156
      }
    },
    "automation_rejection": {
      "z-ai/glm-5.2": {
        "relevance": 8.0,
        "correctness": 5.5,
        "adherence": 7.0,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 64694
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 8.5,
        "correctness": 7.0,
        "adherence": 6.5,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 9937
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 8,
        "correctness": 4,
        "adherence": 5,
        "score": 5.0,
        "valid": true,
        "judges": 1,
        "llmRate": 0.5,
        "p50Ms": 59218
      },
      "openai/gpt-5.4-mini": {
        "relevance": 8.0,
        "correctness": 5.5,
        "adherence": 7.0,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 6616
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 8.5,
        "correctness": 7.5,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 11281
      },
      "google/gemini-3.5-flash": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 8.0,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 2913
      },
      "tencent/hy3": {
        "relevance": 8.0,
        "correctness": 6.0,
        "adherence": 6.5,
        "score": 5.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 20937
      }
    },
    "automation_screen": {
      "z-ai/glm-5.2": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 18242
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 6.5,
        "adherence": 8.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 16663
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 32382
      },
      "openai/gpt-5.4-mini": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 2937
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 8.5,
        "correctness": 6.0,
        "adherence": 7.0,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 7515
      },
      "google/gemini-3.5-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 2523
      },
      "tencent/hy3": {
        "relevance": 8.5,
        "correctness": 6.0,
        "adherence": 8.0,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10374
      }
    },
    "campaign_pack": {
      "z-ai/glm-5.2": {
        "relevance": 4.5,
        "correctness": 4.0,
        "adherence": 2.0,
        "score": 3.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 19562
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 8,
        "correctness": 8,
        "adherence": 4,
        "score": 6.0,
        "valid": true,
        "judges": 1,
        "llmRate": 0.5,
        "p50Ms": 71093
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 4.5,
        "correctness": 4.0,
        "adherence": 2.0,
        "score": 3.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 64820
      },
      "openai/gpt-5.4-mini": {
        "relevance": 6.5,
        "correctness": 8.0,
        "adherence": 4.0,
        "score": 5.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10101
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 4.5,
        "correctness": 4.0,
        "adherence": 3.0,
        "score": 3.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 24140
      },
      "google/gemini-3.5-flash": {
        "relevance": 7.0,
        "correctness": 7.0,
        "adherence": 4.0,
        "score": 5.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 9953
      },
      "tencent/hy3": {
        "relevance": 6.0,
        "correctness": 5.5,
        "adherence": 3.5,
        "score": 4.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 83866
      }
    },
    "devcase_analyze": {
      "z-ai/glm-5.2": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 25148
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 14960
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 5.0,
        "correctness": 5.0,
        "adherence": 5.5,
        "score": 4.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 29156
      },
      "openai/gpt-5.4-mini": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 6234
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 5.5,
        "correctness": 5.0,
        "adherence": 6.5,
        "score": 5.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 21367
      },
      "google/gemini-3.5-flash": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 4085
      },
      "tencent/hy3": {
        "relevance": 2,
        "correctness": 3,
        "adherence": 4,
        "score": 2.0,
        "valid": true,
        "judges": 1,
        "llmRate": 0.5,
        "p50Ms": 50219
      }
    },
    "devcase_case_design": {
      "z-ai/glm-5.2": {
        "relevance": 3.5,
        "correctness": 4.5,
        "adherence": 4.5,
        "score": 3.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 78156
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 6.0,
        "correctness": 5.0,
        "adherence": 5.5,
        "score": 5.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 57937
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 4.0,
        "correctness": 4.5,
        "adherence": 3.5,
        "score": 3.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 66132
      },
      "openai/gpt-5.4-mini": {
        "relevance": 8.5,
        "correctness": 6.5,
        "adherence": 6.5,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 12905
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 4.5,
        "correctness": 5.0,
        "adherence": 5.0,
        "score": 4.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 50265
      },
      "google/gemini-3.5-flash": {
        "relevance": 7.5,
        "correctness": 6.5,
        "adherence": 7.5,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10094
      },
      "tencent/hy3": {
        "relevance": 3,
        "correctness": 3,
        "adherence": 3,
        "score": 3.0,
        "valid": true,
        "judges": 1,
        "llmRate": 0.5,
        "p50Ms": 49891
      }
    },
    "devcase_interview_scenario": {
      "z-ai/glm-5.2": {
        "relevance": 6.5,
        "correctness": 5.0,
        "adherence": 4.0,
        "score": 5.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 18101
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 5.5,
        "correctness": 5.0,
        "adherence": 4.5,
        "score": 5.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 25257
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 6,
        "correctness": 4,
        "adherence": 5,
        "score": 5.0,
        "valid": true,
        "judges": 1,
        "llmRate": 0.5,
        "p50Ms": 34218
      },
      "openai/gpt-5.4-mini": {
        "relevance": 6.0,
        "correctness": 4.5,
        "adherence": 5.0,
        "score": 5.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 6124
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 6.5,
        "correctness": 5.0,
        "adherence": 5.5,
        "score": 5.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 23788
      },
      "google/gemini-3.5-flash": {
        "relevance": 6.0,
        "correctness": 6.5,
        "adherence": 5.5,
        "score": 6.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 6953
      },
      "tencent/hy3": {
        "relevance": 6,
        "correctness": 4,
        "adherence": 5,
        "score": 5.0,
        "valid": true,
        "judges": 1,
        "llmRate": 0.5,
        "p50Ms": 31141
      }
    },
    "devcase_role_design": {
      "z-ai/glm-5.2": {
        "relevance": 8.5,
        "correctness": 7.0,
        "adherence": 8.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 11156
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 8.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 11538
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 28437
      },
      "openai/gpt-5.4-mini": {
        "relevance": 8.5,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 5897
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 8.0,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 16242
      },
      "google/gemini-3.5-flash": {
        "relevance": 8.0,
        "correctness": 6.0,
        "adherence": 8.5,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 4273
      }
    },
    "group_compare": {
      "z-ai/glm-5.2": {
        "relevance": 8.5,
        "correctness": 6.5,
        "adherence": 7.5,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 17179
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 6.5,
        "adherence": 8.0,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 12921
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 9,
        "correctness": 6,
        "adherence": 8,
        "score": 7.0,
        "valid": true,
        "judges": 1,
        "llmRate": 0.5,
        "p50Ms": 33453
      },
      "openai/gpt-5.4-mini": {
        "relevance": 8.5,
        "correctness": 6.0,
        "adherence": 8.0,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 3288
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 9077
      },
      "google/gemini-3.5-flash": {
        "relevance": 8.5,
        "correctness": 7.0,
        "adherence": 7.5,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 3765
      },
      "tencent/hy3": {
        "relevance": 8.0,
        "correctness": 6.0,
        "adherence": 8.0,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 66991
      }
    },
    "interview_prep": {
      "z-ai/glm-5.2": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 20804
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 8.5,
        "correctness": 7.0,
        "adherence": 8.0,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 38203
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 5.0,
        "correctness": 5.5,
        "adherence": 5.0,
        "score": 4.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 41554
      },
      "openai/gpt-5.4-mini": {
        "relevance": 8.5,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 6445
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 8.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 24156
      },
      "google/gemini-3.5-flash": {
        "relevance": 8.0,
        "correctness": 7.0,
        "adherence": 8.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 6117
      },
      "tencent/hy3": {
        "relevance": 7.0,
        "correctness": 7.0,
        "adherence": 7.5,
        "score": 5.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 61249
      }
    },
    "interview_scorecard": {
      "z-ai/glm-5.2": {
        "relevance": 8.5,
        "correctness": 6.0,
        "adherence": 8.0,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 16960
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 7.5,
        "correctness": 5.5,
        "adherence": 7.5,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 76351
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 5.5,
        "correctness": 4.0,
        "adherence": 6.0,
        "score": 4.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 24539
      },
      "openai/gpt-5.4-mini": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 9.0,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 3803
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 9.0,
        "correctness": 6.5,
        "adherence": 8.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10797
      },
      "google/gemini-3.5-flash": {
        "relevance": 8.0,
        "correctness": 6.0,
        "adherence": 7.5,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 2358
      },
      "tencent/hy3": {
        "relevance": 9.0,
        "correctness": 6.5,
        "adherence": 8.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 24717
      }
    },
    "jd_ingest": {
      "z-ai/glm-5.2": {
        "relevance": 9.0,
        "correctness": 6.0,
        "adherence": 7.0,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 25062
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 7.5,
        "correctness": 5.0,
        "adherence": 5.0,
        "score": 5.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 37054
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 2.5,
        "correctness": 2.0,
        "adherence": 2.5,
        "score": 2.0,
        "valid": false,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 30257
      },
      "openai/gpt-5.4-mini": {
        "relevance": 7.0,
        "correctness": 4.5,
        "adherence": 5.5,
        "score": 5.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 3523
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 8.0,
        "correctness": 5.0,
        "adherence": 6.0,
        "score": 6.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 12094
      },
      "google/gemini-3.5-flash": {
        "relevance": 7.5,
        "correctness": 4.0,
        "adherence": 5.0,
        "score": 4.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 3593
      }
    },
    "match_reasoning": {
      "z-ai/glm-5.2": {
        "relevance": 9.0,
        "correctness": 7.0,
        "adherence": 8.0,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 12046
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 14054
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 7.5,
        "correctness": 5.5,
        "adherence": 7.0,
        "score": 6.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 43726
      },
      "openai/gpt-5.4-mini": {
        "relevance": 9.0,
        "correctness": 7.5,
        "adherence": 8.5,
        "score": 8.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 4015
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 8.5,
        "correctness": 7.0,
        "adherence": 8.5,
        "score": 7.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 10406
      },
      "google/gemini-3.5-flash": {
        "relevance": 8.0,
        "correctness": 5.5,
        "adherence": 7.0,
        "score": 6.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 3312
      },
      "tencent/hy3": {
        "relevance": 8.5,
        "correctness": 7.5,
        "adherence": 8.5,
        "score": 7.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 27890
      }
    },
    "weight_proposal": {
      "z-ai/glm-5.2": {
        "relevance": 7.0,
        "correctness": 5.5,
        "adherence": 3.0,
        "score": 4.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 66804
      },
      "deepseek/deepseek-v4-flash": {
        "relevance": 8.0,
        "correctness": 6.5,
        "adherence": 5.5,
        "score": 5.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 123484
      },
      "xiaomi/mimo-v2.5-pro": {
        "relevance": 6,
        "correctness": 5,
        "adherence": 3,
        "score": 4.0,
        "valid": true,
        "judges": 1,
        "llmRate": 0.5,
        "p50Ms": 68828
      },
      "openai/gpt-5.4-mini": {
        "relevance": 6.5,
        "correctness": 5.5,
        "adherence": 3.5,
        "score": 4.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 12421
      },
      "anthropic/claude-sonnet-5": {
        "relevance": 7.5,
        "correctness": 5.5,
        "adherence": 3.5,
        "score": 4.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 25828
      },
      "google/gemini-3.5-flash": {
        "relevance": 7.0,
        "correctness": 5.5,
        "adherence": 3.5,
        "score": 4.5,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 9983
      },
      "tencent/hy3": {
        "relevance": 7.5,
        "correctness": 6.0,
        "adherence": 3.5,
        "score": 4.0,
        "valid": true,
        "judges": 2,
        "llmRate": 1.0,
        "p50Ms": 115726
      }
    }
  }
};

/** True once a matrix run has been baked in (so the UI can hide the scorecard
 *  before any measurement exists). */
export function hasQualityScores(): boolean {
  return QUALITY_SCORES.models.length > 0 && Object.keys(QUALITY_SCORES.cells).length > 0;
}
