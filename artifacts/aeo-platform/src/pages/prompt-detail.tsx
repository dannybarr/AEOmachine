import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { 
  useGetPrompt, 
  useListPromptRuns, 
  useSimulatePrompt,
  useSimulatePromptAllModels,
  useListTrackingJobs,
  useGetTrackingJobAttempts,
  useGetPromptInsights,
  getGetPromptQueryKey,
  getListPromptRunsQueryKey,
  getGetPromptInsightsQueryKey,
  getGetOverviewSummaryQueryKey,
  getGetOverviewTimeseriesQueryKey,
  getListDomainsQueryKey,
  getListRunsQueryKey,
  getListTrackingJobsQueryKey,
  getGetTrackingJobAttemptsQueryKey
} from "@workspace/api-client-react";
import type { ModelInfo, PromptMentionedEntity } from "@workspace/api-client-react";
import { modelLabel, searchStatusLabel } from "@/lib/model-meta";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ChevronDown, Play, AlertCircle, ExternalLink, Activity, Bot, Target, LineChart, LayoutDashboard, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useModels } from "@/hooks/use-models";
import { cn } from "@/lib/utils";

import { useCompany } from "@/components/CompanyContext";
import { 
  ResponsiveContainer, 
  ComposedChart, 
  AreaChart,
  Area,
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  Legend
} from "recharts";

const CITATION_COLORS = {
  owned: "var(--chart-you)",
  competitor: "var(--chart-competitor)",
  corporate: "var(--chart-corporate)",
  directory: "var(--chart-directory)",
  comparison: "var(--chart-comparison)",
  ugc: "var(--chart-ugc)",
  editorial: "var(--chart-editorial)",
  institutional: "var(--chart-institutional)",
  other: "var(--chart-other)"
};

export default function PromptDetail() {
  const { companyId } = useCompany();
  const { id } = useParams<{ id: string }>();
  const promptId = parseInt(id, 10);
  const [days, setDays] = useState<number>(30);
  const [expandedModels, setExpandedModels] = useState<Set<string>>(() => new Set());
  
  const { data: prompt, isLoading: loadingPrompt } = useGetPrompt(promptId, { query: { enabled: !!promptId, queryKey: getGetPromptQueryKey(promptId) } });
  const { data: runs, isLoading: loadingRuns } = useListPromptRuns(promptId, { query: { enabled: !!promptId, queryKey: getListPromptRunsQueryKey(promptId) } });
  const { data: insights, isLoading: loadingInsights } = useGetPromptInsights(promptId, { days }, { query: { enabled: !!promptId, queryKey: getGetPromptInsightsQueryKey(promptId, { days }) } });
  
  const models = useModels();
  const [model, setModel] = useState("all");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Durable "Run all models": the server runs an immutable-snapshot job; we
  // just poll it, so the run survives navigating away and back.
  const { data: promptJobs } = useListTrackingJobs(
    { companyId, promptId, limit: 1 },
    { query: { enabled: !!companyId && !!promptId, queryKey: getListTrackingJobsQueryKey({ companyId, promptId, limit: 1 }), refetchInterval: (q) => (q.state.data?.[0]?.status === "running" ? 2000 : false) } },
  );
  const activeJob = promptJobs?.[0]?.status === "running" ? promptJobs[0] : null;
  const lastJob = promptJobs?.[0] ?? null;
  const prevJobStatus = useRef<string | null>(null);
  useEffect(() => {
    const status = lastJob?.status ?? null;
    if (prevJobStatus.current === "running" && status && status !== "running") {
      // Job just finished — refresh all derived data and report exactly.
      queryClient.invalidateQueries({ queryKey: getGetPromptQueryKey(promptId) });
      queryClient.invalidateQueries({ queryKey: getListPromptRunsQueryKey(promptId) });
      queryClient.invalidateQueries({ queryKey: getGetPromptInsightsQueryKey(promptId) });
      queryClient.invalidateQueries({ queryKey: getGetOverviewSummaryQueryKey({ companyId }) });
      queryClient.invalidateQueries({ queryKey: getGetOverviewTimeseriesQueryKey({ companyId }) });
      queryClient.invalidateQueries({ queryKey: getListDomainsQueryKey({ companyId }) });
      queryClient.invalidateQueries({ queryKey: getListRunsQueryKey({ companyId }) });
      if (lastJob) {
        queryClient.invalidateQueries({ queryKey: getGetTrackingJobAttemptsQueryKey(lastJob.id) });
        if (lastJob.failed > 0) {
          toast({
            title: `${lastJob.succeeded} of ${lastJob.totalSimulations} model runs succeeded`,
            description: lastJob.error ?? "See per-model results below.",
            variant: lastJob.succeeded === 0 ? "destructive" : undefined,
          });
        } else {
          toast({ title: `Ran on all ${lastJob.totalSimulations} models` });
        }
      }
    }
    prevJobStatus.current = status;
  }, [lastJob?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: jobAttempts } = useGetTrackingJobAttempts(lastJob?.id ?? 0, {
    query: { enabled: !!lastJob, queryKey: getGetTrackingJobAttemptsQueryKey(lastJob?.id ?? 0) },
  });

  const runAll = useSimulatePromptAllModels({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTrackingJobsQueryKey({ companyId, promptId, limit: 1 }) });
      },
      onError: (e: unknown) => {
        toast({ title: "Could not start the run", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
      },
    },
  });
  
  const simulate = useSimulatePrompt({
    mutation: {
      onSuccess: () => {
        // Invalidate everything to reflect new data
        queryClient.invalidateQueries({ queryKey: getGetPromptQueryKey(promptId) });
        queryClient.invalidateQueries({ queryKey: getListPromptRunsQueryKey(promptId) });
        queryClient.invalidateQueries({ queryKey: getGetPromptInsightsQueryKey(promptId) });
        queryClient.invalidateQueries({ queryKey: getGetOverviewSummaryQueryKey({ companyId }) });
        queryClient.invalidateQueries({ queryKey: getGetOverviewTimeseriesQueryKey({ companyId }) });
        queryClient.invalidateQueries({ queryKey: getListDomainsQueryKey({ companyId }) });
        queryClient.invalidateQueries({ queryKey: getListRunsQueryKey({ companyId }) });
      }
    }
  });

  const isRunning = activeJob !== null || simulate.isPending || runAll.isPending;
  const disposed = useRef(false);
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);

  const onSimulate = async () => {
    if (isRunning) return;
    if (model !== "all") {
      try {
        await simulate.mutateAsync({ id: promptId, data: { model } });
        if (!disposed.current) toast({ title: "Simulation complete!" });
      } catch {
        if (!disposed.current) toast({ title: "Simulation failed", variant: "destructive" });
      }
      return;
    }
    // Server-side durable job across every enabled registry model.
    runAll.mutate({ id: promptId });
  };

  if (loadingPrompt || loadingInsights) return <div className="p-4 sm:p-8 text-center text-[13px] text-slate-quiet">Loading...</div>;
  if (!prompt || !insights) return <div className="p-4 sm:p-8 text-center text-negative">Prompt not found</div>;

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto space-y-6 sm:space-y-8 m1-stagger visible">
      {/* Header */}
      <div className="flex flex-col gap-6">
        <Link href="/prompts" className="inline-flex items-center text-[12px] font-medium text-slate-quiet hover:text-foreground w-fit">
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to prompts
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 pb-6 border-b border-border">
          <div>
            <h1 className="text-xl sm:text-2xl steep-heading tracking-tight leading-snug max-w-4xl">
              "{prompt.text}"
            </h1>
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <span className="text-[11px] font-medium tracking-wide uppercase px-2.5 py-1 rounded-full bg-mist text-foreground">
                {prompt.topic}
              </span>
              <div className="flex items-center gap-1.5">
                {prompt.tags?.map(tag => (
                  <span key={tag} className="text-[10px] font-medium tracking-wide uppercase px-2 py-0.5 rounded-full border border-border text-ash">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          
          <div className="flex flex-col items-stretch sm:items-end gap-3 shrink-0">
            <div className="flex flex-col min-[420px]:flex-row items-stretch min-[420px]:items-center gap-2 bg-mist p-1 rounded-lg">
              <select 
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-9 px-3 text-[13px] font-medium bg-paper border border-border rounded-lg outline-none focus:border-foreground min-w-0"
              >
                <option value="all">All models</option>
                {models.filter((m) => m.available !== false).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.supportsSearch ? "" : " (no web search)"}
                  </option>
                ))}
              </select>
              <button 
                onClick={onSimulate}
                disabled={isRunning}
                className="m1-btn"
              >
                {activeJob ? (
                  <><Activity className="w-4 h-4 animate-spin" /> Running {activeJob.succeeded + activeJob.failed}/{activeJob.totalSimulations}...</>
                ) : simulate.isPending || runAll.isPending ? (
                  <><Activity className="w-4 h-4 animate-spin" /> Running...</>
                ) : (
                  <><Play className="w-4 h-4" /> {model === "all" ? "Run all models" : "Simulate now"}</>
                )}
              </button>
            </div>

            {/* Time Toggle */}
            <div className="flex items-center gap-1 p-1 bg-mist rounded-full border border-border">
              {[7, 30, 90].map(d => (
                <button 
                  key={d}
                  onClick={() => setDays(d)} 
                  className={cn(
                    "text-[12px] font-medium px-3 py-1 rounded-full transition-colors",
                    days === d ? "bg-paper text-foreground border border-border" : "text-slate-quiet hover:text-foreground hover:bg-fog"
                  )}
                >
                  {d} Days
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {isRunning && (
        <div className="p-4 sm:p-6 bg-fog border border-border rounded-2xl flex items-start sm:items-center justify-center gap-3 text-[13px] sm:text-[14px] font-medium text-foreground animate-pulse">
          <Bot className="w-5 h-5 text-slate-quiet animate-bounce" />
          {activeJob
            ? `Querying all ${activeJob.totalSimulations} models live on the server... ${activeJob.succeeded + activeJob.failed} of ${activeJob.totalSimulations} complete. You can navigate away — the run continues.`
            : `Querying ${modelLabel(models, model)} live... This takes a few seconds.`}
        </div>
      )}

      {/* Last run-all outcome: exact per-model reporting */}
      {!activeJob && lastJob && lastJob.failed > 0 && jobAttempts && jobAttempts.length > 0 && (
        <div className="rounded-2xl p-4 border border-border bg-[var(--warning-surface)]">
          <div className="text-[12px] font-medium text-foreground mb-2">
            Last run: {lastJob.succeeded} of {lastJob.totalSimulations} model runs succeeded
          </div>
          <div className="flex flex-wrap gap-2">
            {jobAttempts.filter((a) => a.failed > 0).map((a) => (
              <span key={a.model} title={a.lastError ?? undefined} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--negative-surface)] text-negative uppercase tracking-wide">
                {modelLabel(models, a.model)} failed
              </span>
            ))}
          </div>
        </div>
      )}

      {/* KPIs Summary */}
      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 m1-stagger visible" style={{ animationDelay: '90ms' }}>
        <MetricCard 
          label="Visibility" 
          value={insights.summary.visibilityPct != null ? `${insights.summary.visibilityPct}%` : '-'} 
          delta={insights.summary.visibilityDelta} 
        />
        <MetricCard 
          label="Avg Brand Pos" 
          value={insights.summary.avgBrandPosition?.toFixed(1) || '-'} 
        />
        <MetricCard 
          label="Avg Citations" 
          value={insights.summary.avgCitationsPerRun?.toFixed(1) || '-'} 
          subtitle="per run" 
        />
        <MetricCard 
          label="Total Runs" 
          value={insights.summary.totalRuns.toLocaleString()} 
        />
        <MetricCard 
          label="Retrievals" 
          value={insights.summary.totalRetrievals.toLocaleString()} 
        />
        <MetricCard 
          label="Last Run" 
          value={insights.summary.lastRunAt ? formatShortDate(insights.summary.lastRunAt) : '-'} 
        />
      </div>

      <div className="m1-stagger visible" style={{ animationDelay: '135ms' }}>
        <Link href={`/lab/strategy/${companyId}`} className="block group">
          <div className="rounded-2xl p-5 bg-blush text-sienna flex flex-col sm:flex-row sm:items-center justify-between transition-transform group-hover:scale-[1.01] gap-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-paper flex items-center justify-center shrink-0">
                <Target className="w-5 h-5 text-sienna" />
              </div>
              <div>
                <h3 className="text-[14px] font-medium">Deploy to Site Lab Playbook</h3>
                <p className="text-[12px] text-sienna mt-0.5">Connect tracking findings directly to your strategy actions.</p>
              </div>
            </div>
            <div className="text-[13px] font-medium flex items-center gap-2 group-hover:translate-x-1 transition-transform shrink-0">
              View Playbook <ArrowLeft className="w-4 h-4 rotate-180" />
            </div>
          </div>
        </Link>
      </div>

      {/* Model coverage: sample sizes and outcomes per model */}
      {insights.modelCoverage && insights.modelCoverage.length > 0 && (
        <div className="space-y-4 m1-stagger visible" style={{ animationDelay: '150ms' }}>
          <div>
            <h2 className="text-[16px] steep-heading">Model Coverage</h2>
            <p className="text-[12px] text-slate-quiet">Per-model sample sizes, outcomes, and citation eligibility over the last {days} days</p>
          </div>
          <div className="bg-paper border border-border rounded-2xl overflow-x-auto">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] min-w-[650px] gap-4 p-3 border-b border-border bg-fog text-[11px] font-medium text-ash uppercase tracking-wider">
              <div>Model</div>
              <div className="w-14 text-right">Runs</div>
              <div className="w-20 text-right">Mention %</div>
              <div className="w-16 text-right">Citations</div>
              <div className="w-14 text-right">Failed</div>
              <div className="w-28 text-right">Citation Eligible</div>
            </div>
            <div className="divide-y divide-border">
              {insights.modelCoverage.map((mc) => {
                const reg = models.find((m) => m.id === mc.model);
                 const expanded = expandedModels.has(mc.model);
                 const panelId = `model-sources-${mc.model.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                return (
                   <div key={mc.model}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      onClick={() => setExpandedModels((current) => {
                        const next = new Set(current);
                        if (next.has(mc.model)) next.delete(mc.model);
                        else next.add(mc.model);
                        return next;
                      })}
                      className="grid w-full grid-cols-[1fr_auto_auto_auto_auto_auto] min-w-[650px] gap-4 p-3 items-center text-left hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
                    >
                     <div className="flex items-center gap-2 min-w-0">
                       <ChevronDown className={cn("w-4 h-4 shrink-0 text-slate-quiet transition-transform", expanded && "rotate-180")} />
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "var(--chart-other)" }} />
                      <span className="text-[13px] font-medium text-foreground truncate">{modelLabel(models, mc.model)}</span>
                      {reg && !reg.supportsSearch && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-mist text-ash uppercase tracking-wide whitespace-nowrap">No search</span>
                      )}
                    </div>
                    <div className="w-14 text-right text-[13px] font-medium tabular-nums">{mc.runs}</div>
                    <div className="w-20 text-right text-[13px] font-medium tabular-nums">{mc.mentionRatePct != null ? `${mc.mentionRatePct}%` : '-'}</div>
                    <div className="w-16 text-right text-[13px] font-medium tabular-nums">{mc.citations}</div>
                    <div className="w-14 text-right text-[13px] font-medium tabular-nums">
                       {mc.failedAttempts > 0 ? <span className="text-negative">{mc.failedAttempts}</span> : '0'}
                    </div>
                     <div className="w-28 text-right text-[12px] font-medium tabular-nums text-slate-quiet">{mc.citationEligibleRuns} / {mc.runs}</div>
                    </button>
                    {expanded && (
                      <div id={panelId} className="min-w-[650px] border-t border-border bg-fog/50 px-3 py-4">
                        {mc.sources.length > 0 ? (
                          <div className="overflow-x-auto rounded-xl border border-border bg-paper">
                            <div className="grid min-w-[850px] grid-cols-[minmax(180px,1fr)_110px_minmax(190px,1.2fr)_90px_90px_90px_170px] gap-3 border-b border-border bg-mist p-3 text-[10px] font-medium uppercase tracking-wider text-ash">
                              <div>Source / domain</div><div>Type</div><div>Most-cited page</div><div className="text-right">Retrievals</div><div className="text-right">Share</div><div className="text-right">Avg pos</div><div className="text-right">Business in answers</div>
                            </div>
                            <div className="divide-y divide-border">
                              {mc.sources.map((source) => {
                                const href = safeHttpUrl(source.topUrl);
                                return (
                                  <div key={source.domain} className="grid min-w-[850px] grid-cols-[minmax(180px,1fr)_110px_minmax(190px,1.2fr)_90px_90px_90px_170px] items-center gap-3 p-3 text-[12px]">
                                    <div className="truncate font-medium text-foreground">{source.domain}</div>
                                    <div><span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide", getDomainTypeBadgeClasses(source.domainType))}>{source.domainType.replace("_", " ")}</span></div>
                                    <div className="min-w-0">
                                      {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-slate-quiet hover:text-foreground hover:underline"><span className="truncate">{href}</span><ExternalLink className="h-3 w-3 shrink-0" /></a> : <span className="text-slate-quiet">No page URL</span>}
                                    </div>
                                    <div className="text-right tabular-nums">{source.retrievals}</div>
                                    <div className="text-right tabular-nums">{source.sharePct}%</div>
                                    <div className="text-right tabular-nums">#{source.avgPosition.toFixed(1)}</div>
                                    <div className="text-right tabular-nums"><span className="font-medium">{source.businessMentionedAnswers} / {source.associatedAnswers}</span> <span className="text-slate-quiet">({source.businessMentionRatePct}%)</span></div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <p className="py-3 text-center text-[12px] text-slate-quiet">
                            {reg && !reg.supportsSearch
                              ? "This model does not support web search, so verified citation sources are not expected."
                              : mc.runs === 0 && mc.failedAttempts > 0
                                ? "No answers completed successfully for this model in this window."
                                : mc.citationEligibleRuns === 0
                                  ? "No citation-eligible answers exist for this model in this window. Legacy and ineligible runs are excluded."
                                  : "Citation-eligible answers exist, but no verified provider citations were returned."}
                          </p>
                        )}
                      </div>
                    )}
                   </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 m1-stagger visible" style={{ animationDelay: '180ms' }}>
        {/* Visibility */}
        <div className="bg-paper border border-border rounded-2xl p-6">
          <div className="mb-4">
            <h2 className="text-[14px] steep-heading">Visibility Trend</h2>
            <p className="text-[12px] text-slate-quiet">Prompt-level visibility over the last {days} days</p>
          </div>
          <div className="h-[280px] w-full mt-4">
            {insights.summary.totalRuns === 0 ? (
               <div className="h-full w-full flex flex-col items-center justify-center text-center">
                  <LineChart className="w-6 h-6 text-smoke mb-2" />
                  <p className="text-[13px] font-medium text-slate-quiet">No trend data</p>
                  <p className="text-[12px] text-slate-quiet">Run the prompt to generate insights.</p>
               </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={insights.series} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis 
                    dataKey="date" 
                    tick={{fontSize: 11, fill: 'var(--slate-quiet)'}}
                    tickFormatter={formatDate} 
                    axisLine={false} 
                    tickLine={false} 
                    minTickGap={30}
                  />
                  <YAxis 
                    tick={{fontSize: 11, fill: 'var(--slate-quiet)'}}
                    axisLine={false} 
                    tickLine={false} 
                    domain={[0, 100]} 
                    tickFormatter={(val) => `${val}%`}
                  />
                  <RechartsTooltip content={<VisibilityTooltip />} cursor={{fill: 'var(--mist)'}} />
                  <Line 
                    type="monotone" 
                    dataKey="visibilityPct" 
                    name="Visibility"
                    stroke="var(--foreground)" 
                    strokeWidth={2} 
                    dot={{r: 2, fill: 'var(--background)', stroke: 'var(--foreground)', strokeWidth: 1.5}}
                    activeDot={{r: 4, fill: 'var(--foreground)'}} 
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Citation Mix */}
        <div className="bg-paper border border-border rounded-2xl p-6">
          <div className="mb-4">
            <h2 className="text-[14px] steep-heading">Citation Mix</h2>
            <p className="text-[12px] text-slate-quiet">Provider-verified citations grouped by source role</p>
          </div>
          <div className="h-[280px] w-full mt-4">
             {insights.summary.totalRetrievals === 0 ? (
               <div className="h-full w-full flex flex-col items-center justify-center text-center">
                  <LayoutDashboard className="w-6 h-6 text-smoke mb-2" />
                  <p className="text-[13px] font-medium text-slate-quiet">No citation data</p>
                  <p className="text-[12px] text-slate-quiet">Wait for runs that retrieve external sources.</p>
               </div>
             ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={insights.series} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis 
                    dataKey="date" 
                    tick={{fontSize: 11, fill: 'var(--slate-quiet)'}}
                    tickFormatter={formatDate} 
                    axisLine={false} 
                    tickLine={false} 
                    minTickGap={30}
                  />
                  <YAxis tick={{fontSize: 11, fill: 'var(--slate-quiet)'}} axisLine={false} tickLine={false} />
                  <RechartsTooltip content={<CitationTooltip />} cursor={{fill: 'var(--mist)'}} />
                   <Area type="monotone" dataKey="ownedCitations" name="Owned website" stackId="1" stroke={CITATION_COLORS.owned} fill={CITATION_COLORS.owned} connectNulls={false} isAnimationActive={false} />
                  <Area type="monotone" dataKey="competitorCitations" name="Competitors" stackId="1" stroke={CITATION_COLORS.competitor} fill={CITATION_COLORS.competitor} connectNulls={false} isAnimationActive={false} />
                   <Area type="monotone" dataKey="directoryCitations" name="Directories & Databases" stackId="1" stroke={CITATION_COLORS.directory} fill={CITATION_COLORS.directory} connectNulls={false} isAnimationActive={false} />
                   <Area type="monotone" dataKey="comparisonCitations" name="Reviews & Comparisons" stackId="1" stroke={CITATION_COLORS.comparison} fill={CITATION_COLORS.comparison} connectNulls={false} isAnimationActive={false} />
                    <Area type="monotone" dataKey="editorialCitations" name="Media & Articles" stackId="1" stroke={CITATION_COLORS.editorial} fill={CITATION_COLORS.editorial} connectNulls={false} isAnimationActive={false} />
                   <Area type="monotone" dataKey="institutionalCitations" name="Institutional" stackId="1" stroke={CITATION_COLORS.institutional} fill={CITATION_COLORS.institutional} connectNulls={false} isAnimationActive={false} />
                   <Area type="monotone" dataKey="ugcCitations" name="UGC" stackId="1" stroke={CITATION_COLORS.ugc} fill={CITATION_COLORS.ugc} connectNulls={false} isAnimationActive={false} />
                   <Area type="monotone" dataKey="otherCitations" name="Unresolved" stackId="1" stroke={CITATION_COLORS.other} fill={CITATION_COLORS.other} connectNulls={false} isAnimationActive={false} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                </AreaChart>
              </ResponsiveContainer>
             )}
          </div>
        </div>
      </div>

      {/* Tables Row 1: Sources & Entities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 m1-stagger visible" style={{ animationDelay: '270ms' }}>
        
        {/* Cited Sources */}
        <div className="space-y-4">
          <h2 className="text-[16px] steep-heading">Cited Sources</h2>
          <div className="bg-paper border border-border rounded-2xl overflow-hidden flex flex-col min-h-[300px] max-h-[600px]">
            <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto] gap-4 p-3 border-b border-border bg-fog text-[11px] font-medium text-ash uppercase tracking-wider shrink-0">
              <div>Domain</div>
              <div className="w-16 text-right">Count</div>
              <div className="w-16 text-right">Avg Pos</div>
              <div className="w-8"></div>
            </div>
            <div className="divide-y divide-border overflow-y-auto flex-1">
              {!insights.sources || insights.sources.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-12">
                  <Globe className="w-8 h-8 text-smoke mb-3" />
                  <p className="text-[14px] font-medium text-foreground">No sources retrieved</p>
                  <p className="text-[13px] text-slate-quiet mt-1 max-w-[200px]">
                    No external links were cited for this prompt in the last {days} days.
                  </p>
                </div>
              ) : (
                insights.sources.map((source) => (
                  <div key={source.domain} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[1fr_auto_auto_auto] gap-2 sm:gap-4 p-3 hover:bg-mist transition-colors items-center">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-foreground truncate">{source.domain}</div>
                      <div className="mt-1">
                        <span className={cn(
                          "text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider",
                          getDomainTypeBadgeClasses(source.domainType)
                        )}>
                          {source.domainType.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                    <div className="sm:w-16 text-left sm:text-right text-[11px] sm:text-[13px] font-medium tabular-nums text-slate-quiet sm:text-foreground row-start-2 col-start-1 sm:row-start-auto sm:col-start-auto">
                      <span className="sm:hidden">Citations </span>{source.retrievals}
                    </div>
                    <div className="sm:w-16 text-right text-[11px] sm:text-[13px] font-medium tabular-nums text-slate-quiet sm:text-foreground row-start-2 col-start-2 sm:row-start-auto sm:col-start-auto">
                      <span className="sm:hidden">Avg pos </span>{source.avgPosition ? `#${source.avgPosition.toFixed(1)}` : '-'}
                    </div>
                    <div className="w-8 flex justify-end col-start-2 sm:col-start-auto row-start-1 sm:row-start-auto justify-self-end">
                      {source.topUrl ? (
                        <a href={source.topUrl} target="_blank" rel="noreferrer" className="p-1.5 rounded-full text-slate-quiet hover:bg-mist hover:text-foreground transition-colors" title="View most cited URL">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      ) : (
                        <div className="w-6 h-6"></div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Named entities mentioned in saved answers */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-[16px] steep-heading">Who Appeared in Answers</h2>
              <p className="text-[12px] text-slate-quiet">
                Named companies, organisations, products, and services with verbatim evidence
              </p>
              <p className="text-[11px] text-ash mt-1 max-w-[520px]">
                Answer mentions and cited sources are parallel signals; no source is attributed to a specific name here.
              </p>
            </div>
            {!insights.entityExtraction.isComplete && (
              <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-[var(--warning-surface)] text-warning uppercase tracking-wider">
                Analyzed {insights.entityExtraction.analyzedAnswers} of {insights.entityExtraction.totalAnswers}
              </span>
            )}
          </div>
          <div className="bg-paper border border-border rounded-2xl overflow-hidden flex flex-col min-h-[300px] max-h-[600px]">
            <div className="hidden sm:grid grid-cols-[1fr_auto_auto] gap-4 p-3 border-b border-border bg-fog text-[11px] font-medium text-ash uppercase tracking-wider shrink-0">
              <div>Name</div>
              <div className="w-24 text-right">Answers</div>
              <div className="w-6"></div>
            </div>
            <div className="divide-y divide-border overflow-y-auto flex-1">
              {insights.mentionedEntities.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-12">
                  <Target className="w-8 h-8 text-smoke mb-3" />
                  <p className="text-[14px] font-medium text-foreground">
                    {insights.entityExtraction.pendingAnswers > 0
                      ? "Analyzing answer mentions"
                      : "No explicit entities found"}
                  </p>
                  <p className="text-[13px] text-slate-quiet mt-1 max-w-[280px]">
                    {insights.entityExtraction.pendingAnswers > 0
                      ? "Saved answers are being checked for named companies, organisations, products, and services. This panel updates when analysis completes."
                      : insights.entityExtraction.failedAnswers > 0
                        ? "Some saved answers could not be analyzed. Existing citations remain available alongside this panel."
                        : "The analyzed answers did not explicitly name a relevant entity in this window."}
                  </p>
                </div>
              ) : (
                insights.mentionedEntities.map((entity) => (
                  <MentionedEntityRow
                    key={entity.name.toLocaleLowerCase()}
                    entity={entity}
                    models={models}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tables Row 2: History */}
      <div className="m1-stagger visible space-y-4" style={{ animationDelay: '300ms' }}>
        <h2 className="text-[16px] steep-heading">Simulation History</h2>
        <div className="bg-paper border border-border rounded-2xl overflow-hidden flex flex-col max-h-[600px]">
          <div className="hidden sm:grid grid-cols-[auto_1fr_auto_auto] gap-4 p-3 border-b border-border bg-fog text-[11px] font-medium text-ash uppercase tracking-wider shrink-0">
            <div className="w-32">Date</div>
            <div>Model</div>
            <div className="w-12 text-right">Links</div>
            <div className="w-28 text-right">Brand</div>
          </div>
          <div className="divide-y divide-border overflow-y-auto flex-1">
            {loadingRuns ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-12">
                 <p className="text-[13px] text-slate-quiet">Loading runs...</p>
              </div>
            ) : runs?.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-12">
                <AlertCircle className="w-8 h-8 text-smoke mb-3" />
                <p className="text-[14px] font-medium text-foreground">No simulations yet</p>
                <p className="text-[13px] text-slate-quiet mt-1">Run your first test prompt to analyze AI answers.</p>
              </div>
            ) : (
              runs?.map(run => (
                <Link key={run.id} href={`/chats/${run.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[auto_1fr_auto_auto] gap-2 sm:gap-4 p-3 hover:bg-mist transition-colors items-center group">
                  <div className="sm:w-32 text-[12px] font-medium text-slate-quiet sm:text-foreground row-start-2 sm:row-start-auto">
                    {new Date(run.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                  <div className="text-[13px] font-medium text-foreground flex items-center gap-2 truncate col-span-2 sm:col-span-1 row-start-1">
                    <Bot className="w-3.5 h-3.5 text-slate-quiet shrink-0" />
                    <span className="truncate">{modelLabel(models, run.model)}</span>
                    <RunStateBadge searchStatus={run.searchStatus} citationEligible={run.citationEligible} />
                  </div>
                  <div className="sm:w-12 text-right text-[12px] sm:text-[13px] font-medium tabular-nums text-slate-quiet sm:text-foreground row-start-2 sm:row-start-auto">
                    {run.citationCount} <span className="sm:hidden">links</span>
                  </div>
                  <div className="flex sm:w-28 justify-start sm:justify-end col-span-2 sm:col-span-1 row-start-3 sm:row-start-auto">
                    {run.brandMentioned ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--positive-surface)] text-positive uppercase tracking-wide whitespace-nowrap">
                        <span className="sm:hidden">Brand mentioned: </span>Yes {run.brandPosition ? `(#${run.brandPosition})` : ''}
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-mist text-ash uppercase tracking-wide whitespace-nowrap">
                        <span className="sm:hidden">Brand mentioned: </span>No
                      </span>
                    )}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Sub-components & Helpers

function MentionedEntityRow({
  entity,
  models,
}: {
  entity: PromptMentionedEntity;
  models: ModelInfo[];
}) {
  const [expanded, setExpanded] = useState(false);
  const testId = entity.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <div className="hover:bg-mist/30 transition-colors group">
      <button
        type="button"
        className="w-full p-3 cursor-pointer flex items-center justify-between gap-4 text-left"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        data-testid={`row-entity-${testId}`}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-foreground truncate">{entity.name}</div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-border text-ash uppercase tracking-wider">
              Answer evidence
            </span>
          </div>
          <div className="sm:hidden text-[11px] text-slate-quiet mt-1.5">
            {entity.appearances} {entity.appearances === 1 ? "answer" : "answers"} · {entity.shareOfAnalyzedAnswersPct}% of analyzed answers
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right hidden sm:block w-24">
            <div className="text-[13px] font-medium tabular-nums text-foreground">{entity.appearances} <span className="text-[11px] font-normal text-slate-quiet">answers</span></div>
            <div className="text-[11px] text-slate-quiet">{entity.shareOfAnalyzedAnswersPct}% share</div>
          </div>
          <span className="p-1 text-slate-quiet group-hover:text-foreground transition-colors group-hover:bg-mist rounded-md">
            <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-4 pt-1 animate-in fade-in slide-in-from-top-1">
          <div className="p-4 bg-fog rounded-xl space-y-4 border border-border">
            <div>
              <div className="text-[12px] font-medium text-foreground mb-1.5">Observed Evidence</div>
              <p className="text-[13px] text-slate-quiet leading-relaxed">
                {entity.observedReason}
              </p>
              <div className="mt-3 pl-3 border-l-2 border-primary/20 italic text-[13px] text-slate-quiet bg-mist/50 py-2 pr-3 rounded-r-lg">
                “{entity.evidenceExcerpt}”
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="text-[11px] text-ash uppercase tracking-wider font-medium">Seen on:</span>
                {entity.models.map((m: string) => (
                  <span key={m} className="flex items-center gap-1 text-[11px] bg-paper border border-border px-1.5 py-0.5 rounded text-slate-quiet">
                    <Bot className="w-3 h-3" /> {modelLabel(models, m)}
                  </span>
                ))}
              </div>
            </div>

            {(entity.strategyRationale || entity.strategyCategory) && (
              <div className="pt-3 border-t border-border">
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-[12px] font-medium text-foreground">
                    {entity.strategyCategory ? "Strategic Implication" : "Planning Note"}
                  </div>
                  {entity.strategyCategory && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-mist text-ash uppercase tracking-wider">
                      {entity.strategyCategory.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <div className="text-[13px] text-sienna bg-blush/40 p-3 rounded-lg border border-blush/60">
                  {entity.strategyRationale}
                </div>
              </div>
            )}
            <div className="flex items-center justify-end pt-2">
              <Link href={`/chats/${entity.evidenceRunId}`} className="flex items-center gap-1.5 text-[12px] font-medium text-primary hover:text-primary/80 transition-colors" data-testid={`link-run-${entity.evidenceRunId}`}>
                View Original Answer <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RunStateBadge({ searchStatus, citationEligible }: { searchStatus?: string | null; citationEligible?: boolean | null }) {
  const s = searchStatusLabel(searchStatus, citationEligible);
  if (s.tone === "ok") return null; // verified search is the default expectation
  return (
    <span className={cn(
      "text-[9px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap shrink-0",
      s.tone === "warn" ? "bg-[var(--warning-surface)] text-warning" : "bg-mist text-ash"
    )}>
      {s.label}
    </span>
  );
}

function MetricCard({ label, value, subtitle, delta }: { label: string; value: React.ReactNode; subtitle?: string; delta?: number | null }) {
  return (
    <div className="bg-fog border border-border rounded-2xl p-4 flex flex-col justify-center h-full">
      <div className="text-[11px] font-medium text-ash mb-1.5 uppercase tracking-wider">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-medium text-foreground tabular-nums tracking-tight">{value}</span>
        {delta != null && <DeltaBadge value={delta} />}
        {subtitle && !delta && <span className="text-[11px] font-medium text-slate-quiet">{subtitle}</span>}
      </div>
    </div>
  );
}

function DeltaBadge({ value }: { value: number }) {
  if (!value) return null;
  const isPos = value > 0;
  return (
    <span className={cn(
      "text-[11px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5 tabular-nums",
      isPos ? "text-positive bg-[var(--positive-surface)]" : "text-negative bg-[var(--negative-surface)]"
    )}>
      {isPos ? "+" : ""}{value}%
    </span>
  );
}

const VisibilityTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const date = label;
    const visibility = payload[0].value;

    return (
      <div className="bg-popover border border-border shadow-[var(--shadow-popover)] rounded-lg p-3 min-w-[140px]">
        <div className="text-[11px] font-medium text-ash mb-2 uppercase tracking-wider">{formatDateLong(date)}</div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-foreground">Visibility</span>
          <span className="text-[13px] font-medium text-foreground tabular-nums">{visibility != null ? `${visibility}%` : 'No data'}</span>
        </div>
      </div>
    );
  }
  return null;
};

const CitationTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-popover border border-border shadow-[var(--shadow-popover)] rounded-lg p-3 min-w-[180px]">
        <div className="text-[11px] font-medium text-ash mb-3 uppercase tracking-wider">{formatDateLong(label)}</div>
        <div className="space-y-2">
          {payload.map((entry: any, index: number) => {
            if (!entry.value) return null; // hide zeros
            return (
              <div key={index} className="flex items-center justify-between text-[12px]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span className="text-slate-quiet font-medium">{entry.name}</span>
                </div>
                <span className="font-medium text-foreground tabular-nums">{entry.value}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return null;
};

function getDomainTypeBadgeClasses(type: string) {
  switch (type.toLowerCase()) {
    case 'you':
    case 'owned':
      return "bg-primary text-primary-foreground";
    case 'competitor': 
      return "bg-mist text-foreground";
    case 'editorial': 
      return "bg-mist text-ash";
    case 'ugc': 
    case 'reference':
      return "bg-mist text-ash";
    case 'institutional': 
      return "bg-mist text-ash";
    case 'corporate': 
      return "bg-mist text-foreground";
    default: 
      return "bg-mist text-ash";
  }
}

function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatShortDate(dateStr: string) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
}

function formatDateLong(dateStr: string) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
