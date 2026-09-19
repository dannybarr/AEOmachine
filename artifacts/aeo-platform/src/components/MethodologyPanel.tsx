import { useState } from "react";
import { Info, X } from "lucide-react";
import { useGetMethodology, getGetMethodologyQueryKey } from "@workspace/api-client-react";

/**
 * In-product methodology: which models are covered, sample sizes for the
 * selected window, how denominators are computed, and how citations are
 * verified. Opened from Dashboard, Overview, and Progress.
 */
export function MethodologyPanel({ companyId, days }: { companyId?: number; days: number }) {
  const [open, setOpen] = useState(false);
  const params = { days, ...(companyId ? { companyId } : {}) };
  const { data } = useGetMethodology(params, {
    query: { enabled: open, queryKey: getGetMethodologyQueryKey(params) },
  });

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-quiet hover:text-foreground transition-colors"
        title="How these numbers are computed"
      >
        <Info className="w-3.5 h-3.5" /> Methodology
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-primary/40" onClick={() => setOpen(false)} />
          <div className="relative m1-card bg-background max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[16px] steep-heading">Methodology</h2>
                <p className="text-[12px] text-slate-quiet mt-0.5">
                  Last {days} days (UTC calendar window{data ? `, from ${data.windowStartUtc.slice(0, 10)}` : ""})
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-full text-slate-quiet hover:bg-mist hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {!data ? (
              <div className="p-6 text-center text-[13px] text-slate-quiet">Loading…</div>
            ) : (
              <>
                <section className="space-y-2">
                  <h3 className="text-[12px] font-medium uppercase tracking-wider text-ash">Model registry</h3>
                  <p className="text-[12px] text-slate-quiet">
                    Every run uses a fixed, versioned model registry routed through one gateway.
                    Model ids are validated against the router{data.registryValidatedAt ? ` (last validated ${new Date(data.registryValidatedAt).toLocaleString()})` : ""};
                    unavailable models are listed below rather than silently substituted. This is a curated
                    panel of {data.enabledModelCount} models — not a statistically representative sample of the whole LLM market.
                  </p>
                  <div className="space-y-1.5">
                    {data.registry.map((m) => (
                      <div key={m.id} className="flex items-center gap-2 text-[12px]">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "var(--chart-other)" }} />
                        <span className="font-medium text-foreground">{m.label}</span>
                        <span className="text-slate-quiet">· {m.provider}</span>
                        {!m.supportsSearch && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-mist text-ash uppercase tracking-wide">No web search</span>
                        )}
                        {!m.available && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--negative-surface)] text-negative uppercase tracking-wide" title={m.unavailableReason ?? undefined}>Unavailable</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-1.5">
                  <h3 className="text-[12px] font-medium uppercase tracking-wider text-ash">Sample sizes in this window</h3>
                  <ul className="text-[12px] text-slate-quiet space-y-1 list-disc pl-4">
                    <li><span className="font-medium text-foreground">{data.prompts.active}</span> active prompts ({data.prompts.total} total).</li>
                    <li><span className="font-medium text-foreground">{data.runs.total}</span> stored runs: {data.runs.citationEligible} citation-eligible, {data.runs.searchIneligible} search-ineligible, {data.runs.legacy} legacy runs with unknown provenance.</li>
                    {data.runs.outcomes && (
                      <li>
                        Run outcomes: {data.runs.outcomes.providerCited} provider-cited, {data.runs.outcomes.searchNoCitations} searched with no citation metadata,
                        {" "}{data.runs.outcomes.extractionFailed} extraction-failed (metadata unverifiable), {data.runs.outcomes.toolRejected} search-rejected,
                        {" "}{data.runs.outcomes.answerOnly} answer-only (no web search){data.runs.outcomes.legacySearch > 0 ? `, ${data.runs.outcomes.legacySearch} legacy verified-search runs` : ""}.
                      </li>
                    )}
                    <li><span className="font-medium text-foreground">{data.citations.total}</span> citations: {data.citations.verified} verified from provider metadata, {data.citations.legacy} legacy (provenance unknown).</li>
                    <li><span className="font-medium text-foreground">{data.attempts.total}</span> recorded attempts, of which {data.attempts.failed} failed. Failed attempts are reported but never stored as runs.</li>
                  </ul>
                </section>

                <section className="space-y-1.5">
                  <h3 className="text-[12px] font-medium uppercase tracking-wider text-ash">Denominators &amp; weighting</h3>
                  <ul className="text-[12px] text-slate-quiet space-y-1 list-disc pl-4">
                    <li>Visibility and mention rate are the same descriptive measure: the percentage of <span className="font-medium text-foreground">successful stored answers</span> containing an exact, case-insensitive match for the company name. Failed attempts are excluded, not counted as non-mentions.</li>
                    <li>Citation metrics divide by <span className="font-medium text-foreground">citation-eligible runs</span> (models whose provider performed verifiable web search). Runs from no-search models are excluded from citation denominators.</li>
                    <li>All successful runs are pooled and weighted equally. Therefore a prompt or model with more completed runs contributes more to the overall rate. The overall rate is not coverage-adjusted or representative of market usage.</li>
                    <li>Days with no runs appear as gaps, not zeros. Windows are aligned to UTC calendar days.</li>
                  </ul>
                </section>

                <section className="space-y-1.5">
                  <h3 className="text-[12px] font-medium uppercase tracking-wider text-ash">Citation verification</h3>
                  <ul className="text-[12px] text-slate-quiet space-y-1 list-disc pl-4">
                    <li>A citation counts as <span className="font-medium text-foreground">verified</span> only when the provider returned it as structured search metadata alongside the answer. URLs merely mentioned in answer text are never counted.</li>
                    <li>Google grounding redirect links are resolved to the real cited site; the original provider URL is retained for audit.</li>
                    <li>Exact repeated URLs within one answer are deduplicated before storage. Different URLs, query variants, or pages on the same domain can each count as a retrieval. “Citation position” is provider-returned source order, not necessarily the location of an inline footnote.</li>
                    <li>A search answer with no returned citation metadata contributes zero citations but stays in the denominator. A no-search or tool-rejected answer is citation-ineligible and excluded. When a provider returns citation metadata that cannot be safely verified (malformed or unrecognized format), the run is labeled extraction-failed and excluded from verified metrics entirely — never counted as a clean zero. Chat-page diagnostics show observed shapes, seen citation keys, and unparsed keys so operators can tell honest zeros from extraction failure.</li>
                    <li>Runs recorded before provenance tracking are kept readable and labeled <span className="font-medium text-foreground">legacy</span>; their citation provenance cannot be reconstructed and is reported separately.</li>
                  </ul>
                </section>

                <section className="space-y-1.5">
                  <h3 className="text-[12px] font-medium uppercase tracking-wider text-ash">Visibility ladder</h3>
                  <ul className="text-[12px] text-slate-quiet space-y-1 list-disc pl-4">
                    <li><span className="font-medium text-foreground">Recommended</span> — the tracked brand is an explicit pick or shortlist in the answer.</li>
                    <li><span className="font-medium text-foreground">Cited</span> — the brand domain appears in verified provider citations, without recommend strength.</li>
                    <li><span className="font-medium text-foreground">Mentioned</span> — the brand is named in prose without citation gravity or recommendation. Mention is not a recommendation.</li>
                    <li><span className="font-medium text-foreground">Absent</span> — neither the brand name nor its domain appears in the answer or verified citations.</li>
                    <li>Legacy runs recorded before this field have no rung. New successful runs persist <span className="font-medium text-foreground">visibilityRung</span> on the run.</li>
                  </ul>
                </section>

                <section className="space-y-1.5">
                  <h3 className="text-[12px] font-medium uppercase tracking-wider text-ash">Identity, sources &amp; interpretation</h3>
                  <ul className="text-[12px] text-slate-quiet space-y-1 list-disc pl-4">
                    <li>A mention records presence only. It does <span className="font-medium text-foreground">not</span> determine whether the statement is favorable, accurate, recommended, or refers unambiguously to this company. Review the verbatim answer before interpreting a mention as positive visibility.</li>
                    <li>Owned-domain matching includes the configured domain and its subdomains. Other source types use a company-specific registry plus deterministic domain heuristics; labels can be incomplete or wrong, especially for mixed-purpose platforms and unregistered competitors.</li>
                    <li>Known Google grounding redirects are followed when possible. Other redirectors, unresolved redirects, domain migrations, and canonical aliases can split or misattribute source counts.</li>
                    <li>Company profile text is not sent to models in tracked simulations. A company-name change alters exact-match detection for future runs only; historical stored classifications are not recalculated. Profile context used to frame Gap Analysis is frozen in that research snapshot.</li>
                  </ul>
                </section>

                <section className="space-y-1.5">
                  <h3 className="text-[12px] font-medium uppercase tracking-wider text-ash">Uncertainty &amp; model disagreement</h3>
                  <ul className="text-[12px] text-slate-quiet space-y-1 list-disc pl-4">
                    <li>These figures are descriptive observations of the prompts, models, settings, place, and times tested—not estimates of all users, prompts, or answer engines. No margin of error or statistical significance is claimed.</li>
                    <li>Small samples are unstable: with one run, visibility can only be 0% or 100%. Compare rates only after checking run counts, prompt mix, model mix, failures, and search eligibility.</li>
                    <li>Uneven prompt/model coverage can create apparent changes even when model behavior is unchanged. Period-over-period deltas are not valid causal comparisons unless the same prompts and models were run with comparable frequency.</li>
                    <li>Models can return contradictory answers. The platform preserves each answer and reports per-model coverage; it does not adjudicate truth or treat majority agreement as correctness.</li>
                  </ul>
                </section>

                <section className="space-y-1.5">
                  <h3 className="text-[12px] font-medium uppercase tracking-wider text-ash">Competitive share, gaps &amp; recommendations</h3>
                  <ul className="text-[12px] text-slate-quiet space-y-1 list-disc pl-4">
                    <li>Competitive citation share is a share of verified retrieval records in the tested corpus, not market share, audience share, or share of all possible sources. It depends on the configured owned and competitor domains.</li>
                    <li>A “gap” is a rule-based low or zero exact-name mention rate in the selected snapshot. It does not prove lost demand, poor content, or competitor preference; low coverage and failed attempts limit the inference.</li>
                    <li>Gap Analysis canonicalizes URLs and uses only provider-returned citations from citation-eligible runs. Page-type and channel labels are deterministic signals from domains and available page metadata, not editorial judgments.</li>
                    <li>Confidence labels are heuristic evidence-strength tiers based on citation and distinct-prompt counts, not calibrated probabilities. Recommendations are hypotheses derived from observed source patterns; they are not causal findings or guarantees of improved visibility.</li>
                  </ul>
                </section>

                {data.runs.legacy > 0 && (
                  <div className="text-[12px] p-3 rounded-lg bg-[var(--warning-surface)] text-warning border border-border">
                    {data.runs.legacy} of {data.runs.total} runs in this window predate provenance tracking. They remain visible for audit but are excluded from verified citation metrics.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
