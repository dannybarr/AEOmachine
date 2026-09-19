# Requesty citation yield

How this platform captures citations from Requesty’s OpenAI-compatible Chat Completions API, and what operators should expect per registry model.

Citations are **never** parsed from answer prose. A missing citation list is either an honest provider zero, an extraction failure, a rejected search tool, or an answer-only model.

## Outcome labels (`prompt_runs.search_status`)

| Status | Meaning | Citation-eligible |
| --- | --- | --- |
| `provider_cited` | Search ran and ≥1 URL was verified from structured metadata | yes |
| `search_no_citations` | Search ran; provider sent **no** citation metadata (honest zero) | yes |
| `extraction_failed` | Citation-like metadata was present but unverifiable | **no** |
| `tool_rejected` | Provider rejected `tools: [{ type: "web_search" }]`; plain answer fallback | no |
| `unsupported` | Registry `supportsSearch: false` — tool is never sent | no |

Per-run `citation_diagnostics` records `observedShapes`, `seenCitationKeys`, and `unparsedCitationKeys` so operators can tell:

- **Honest zero:** search-capable model, `search_no_citations`, empty `seenCitationKeys` (or empty lists only).
- **Shape miss / drift:** `extraction_failed` with `unparsedCitationKeys` or `unknownAnnotationTypes`.
- **Tool rejection:** `tool_rejected`.
- **Answer-only:** `unsupported`.

## Shapes we extract (Chat Completions stream)

Requesty documents Chat Completions citations as `delta.web_search.content[]`. Several providers also forward native fields. The extractor reads **the whole chunk**, not only `choices[0].delta`, because Perplexity/xAI often attach `citations` on the terminal chunk (including empty `choices`).

| Shape | Typical family |
| --- | --- |
| `delta.web_search.content[]` `{ url, title }` | Requesty Chat Completions (documented) |
| `delta.web_search.results[]` | Alias seen on some Gemini/xAI mappings |
| `delta.annotations[]` `{ type: "url_citation", url_citation.url }` | Nested Chat Completions (Perplexity, Anthropic, xAI) |
| `delta.annotations[]` `{ type: "url_citation", url }` | Responses-style flat annotation |
| `delta.annotations[]` `{ type: "web_search_result_location", url }` | Anthropic Messages mapped onto chat |
| `chunk.citations[]` / `chunk.search_results[]` | Perplexity / xAI root fields |
| `message.annotations[]` | Non-delta terminal message |
| `grounding_metadata.grounding_chunks[].web.uri` | Gemini Vertex |
| Array `delta.content[].annotations` | OpenAI content-part annotations |

URLs must be `http`/`https` with a host. Google `vertexaisearch.cloud.google.com` redirects are resolved when possible.

## Per-model expectations (registry contract)

Source of truth: `artifacts/api-server/src/lib/modelRegistry.ts`. Live validation may mark an id unavailable; ids are **never silently substituted**.

| Model | Search via Requesty Chat Completions | Expected citation yield | Typical shape |
| --- | --- | --- | --- |
| `openai/gpt-5` | **No** (`supportsSearch: false`) | Always `unsupported`, 0 verified citations | Answer-only. Requesty docs now list OpenAI as a web_search provider on Chat Completions, but this registry keeps search off until a live contract audit shows streamed citation metadata for this exact id. |
| `openai/gpt-5-mini` | **No** | Always `unsupported` | Same as GPT-5 |
| `anthropic/claude-sonnet-4-5` | Yes | High when the model searches. Zeros are `search_no_citations` unless diagnostics show unparsed keys | `annotations` nested or flat; sometimes `web_search.content` |
| `google/gemini-2.5-flash` | Yes | High; grounding redirects should resolve | `web_search.content` and/or `grounding_metadata`; extra `type: "annotation"` without URL is recorded as drift and is **not** fatal if another shape yielded URLs |
| `perplexity/sonar` | Yes | High. Historical misses were often root `chunk.citations` on the last chunk, which this extractor now reads | `chunk.citations` / `search_results` and/or `annotations` |
| `xai/grok-4-fast-non-reasoning` | Yes | High; may emit both annotation and `web_search` (deduped) | Both shapes |
| `moonshot/kimi-k3` | **No** | Always `unsupported` | Answer-only |
| `deepinfra/meta-llama/Llama-3.3-70B-Instruct` | **No** | Always `unsupported` | Answer-only |

**Portfolio mix:** 4 of 8 registry models are answer-only. A tracking job across the full panel will therefore show many citation-less runs even when search-capable models cite correctly. That is expected, not a silent extraction bug.

## Root-cause notes (2026-09-19)

Verified against Requesty docs (`https://docs.requesty.ai/features/web-search`) and the previous extractor:

1. **Chat Completions vs Responses.** Structured `url_citation` annotations with a top-level `url` are documented on `/v1/responses`. Chat Completions is documented as `delta.web_search.content[]`. The old extractor only handled nested `annotations[].url_citation.url` plus `web_search.content[]`, so Responses-style flat annotations were dropped.
2. **Non-delta fields.** Perplexity-compatible payloads put `citations` / `search_results` on the **chunk root**. The stream loop used to `continue` when `choices[0].delta` was missing, which skipped trailing citation chunks (including `choices: []`).
3. **Honest vs failed zeros.** Empty citation metadata on a search-capable model is `search_no_citations` (eligible). Unknown shapes are `extraction_failed` (ineligible). GPT/Kimi/Llama zeros are `unsupported`.
4. **No model substitution.** OpenAI web search is not enabled in the registry without a live probe. Enabling it would be a capability change, not a silent id swap.

Re-audit after router or model changes: `POST /api/models/contract-audit` (operator token). Inspect `observedShapes` / `unparsedCitationKeys` on the report and on `GET /api/runs/:id`.
