import { useParams, Link } from "wouter";
import { useGetRun, getGetRunQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, Bot, Quote, ExternalLink, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useModels } from "@/hooks/use-models";
import { modelLabel, searchStatusLabel, visibilityRungLabel } from "@/lib/model-meta";

export default function ChatDetail() {
  const { id } = useParams<{ id: string }>();
  const runId = parseInt(id, 10);
  const models = useModels();
  
  const { data: run, isLoading } = useGetRun(runId, { query: { enabled: !!runId, queryKey: getGetRunQueryKey(runId) } });

  if (isLoading) return <div className="p-4 sm:p-8 text-center">Loading...</div>;
  if (!run) return <div className="p-4 sm:p-8 text-center text-negative">Chat not found</div>;

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto space-y-6 sm:space-y-8 m1-stagger visible">
      
      {/* Header */}
      <div className="space-y-4">
        <Link href="/chats" className="inline-flex items-center text-[12px] font-medium text-slate-quiet hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to chats
        </Link>
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4 sm:gap-6 pb-6 border-b border-border">
          <div className="space-y-3">
            <h1 className="text-xl sm:text-2xl steep-heading tracking-tight leading-snug max-w-3xl">
              {run.promptText}
            </h1>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[12px] font-medium text-slate-quiet">
              <span className="flex items-center gap-1.5 bg-mist px-2 py-1 rounded-full text-foreground">
                <Bot className="w-3.5 h-3.5" />
                {modelLabel(models, run.model)}
              </span>
              <CitationStateBadge searchStatus={run.searchStatus} citationEligible={run.citationEligible} />
              <VisibilityRungBadge visibilityRung={run.visibilityRung} />
              <span>
                {new Date(run.createdAt).toLocaleString(undefined, { 
                  weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' 
                })}
              </span>
            </div>
          </div>
          
          <div className="shrink-0 bg-fog border border-border rounded-lg p-3 w-full sm:w-48">
            <div className="text-[10px] font-medium text-ash uppercase tracking-wider mb-1.5">Brand Mention</div>
            {run.brandMentioned ? (
              <div>
                <span className="text-[14px] font-medium text-positive">Yes</span>
                {run.brandPosition && <span className="text-[12px] text-slate-quiet ml-2">Position #{run.brandPosition}</span>}
              </div>
            ) : (
              <span className="text-[14px] font-medium text-negative">No</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-8">
        
        {/* Answer text */}
        <div className="space-y-4">
          <h2 className="text-[12px] font-medium text-ash uppercase tracking-wider flex items-center gap-2">
            <Quote className="w-3.5 h-3.5" /> Engine Response
          </h2>
          <div className="bg-paper border border-border rounded-2xl p-4 sm:p-6 text-[14px] leading-relaxed text-foreground whitespace-pre-wrap font-serif break-words">
            {run.answerText}
          </div>
        </div>

        {/* Citations */}
        <div className="space-y-4">
          <h2 className="text-[12px] font-medium text-ash uppercase tracking-wider flex items-center gap-2">
            <Globe className="w-3.5 h-3.5" /> Cited Sources ({run.citations?.length || 0})
          </h2>
          
          <div className="space-y-3">
            {run.citations?.length === 0 ? (
              <div className="bg-fog border border-border rounded-lg p-6 text-center text-[13px] text-slate-quiet space-y-2">
                <p>
                  {run.searchStatus === "unsupported"
                    ? "This model doesn't perform web search, so no verified citations are possible for this run."
                    : run.searchStatus === "tool_rejected"
                    ? "The provider rejected web search for this run — no verified citations available."
                    : run.searchStatus === "search_no_citations" || run.searchStatus === "provider_search"
                    ? "The provider searched the web but returned no citation metadata — an honest zero, counted in citation denominators."
                    : run.searchStatus === "extraction_failed"
                    ? "The provider returned citation metadata that could not be verified (malformed or unrecognized format). This run is excluded from verified citation metrics."
                    : "No citations recorded. This is a legacy run — citation provenance is unknown."}
                </p>
                {run.citationEligible === false && run.searchStatus !== "unsupported" && (
                  <p className="text-[11px] uppercase tracking-wider text-ash">Not citation-eligible</p>
                )}
                {run.citationEligible === true && run.searchStatus === "search_no_citations" && (
                  <p className="text-[11px] uppercase tracking-wider text-ash">Citation-eligible honest zero</p>
                )}
              </div>
            ) : (
              run.citations?.map((cit) => (
                <div key={cit.id} className="bg-paper border border-border rounded-lg p-3 hover:border-foreground transition-colors relative overflow-hidden">
                  <div className="absolute top-0 left-0 bottom-0 w-[3px]" style={{ backgroundColor: getDomainColor(cit.domainType) }} />
                  <div className="flex items-start gap-3 pl-2">
                    <div className="w-5 h-5 bg-mist rounded-lg shrink-0 flex items-center justify-center font-medium text-[10px] text-slate-quiet tabular-nums">
                      {cit.position}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <img src={`https://www.google.com/s2/favicons?domain=${cit.domain}&sz=32`} className="w-3.5 h-3.5 rounded-lg" alt="" />
                        <span className="text-[13px] font-medium text-foreground truncate">{cit.domain}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-mist text-ash">
                          {cit.domainType}
                        </span>
                        {cit.provenance === "provider" ? (
                          <span className="text-[10px] font-medium tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-[var(--positive-surface)] text-positive" title="Returned by the provider as structured search metadata">
                            Verified
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-mist text-ash" title="Recorded before provenance tracking — origin unknown">
                            Legacy
                          </span>
                        )}
                        {cit.url && (
                          <a href={cit.url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-foreground hover:underline flex items-center gap-1 truncate">
                            Source link <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {run.citationDiagnostics && (
            <div className="bg-fog border border-border rounded-lg p-4 space-y-2" data-testid="citation-diagnostics">
              <h3 className="text-[11px] font-medium text-ash uppercase tracking-wider">Citation diagnostics</h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                <dt className="text-slate-quiet">Eligible</dt>
                <dd className="text-foreground font-medium">{run.citationEligible ? "yes" : "no"}</dd>
                <dt className="text-slate-quiet">Metadata events</dt>
                <dd className="text-foreground font-medium tabular-nums">{run.citationDiagnostics.metadataEvents}</dd>
                <dt className="text-slate-quiet">Extracted</dt>
                <dd className="text-foreground font-medium tabular-nums">{run.citationDiagnostics.extracted ?? 0}</dd>
                <dt className="text-slate-quiet">Unknown shapes</dt>
                <dd className="text-foreground font-medium tabular-nums">{run.citationDiagnostics.unknownShapes}</dd>
                <dt className="text-slate-quiet">Invalid URLs</dt>
                <dd className="text-foreground font-medium tabular-nums">{run.citationDiagnostics.invalidUrls}</dd>
              </dl>
              {run.citationDiagnostics.observedShapes && run.citationDiagnostics.observedShapes.length > 0 && (
                <p className="text-[11px] text-slate-quiet break-words">
                  Shapes: {run.citationDiagnostics.observedShapes.join(", ")}
                </p>
              )}
              {run.citationDiagnostics.seenCitationKeys && run.citationDiagnostics.seenCitationKeys.length > 0 && (
                <p className="text-[11px] text-slate-quiet break-words">
                  Seen keys: {run.citationDiagnostics.seenCitationKeys.join(", ")}
                </p>
              )}
              {run.citationDiagnostics.unparsedCitationKeys && run.citationDiagnostics.unparsedCitationKeys.length > 0 && (
                <p className="text-[11px] text-warning break-words">
                  Unparsed: {run.citationDiagnostics.unparsedCitationKeys.join(", ")}
                </p>
              )}
              {run.citationDiagnostics.unknownAnnotationTypes.length > 0 && (
                <p className="text-[11px] text-warning break-words">
                  Unknown annotation types: {run.citationDiagnostics.unknownAnnotationTypes.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CitationStateBadge({ searchStatus, citationEligible }: { searchStatus?: string | null; citationEligible?: boolean | null }) {
  const s = searchStatusLabel(searchStatus, citationEligible);
  return (
    <span className={cn(
      "text-[10px] font-medium tracking-wide uppercase px-2 py-1 rounded-full",
      s.tone === "ok" ? "bg-[var(--positive-surface)] text-positive" : s.tone === "warn" ? "bg-[var(--warning-surface)] text-warning" : "bg-mist text-ash"
    )}>
      {s.label}
    </span>
  );
}

function VisibilityRungBadge({ visibilityRung }: { visibilityRung?: string | null }) {
  const s = visibilityRungLabel(visibilityRung);
  if (!s) return null;
  return (
    <span className={cn(
      "text-[10px] font-medium tracking-wide uppercase px-2 py-1 rounded-full",
      s.tone === "ok" ? "bg-[var(--positive-surface)] text-positive" : s.tone === "warn" ? "bg-[var(--warning-surface)] text-warning" : "bg-mist text-ash"
    )}>
      {s.label}
    </span>
  );
}

function getDomainColor(type: string) {
  const map: Record<string, string> = {
    corporate: 'var(--chart-corporate)',
    competitor: 'var(--chart-competitor)',
    editorial: 'var(--chart-editorial)',
    ugc: 'var(--chart-ugc)',
    other: 'var(--chart-other)',
    reference: 'var(--chart-reference)',
    institutional: 'var(--chart-institutional)',
    you: 'var(--chart-you)'
  };
  return map[type.toLowerCase()] || map.other;
}
