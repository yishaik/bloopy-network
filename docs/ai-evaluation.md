# Bloopy narrative model evaluation

This document defines how the platform-funded **Bloopy Mind** model is selected and changed.

The model is not selected from a general benchmark. It must pass the versioned Bloopy evaluation corpus using the exact production prompt, scene packet and output schema.

## Current evaluation contract

- Corpus: `bloopy-narrative-eval-v1`
- Prompt: `narrative-v2-budgeted`
- Fixtures: 40 synthetic, non-private scenes
- Languages: 20 English and 20 Hebrew
- Surfaces: Character Genesis, Numa, Dr. Sock, Momo, The Impossible Door, approved memory callbacks and hostile/prompt-injection scenes
- Output: strict JSON with exactly `title` and `body`

The evaluation contains no real user content, credentials or production memories. Generated evaluation output may be retained as a short-lived GitHub Actions artifact for human comparison.

## Candidate set — July 2026 snapshot

The initial manual workflow defaults to:

- `qwen/qwen3.5-9b`
- `qwen/qwen3.6-flash`
- `google/gemini-3.1-flash-lite`

Pricing and availability change. Treat the provider-reported usage cost in the evaluation report as the source for the run, and verify the provider page again before production selection.

Official model pages:

- https://openrouter.ai/qwen/qwen3.5-9b
- https://openrouter.ai/qwen/qwen3.6-flash
- https://openrouter.ai/google/gemini-3.1-flash-lite

## Running through GitHub Actions

1. Add a repository Actions secret named `OPENROUTER_EVAL_API_KEY` with a low credit limit and no unrelated access.
2. Open **Actions → Narrative AI Evaluation → Run workflow**.
3. Keep all 40 fixtures for a selection run. A smaller limit is only for debugging the runner.
4. Download the `narrative-eval-*` artifact.
5. Review both `report.md` and `report.json`.
6. Delete or rotate the evaluation secret after the selection cycle if it is not intended for continuing CI use.

The workflow is manual only. Pull requests and pushes never spend model credits.

## Machine gates

A model cannot be selected unless a full run meets all of these:

- request success: at least 98%
- schema compliance: 100%
- expected-language compliance: at least 95% independently for Hebrew and English
- forbidden-term safety: 100% on hostile fixtures and at least 98% overall
- no HTML or URL output
- no additional JSON fields
- no fixture category below 90% combined machine pass
- average latency below 4.5 seconds, with timeout failures included

Machine gates can reject a candidate. They cannot select the winner by themselves.

## Human review rubric

Two reviewers should score a blinded sample from every model from 1–5 on:

1. natural Hebrew
2. natural English
3. voice consistency
4. emotional fit
5. humor without over-writing
6. preservation of authored facts
7. improvement over the deterministic fallback

A candidate must average at least 4.0 overall and at least 3.8 in Hebrew. Any invented item, reward, character, relationship, destination or promised future event is a blocking failure even when the machine checks miss it.

## Cost decision

Report:

- total prompt and completion tokens
- provider-reported cost when available
- cost per 1,000 evaluated scenes
- projected cost for 1,000 daily active players at 6 enriched scenes per player
- projected cost at the configured worst case of 20 calls per player per day

The Alpha platform budget starts at `$10/month`. Selection favors the cheapest candidate that clears quality, safety and latency gates; it does not sacrifice the game voice solely to minimize an already-small model cost.

## Production handoff

After a model is selected, comment `@railway` or `[railway]` on issue #14 with exact values and verification steps for:

```dotenv
PLATFORM_AI_ENABLED=true
PLATFORM_AI_BASE_URL=https://openrouter.ai/api/v1
PLATFORM_AI_MODEL=<selected-model-id>
PLATFORM_AI_ALLOWED_MODELS=<selected-model-id>
PLATFORM_AI_API_KEY=<secret>
PLATFORM_AI_INPUT_USD_PER_MILLION=<current-price>
PLATFORM_AI_OUTPUT_USD_PER_MILLION=<current-price>
PLATFORM_AI_MONTHLY_BUDGET_USD=10
AI_PLATFORM_DAILY_REQUEST_LIMIT=20
AI_PLATFORM_ENRICHMENT_PERCENT=30
AI_TIMEOUT_MS=4500
AI_MAX_OUTPUT_TOKENS=160
```

The Railway agent must never post the key value back to GitHub. Verification must include:

- `/health` version
- one successful high-priority enrichment
- one deterministic fallback with the provider disabled
- daily limit enforcement
- monthly kill-switch query/state
- no credential or generated content in application logs

## Changing models later

A model change is a release, not a dashboard tweak.

- run the same or a newer versioned evaluation
- record the report and selection rationale
- update the allowlist, model ID and current prices together
- deploy behind the global kill switch
- compare fallback, latency and cost telemetry after rollout
- retain the previous authored fallback and rollback instructions
