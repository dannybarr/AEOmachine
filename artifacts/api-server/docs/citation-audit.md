# Multi-Model Citation Quality Audit

How the prompt-research pipeline represents every model truthfully, and how to
re-audit provider contracts after any model or router change.

## Outcome model (per stored run)

`prompt_runs.search_status`:

| Status | Meaning | Citation-eligible |
| --- | --- | --- |
| `provider_cited` | Provider searched the web AND ≥1 citation was verified from structured metadata | yes |
| `search_no_citations` | Search performed; provider returned **no** citation metadata (honest zero) | yes |
| `extraction_failed` | Provider streamed citation metadata that could not be verified (malformed URLs / unknown shapes) | **no** — never counted as a clean zero |
| `tool_rejected` | Provider rejected the `web_search` tool; degraded to a plain answer | no |
| `unsupported` | Model performs no web search via Requesty (answer-only) | no |
| `provider_search` | Legacy label from before this outcome model (search performed, granularity unknown) | per stored flag |
| `NULL` | Legacy run predating provenance tracking | no (reported separately) |

Rules enforced end-to-end:

- Answers are stored verbatim; citations come **only** from provider-attached
  streamed metadata (`delta.annotations[].url_citation`,
  `delta.web_search.content[]`) — never parsed from answer prose.
- Verified-citation predicate everywhere: `citations.provenance = 'provider'`
  AND `prompt_runs.citation_eligible IS TRUE`.
- `prompt_runs.citation_diagnostics` (jsonb) stores per-run extraction
  diagnostics: metadata events, invalid URLs, unknown annotation types,
  unknown shapes, redirect resolution counts.
- Unknown metadata shapes are recorded (shape drift signal) and force
  `extraction_failed` when nothing could be verified.
- Google grounding redirects (`vertexaisearch.cloud.google.com`) are resolved
  to the real cited domain via SSRF-guarded fetch; failures are counted and
  the provider URL is kept.

## Model capability matrix (registry contract)

Source of truth: `src/lib/modelRegistry.ts`. Each entry declares
`supportsSearch`, `extraction` (`streamed_metadata` | `none`), `enabled`, and
is re-validated at boot against Requesty's live model list (missing ids are
marked unavailable with a reason, never substituted).

| Model | Provider | Web search | Extraction | Observed format |
| --- | --- | --- | --- | --- |
| openai/gpt-5 | OpenAI | no | none | answer-only (Requesty attaches no search metadata for OpenAI) |
| openai/gpt-5-mini | OpenAI | no | none | answer-only |
| anthropic/claude-sonnet-4-5 | Anthropic | yes | streamed_metadata | `annotations[].url_citation` |
| google/gemini-2.5-flash | Google | yes | streamed_metadata | `web_search.content[]` via grounding redirects |
| perplexity/sonar | Perplexity | yes | streamed_metadata | `annotations[].url_citation` |
| xai/grok-4-fast-non-reasoning | xAI | yes | streamed_metadata | both shapes, deduped |
| moonshot/kimi-k3 | Moonshot | no | none | answer-only |
| deepinfra/…Llama-3.3-70B-Instruct | Meta | no | none | answer-only |

Known limitations: citations flow only on **streamed** chunks through the
Requesty router; OpenAI models get no web search there (see agent memory
"Requesty routing & citations"). Non-Google redirectors are not resolved.

### Last audit findings (2026-08-30, audit run against all 8 models)

- All 8 models completed; 4 search-capable models all returned
  `provider_cited` (Claude 9, Gemini 5, Sonar 16, Grok 16 citations).
- Gemini grounding redirects resolved 5/5 to real source domains; live URL
  probes mostly OK (bot-protected sites like nerdwallet return 403 —
  expected, not a citation defect).
- **Observed shape drift:** Gemini streams extra annotations with
  `type: "annotation"` alongside its `web_search.content[]` metadata. They
  are recorded in `unknownAnnotationTypes` and carry no extractable URL;
  extraction still succeeds via `web_search.content[]`. Revisit if Gemini
  citations ever drop to zero.
- **Bug found & fixed by this audit:** `safeFetch` passed a workspace-undici
  dispatcher into the global (Node-bundled) fetch — a version mismatch that
  failed every call with `UND_ERR_INVALID_ARG`, silently breaking grounding
  redirect resolution and gap-research page fetches. `safeFetch` now uses
  undici's own `fetch`.

## Re-running the live contract audit

Exercises every registry model with one neutral citation-seeking prompt and
reports per-model completion, search/tool behavior, verified citation count,
extraction diagnostics, and live URL resolution — persisting nothing to
research tables.

Both contract-audit routes are **operator-only** (they trigger paid provider
calls): pass `x-operator-token`. The token is `OPERATOR_TOKEN` when that env
var is set; otherwise it is derived from `SESSION_SECRET`:

```bash
TOKEN=$(node -e 'console.log(require("crypto").createHash("sha256").update("operator:"+process.env.SESSION_SECRET).digest("hex"))')
# start (202; 401 bad token; 409 already running; 429 durable 10-min cooldown; 503 not configured)
curl -X POST -H "x-operator-token: $TOKEN" "$API_BASE_URL/api/models/contract-audit"
# poll until status != running; report includes per-model results
curl -H "x-operator-token: $TOKEN" "$API_BASE_URL/api/models/contract-audit"
```

Cost controls: unauthorized requests never initiate provider calls, at most
one audit can run at a time, and a durable database cooldown
(`contract_audit_state`) allows at most one audit start per 10 minutes even
across restarts (see `contract-audit-guard.test.ts`).

The finished report is also logged as structured JSON
(`Citation contract audit finished`). Errors are sanitized (status + trimmed
message, bearer tokens redacted); raw payloads and secrets are never included.

## Ongoing observability

- `GET /api/models/citation-quality?companyId=&days=` — per-model aggregates
  over stored runs: outcome counts, citation-eligible runs, verified
  citations, **zero-citation eligible runs**, last run time; includes
  unavailable registry models and stored runs from models no longer
  registered.
- `GET /api/methodology` — window-level `runs.outcomes` breakdown, verified
  vs. legacy citation counts, failed attempts.
- Zero-citation search runs, `extraction_failed` counts, and
  `unknownAnnotationTypes` in `citation_diagnostics` are the early-warning
  signals for provider response-shape drift.

## Regression coverage

- `src/lib/__tests__/simulate.test.ts` — extraction fixtures per provider
  family, malformed/unknown metadata, outcome classification, registry
  capability contract.
- `src/lib/__tests__/simulate-outcomes.test.ts` — mocked end-to-end streams:
  every outcome state, tool rejection fallback, retryable error propagation,
  redirect resolution/failure, truncated streams, full default model coverage.
- `src/routes/__tests__/methodology-verified.test.ts`,
  `verified-denominators.test.ts`, `endpoints-verified.test.ts` — downstream
  APIs never present degraded runs as verified evidence.

After adding a model or changing routing: update the registry entry, run the
contract audit, check `unknownAnnotationTypes`/`unknownShapes` in the report,
and extend the fixtures above with any newly observed shape.
