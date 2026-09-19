import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCompanyAudit,
  useRerunCompanyAudit,
  usePromoteAuditQuickWin,
  getGetCompanyAuditQueryKey,
  getGetCompanyPlaybookQueryKey,
  type AuditFinding,
  type AuditQuickWin,
  type WebsiteAssessmentJob,
  type WebsiteAudit,
  type AuditImpactOutcome,
} from "@workspace/api-client-react";
import { useCompany } from "@/components/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AuditImpactCard } from "@/components/strategy/AuditImpactCard";
import {
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Target,
  AlertTriangle,
  Info,
  CheckCircle2,
  Zap,
  Hammer,
  ChevronDown
} from "lucide-react";

type CategoryNarrative = {
  category?: string;
  name?: string;
  key?: string;
  conclusion?: string;
  strengths?: string[] | string;
  weaknesses?: string[] | string;
  scoreRationale?: string;
  impact?: string;
  evidence?: string[] | string;
  confidence?: string | number;
  limitations?: string[] | string;
};

type RichWebsiteAudit = WebsiteAudit & {
  categoryDetails?: Record<string, CategoryNarrative> | CategoryNarrative[];
  categoryNarratives?: Record<string, CategoryNarrative> | CategoryNarrative[];
};

type RichAuditFinding = AuditFinding & {
  affectedPages?: number | string[];
  affectedCount?: number;
  prevalencePct?: number;
  prevalence?: number;
  representativeUrls?: string[];
  representativeEvidence?: string[] | string;
  impactExplanation?: string;
  scoreRationale?: string;
  confidence?: string | number;
  limitations?: string[] | string;
};

type RichAuditQuickWin = AuditQuickWin & {
  family?: string;
  priorityScore?: number;
  rank?: number;
  rationale?: string;
  audienceRelevance?: string;
  affectedPages?: number | string[];
  affectedCount?: number;
  representativeUrls?: string[];
};

export default function Audit() {
  const { companyId } = useCompany();
  
  const { data, isLoading } = useGetCompanyAudit(
    companyId,
    {
      query: {
        enabled: !!companyId,
        queryKey: getGetCompanyAuditQueryKey(companyId),
        retry: false,
        refetchInterval: (query) => query.state.data?.job?.status === "running" ? 3000 : false,
      }
    }
  );

  if (isLoading && !data) {
    return (
      <div className="p-4 sm:p-8 max-w-[1100px] mx-auto text-center flex flex-col items-center justify-center min-h-[50vh] text-slate-quiet">
        <div className="w-5 h-5 rounded-full border-2 border-foreground border-t-transparent animate-spin mb-4" />
        <span className="text-[13px] font-medium text-foreground">Loading audit...</span>
      </div>
    );
  }

  const { job, audit, promotedQuickWinCodes = [], promotionOutcomes = [] } = data || {};

  return (
    <div className="p-4 sm:p-8 max-w-[1100px] mx-auto space-y-8 m1-stagger visible">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-medium text-ash uppercase tracking-widest mb-2">
            <ShieldCheck className="w-4 h-4" /> Brand Audit
          </div>
          <h1 className="steep-heading text-2xl sm:text-3xl tracking-tight">
            AEO Readiness Assessment
          </h1>
          <p className="text-[13px] text-slate-quiet mt-1.5 max-w-2xl">
            A technical and strategic evaluation of your digital footprint. We look for the 
            evidence and structural signals that AI answer engines rely on to construct citations.
          </p>
        </div>
        <Link
          href={`/lab/strategy/${companyId}`}
          className="m1-btn m1-btn--outline shrink-0"
          data-testid="link-on-page-strategy"
        >
          <Hammer className="w-4 h-4 mr-1.5" />
          On-page Strategy
        </Link>
      </header>

      {job?.status === "running" && (
        <AuditProgress job={job} />
      )}

      {job?.status === "failed" && !audit && (
        <div className="m1-card p-6 bg-[var(--negative-surface)] border-[var(--negative-surface)] flex flex-col items-center justify-center text-center">
          <AlertTriangle className="w-8 h-8 text-negative mb-3" />
          <h3 className="text-[14px] font-medium text-negative">Assessment Failed</h3>
          <p className="text-[13px] text-negative/80 mt-1 max-w-md">
            {job.error || "The background job encountered an error while scanning the site."}
          </p>
        </div>
      )}

      {!audit && job?.status !== "running" && job?.status !== "failed" && (
         <div className="m1-card p-12 text-center flex flex-col items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-smoke mb-3" />
            <p className="text-[14px] text-foreground font-medium">No audit available</p>
            <p className="text-[13px] text-slate-quiet mt-1">Run an assessment to see findings.</p>
            <RerunAuditButton companyId={companyId} />
         </div>
      )}

      {audit && (
        <div className="space-y-10">
          <AuditScoreboard audit={audit} />
          <AuditCategoryPanels audit={audit as RichWebsiteAudit} />
          <AuditQuickWins
            key={audit.id}
            wins={audit.quickWins}
            auditId={audit.id}
            companyId={companyId}
            promotedQuickWinCodes={promotedQuickWinCodes}
            promotionOutcomes={promotionOutcomes}
          />
          <AuditFindings findings={audit.findings} />
          
          <div className="m1-card p-5 sm:p-6 bg-fog border-border">
             <div className="flex items-start gap-3">
               <Info className="w-5 h-5 text-slate-quiet shrink-0 mt-0.5" />
               <div>
                 <h3 className="text-[14px] font-medium text-foreground">Methodology & Limits</h3>
                 <div className="text-[13px] text-slate-quiet mt-1.5 space-y-2">
                   <p>
                     This assessment measures readiness signals that correlate with model inclusion and accurate retrieval, not guaranteed rankings or citation share.
                   </p>
                   {audit.methodology.length > 0 && (
                     <ul className="list-disc pl-4 space-y-1 mt-3 text-smoke">
                       {audit.methodology.map((m, i) => (
                         <li key={i}>{m}</li>
                       ))}
                     </ul>
                   )}
                 </div>
               </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RerunAuditButton({ companyId, iconOnly = false }: { companyId: number, iconOnly?: boolean }) {
  const rerun = useRerunCompanyAudit();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleRerun = () => {
    rerun.mutate(
      { id: companyId, data: {} },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCompanyAuditQueryKey(companyId) });
          toast({
            title: "Website rescan started",
            description: "A new assessment is running. The saved assessment remains visible until the rescan finishes.",
          });
        },
        onError: () => toast({ title: "Could not start website rescan", variant: "destructive" })
      }
    );
  };

  if (iconOnly) {
    return (
      <button 
        onClick={handleRerun} 
        disabled={rerun.isPending}
        className="flex items-center gap-1.5 text-[12px] text-slate-quiet hover:text-foreground transition-colors"
        title="Rescan the website and create a new assessment"
        aria-label="Rescan the website and create a new assessment"
        data-testid="button-rerun-audit"
      >
        <RefreshCw className={cn("w-3.5 h-3.5", rerun.isPending && "animate-spin")} />
        Rescan website
      </button>
    );
  }

  return (
    <button 
      onClick={handleRerun} 
      disabled={rerun.isPending}
      className="m1-btn mt-6"
      data-testid="button-rerun-audit-full"
    >
      <RefreshCw className={cn("w-4 h-4 mr-1.5", rerun.isPending && "animate-spin")} />
      Scan website
    </button>
  );
}


function AuditProgress({ job }: { job: WebsiteAssessmentJob }) {
  const processedPages = job.fetchedPages + job.failedPages;
  const pct = job.totalPages > 0 ? Math.min(100, Math.round((processedPages / job.totalPages) * 100)) : 0;
  
  return (
    <div className="m1-card p-5 sm:p-6 bg-[var(--positive-surface)] border-[var(--positive-surface)] overflow-hidden relative">
      <div className="flex items-center justify-between relative z-10">
         <div className="flex items-center gap-3">
           <div className="w-5 h-5 rounded-full border-2 border-positive border-t-transparent animate-spin" />
           <div>
             <div className="text-[14px] font-medium text-positive flex items-center gap-2">
               Assessment in progress
               <span className="text-[10px] bg-white/50 px-1.5 py-0.5 rounded-full uppercase tracking-widest">{job.phase}</span>
             </div>
             <div className="text-[12px] text-positive/80 mt-0.5">
                Scanning public pages for AI readiness signals. You can leave this page while it runs.
             </div>
           </div>
         </div>
         <div className="text-right">
           <div className="text-2xl font-semibold text-positive tabular-nums tracking-tighter">{pct}%</div>
         </div>
      </div>
      <div 
        className="absolute bottom-0 left-0 h-1 bg-positive transition-all duration-1000 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function AuditScoreboard({ audit }: { audit: WebsiteAudit }) {
  const generatedAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(audit.generatedAt));

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="m1-card p-6 flex flex-col justify-center items-center text-center">
         <div className="text-[11px] font-medium text-ash uppercase tracking-widest mb-2">Overall Score</div>
         <div
           className="text-6xl font-medium tracking-tighter text-foreground my-2 tabular-nums"
           data-testid="text-audit-score"
         >
           {audit.score}
         </div>
         <div className="text-[12px] text-slate-quiet">Out of 100</div>
      </div>
      <div className="m1-card p-6 md:col-span-3 flex flex-col">
         <div className="flex items-center justify-between mb-6">
           <div>
             <div className="text-[11px] font-medium text-ash uppercase tracking-widest">Category Scores</div>
             <div className="mt-1 text-[11px] text-slate-quiet">
               {audit.pagesScanned} public page{audit.pagesScanned === 1 ? "" : "s"} assessed · {generatedAt}
             </div>
           </div>
            <RerunAuditButton companyId={audit.companyId} iconOnly={true} />
         </div>
         <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1">
           {Object.entries(audit.categoryScores).map(([cat, score]) => (
             <div key={cat} className="space-y-1.5">
               <div className="text-[13px] font-medium text-foreground capitalize flex items-center justify-between">
                  {formatLabel(cat)}
                 <span className="tabular-nums text-slate-quiet">{score}/100</span>
               </div>
               <div className="h-1.5 bg-mist rounded-full overflow-hidden">
                 <div className="h-full bg-foreground rounded-full" style={{ width: `${score}%` }} />
               </div>
             </div>
           ))}
         </div>
      </div>
    </div>
  );
}

function AuditCategoryPanels({ audit }: { audit: RichWebsiteAudit }) {
  const source = audit.categoryDetails ?? audit.categoryNarratives;
  if (!source) return null;

  const entries: Array<[string, CategoryNarrative]> = Array.isArray(source)
    ? source.map((item, index) => [item.category ?? item.name ?? item.key ?? `category-${index + 1}`, item])
    : Object.entries(source);

  if (entries.length === 0) return null;

  return (
    <section className="space-y-4" aria-labelledby="category-assessments-heading">
      <div>
        <h2 id="category-assessments-heading" className="text-[13px] font-medium text-foreground tracking-wide uppercase">
          Category Assessments
        </h2>
        <p className="mt-1 text-[13px] text-slate-quiet">
          Expand a category to review the conclusion, scoring rationale, and supporting evidence.
        </p>
      </div>
      <div className="m1-card divide-y divide-border overflow-hidden bg-background">
        {entries.map(([category, narrative], index) => {
          const score = audit.categoryScores[category]
            ?? audit.categoryScores[narrative.category ?? ""];
          return (
            <details key={category} className="group" open={index === 0}>
              <summary
                className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 sm:p-5 hover:bg-fog focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
                data-testid={`button-category-panel-${slugify(category)}`}
              >
                <div className="min-w-0">
                  <span className="text-[15px] font-medium text-foreground">{formatLabel(category)}</span>
                  {narrative.conclusion && (
                    <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-slate-quiet">{narrative.conclusion}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {typeof score === "number" && <span className="text-[13px] tabular-nums text-slate-quiet">{score}/100</span>}
                  <ChevronDown className="h-4 w-4 text-slate-quiet transition-transform group-open:rotate-180" aria-hidden="true" />
                </div>
              </summary>
              <div className="border-t border-border bg-fog/40 px-4 py-5 sm:px-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <NarrativeBlock label="Conclusion" value={narrative.conclusion} />
                  <NarrativeBlock label="Score rationale" value={narrative.scoreRationale} />
                  <NarrativeBlock label="Strengths" value={narrative.strengths} positive />
                  <NarrativeBlock label="Weaknesses" value={narrative.weaknesses} />
                  <NarrativeBlock label="Business impact" value={narrative.impact} />
                  <NarrativeBlock label="Evidence" value={narrative.evidence} />
                  <NarrativeBlock label="Confidence" value={formatConfidence(narrative.confidence)} />
                  <NarrativeBlock label="Limitations" value={narrative.limitations} />
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function NarrativeBlock({ label, value, positive = false }: { label: string; value?: string | string[]; positive?: boolean }) {
  const items = toTextList(value);
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className={cn("text-[10px] font-medium uppercase tracking-widest", positive ? "text-positive" : "text-slate-quiet")}>{label}</h3>
      {items.length === 1 ? (
        <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">{items[0]}</p>
      ) : (
        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-foreground">
          {items.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}

function AuditQuickWins({
  wins,
  auditId,
  companyId,
  promotedQuickWinCodes,
  promotionOutcomes,
}: {
  wins: AuditQuickWin[];
  auditId: number;
  companyId: number;
  promotedQuickWinCodes: string[];
  promotionOutcomes: AuditImpactOutcome[];
}) {
  const promote = usePromoteAuditQuickWin();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [promotedCodes, setPromotedCodes] = useState<Set<string>>(new Set());

  if (!wins || wins.length === 0) return null;

  const handlePromote = (win: AuditQuickWin) => {
    promote.mutate(
      { id: companyId, data: { auditId, quickWinCode: win.code } },
      {
        onSuccess: () => {
          setPromotedCodes(prev => new Set(prev).add(win.code));
          queryClient.invalidateQueries({ queryKey: getGetCompanyPlaybookQueryKey(companyId) });
          toast({ title: "Quick win promoted to Strategy" });
        },
        onError: () => toast({ title: "Could not promote quick win", variant: "destructive" })
      }
    );
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-[13px] font-medium text-foreground tracking-wide uppercase">
        <Zap className="w-4 h-4 text-warning" />
        Prioritized Quick Wins
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {wins.map((win) => {
          const richWin = win as RichAuditQuickWin;
          const isPromoted = promotedQuickWinCodes.includes(win.code) || promotedCodes.has(win.code);
          const outcome = promotionOutcomes.find((item) => item.quickWinCode === win.code);
          const affectedCount = richWin.affectedCount ?? getAffectedPageCount(richWin.affectedPages);
          const sourceUrls = uniqueStrings([
            ...(richWin.representativeUrls ?? []),
            ...(win.pageUrl ? [win.pageUrl] : []),
          ]);
          return (
            <div key={win.code} className="m1-card flex flex-col overflow-hidden" data-testid={`quickwin-${win.code}`}>
              <div className="p-5 flex-1 space-y-4">
                <div className="flex flex-wrap gap-2">
                   {richWin.family && (
                     <span className="text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider bg-mist text-slate-quiet">
                       {formatLabel(richWin.family)}
                     </span>
                   )}
                  <span className={cn(
                    "text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider",
                    win.impact === 'high' ? "bg-[var(--positive-surface)] text-positive" : 
                    win.impact === 'medium' ? "bg-mist text-foreground" : "bg-mist text-slate-quiet"
                  )}>
                    {win.impact} Impact
                  </span>
                  <span className={cn(
                    "text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider",
                    win.effort === 'low' ? "bg-[var(--positive-surface)] text-positive" : 
                    win.effort === 'medium' ? "bg-mist text-foreground" : "bg-[var(--negative-surface)] text-negative"
                  )}>
                    {win.effort} Effort
                  </span>
                    {typeof (richWin.priorityScore ?? richWin.rank) === "number" && (
                     <span className="text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider bg-mist text-foreground">
                        Priority {richWin.priorityScore ?? richWin.rank}
                     </span>
                   )}
                </div>
                <div>
                  <h3 className="text-[16px] font-medium text-foreground leading-snug">{win.title}</h3>
                  <p className="text-[13px] text-slate-quiet mt-1.5 leading-relaxed">{win.recommendation}</p>
                   {(richWin.rationale || richWin.audienceRelevance || affectedCount !== null) && (
                     <div className="mt-3 space-y-1 text-[12px] text-slate-quiet">
                       {richWin.rationale && <p><span className="font-medium text-foreground">Why now:</span> {richWin.rationale}</p>}
                       {richWin.audienceRelevance && <p><span className="font-medium text-foreground">Audience relevance:</span> {richWin.audienceRelevance}</p>}
                       {affectedCount !== null && <p>{affectedCount} affected page{affectedCount === 1 ? "" : "s"}</p>}
                     </div>
                   )}
                </div>
                <div className="bg-fog p-3.5 rounded-xl border border-border text-[13px] text-slate-quiet space-y-2">
                  <div className="font-medium text-foreground flex items-center gap-1.5 uppercase tracking-widest text-[10px]">
                    <Target className="w-3.5 h-3.5" /> Evidence
                  </div>
                  <p className="leading-relaxed">{win.evidence}</p>
                  {sourceUrls.length > 0 && (
                    <div className="pt-2">
                      {sourceUrls.slice(0, 3).map((url, index) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mr-2 mt-1 text-foreground font-medium hover:underline inline-flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-md border border-border shadow-sm"
                          data-testid={`link-quickwin-source-${win.code}-${index}`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Source {sourceUrls.length > 1 ? index + 1 : ""}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                {outcome && <AuditImpactCard impact={outcome} />}
              </div>
              <div className="border-t border-border p-3.5 flex justify-end bg-fog mt-auto">
                {isPromoted ? (
                  <Link
                    href={`/lab/strategy/${companyId}`}
                    className="m1-btn m1-btn--ghost text-positive hover:text-positive hover:bg-[var(--positive-surface)]"
                    data-testid={`link-promoted-strategy-${win.code}`}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1.5" /> Added to Strategy
                  </Link>
                ) : (
                  <button 
                    onClick={() => handlePromote(win)}
                    disabled={promote.isPending}
                    className="m1-btn m1-btn--outline bg-background w-full sm:w-auto"
                     data-testid={`button-promote-quickwin-${win.code}`}
                  >
                    <Hammer className="w-3.5 h-3.5 mr-1.5" /> Add to On-site Strategy
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AuditFindings({ findings }: { findings: AuditFinding[] }) {
  const [filter, setFilter] = useState<string>("all");
  
  if (!findings || findings.length === 0) return null;

  const filtered = filter === "all" 
    ? findings 
    : findings.filter(f => f.severity === filter || f.category.toLowerCase() === filter);
  const severityFilters = ["critical", "high", "medium", "low"].filter((severity) =>
    findings.some((finding) => finding.severity === severity),
  );
  const categoryFilters = [...new Set(findings.map((finding) => finding.category.toLowerCase()))]
    .sort((a, b) => a.localeCompare(b));

  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-[13px] font-medium text-foreground tracking-wide uppercase">
          <ShieldCheck className="w-4 h-4 text-slate-quiet" />
          Detailed Findings
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 hide-scrollbar">
          <FilterPill label="All" active={filter === "all"} onClick={() => setFilter("all")} />
           {severityFilters.map((severity) => (
             <FilterPill
               key={severity}
               label={formatLabel(severity)}
               active={filter === severity}
               onClick={() => setFilter(severity)}
             />
           ))}
           {categoryFilters.map((category) => (
             <FilterPill
               key={category}
               label={formatLabel(category)}
               active={filter === category}
               onClick={() => setFilter(category)}
             />
           ))}
        </div>
      </div>
      
      <div className="m1-card divide-y divide-border overflow-hidden bg-background">
        {filtered.map(f => {
          const richFinding = f as RichAuditFinding;
           const affectedCount = richFinding.affectedCount ?? getAffectedPageCount(richFinding.affectedPages);
           const prevalencePct = richFinding.prevalencePct
             ?? (typeof richFinding.prevalence === "number" ? Math.round(richFinding.prevalence * 100) : undefined);
          const sourceUrls = uniqueStrings([
            ...(richFinding.representativeUrls ?? []),
            ...(Array.isArray(richFinding.affectedPages) ? richFinding.affectedPages : []),
            ...(f.pageUrl ? [f.pageUrl] : []),
          ]);
          const evidence = toTextList(richFinding.representativeEvidence ?? f.evidence);
          const hasSupportingDetail = evidence.length > 0 || sourceUrls.length > 0 || !!richFinding.scoreRationale
            || !!richFinding.confidence || toTextList(richFinding.limitations).length > 0;
          return (
          <div key={f.id} className="p-4 sm:p-5 flex gap-4 hover:bg-fog transition-colors group" data-testid={`finding-${f.id}`}>
            <div className="mt-0.5 shrink-0">
              <SeverityIcon severity={f.severity} />
            </div>
            <div className="flex-1 min-w-0 space-y-2.5">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                   <span className="text-[10px] font-medium bg-mist px-1.5 py-0.5 rounded-full uppercase tracking-wider text-slate-quiet">{formatLabel(f.category)}</span>
                  <span className="text-[10px] font-medium text-ash font-mono">{f.code}</span>
                </div>
                <h4 className="text-[15px] font-medium text-foreground leading-snug">{f.title}</h4>
              </div>
              <p className="text-[13px] text-slate-quiet leading-relaxed">
                {f.explanation}
              </p>
               {(affectedCount !== null || typeof prevalencePct === "number") && (
                 <p className="text-[12px] font-medium text-foreground" data-testid={`text-finding-prevalence-${f.id}`}>
                   {affectedCount !== null && `${affectedCount} affected page${affectedCount === 1 ? "" : "s"}`}
                    {affectedCount !== null && typeof prevalencePct === "number" && " · "}
                    {typeof prevalencePct === "number" && `${prevalencePct}% prevalence`}
                 </p>
               )}
              <div className="bg-fog p-3.5 rounded-xl border border-border text-[13px] space-y-3">
                 <div className="text-foreground flex flex-col gap-1">
                   <span className="font-medium text-[10px] uppercase tracking-widest text-slate-quiet">Recommendation</span> 
                   <span className="leading-relaxed">{f.recommendation}</span>
                 </div>
                  {richFinding.impactExplanation && (
                    <div className="text-slate-quiet flex flex-col gap-1 border-t border-border/50 pt-2">
                      <span className="font-medium text-[10px] uppercase tracking-widest">Why it matters</span>
                      <span className="leading-relaxed">{richFinding.impactExplanation}</span>
                    </div>
                  )}
                  {hasSupportingDetail && (
                    <details className="group/evidence border-t border-border/50 pt-2">
                      <summary
                        className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md text-[12px] font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                        data-testid={`button-finding-evidence-${f.id}`}
                      >
                        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/evidence:rotate-180" aria-hidden="true" />
                        Review evidence and scoring details
                      </summary>
                      <div className="mt-3 space-y-3 text-slate-quiet">
                        <NarrativeBlock label="Representative evidence" value={evidence} />
                        <NarrativeBlock label="Score rationale" value={richFinding.scoreRationale} />
                        <NarrativeBlock label="Confidence" value={formatConfidence(richFinding.confidence)} />
                        <NarrativeBlock label="Limitations" value={richFinding.limitations} />
                        {sourceUrls.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {sourceUrls.slice(0, 5).map((url, index) => (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground font-medium hover:underline inline-flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-md border border-border shadow-sm text-[12px]"
                                data-testid={`link-finding-source-${f.id}-${index}`}
                              >
                                <ExternalLink className="w-3 h-3" /> Representative page {index + 1}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </details>
                  )}
              </div>
            </div>
          </div>
        )})}
        {filtered.length === 0 && (
          <div className="p-10 text-center text-[13px] text-slate-quiet">
            No findings match this filter.
          </div>
        )}
      </div>
    </section>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors border",
        active ? "bg-foreground text-background border-foreground" : "bg-background text-slate-quiet border-border hover:bg-mist hover:text-foreground"
      )}
      data-testid={`button-filter-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
    >
      {label}
    </button>
  );
}

function formatLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function toTextList(value?: string | string[]) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim());
  return typeof value === "string" && value.trim() ? [value] : [];
}

function formatConfidence(value?: string | number) {
  if (typeof value === "number") return value <= 1 ? `${Math.round(value * 100)}%` : `${value}%`;
  return value;
}

function getAffectedPageCount(value?: number | string[]) {
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.length;
  return null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case 'critical':
      return <AlertTriangle className="w-5 h-5 text-negative" />;
    case 'high':
      return <AlertTriangle className="w-5 h-5 text-warning" />;
    case 'medium':
      return <Info className="w-5 h-5 text-blue-500" />;
    default:
      return <CheckCircle2 className="w-5 h-5 text-smoke" />;
  }
}
