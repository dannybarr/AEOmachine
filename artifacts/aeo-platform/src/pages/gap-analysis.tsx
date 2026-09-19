import { useMemo, useState } from "react";
import {
  useGetGapResearchReport,
  getGetGapResearchReportQueryKey,
  useStartGapResearch,
  type GapResearchFinding,
  type GapResearchJob,
  type GapResearchTrend,
  type GapEvidenceItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertCircle,
  Microscope,
  RefreshCw,
  ChevronDown,
  ExternalLink,
  ShieldQuestion,
  CheckCircle2,
  XCircle,
  Clock,
  Rocket,
  Info,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/components/CompanyContext";
import { PromoteFindingDialog } from "@/components/gap/PromoteFindingDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const CHANNEL_LABELS: Record<string, string> = {
  competitor_owned: "Competitor-owned",
  editorial: "Editorial / press",
  ugc: "UGC / forum",
  review_listicle: "Review / listicle",
  reference: "Reference",
  brand_owned: "Your domain",
  other: "Other",
};

const CHANNEL_BADGES: Record<string, string> = {
  competitor_owned: "bg-[var(--negative-surface)] text-negative",
  editorial: "bg-mist text-foreground",
  ugc: "bg-[var(--warning-surface)] text-warning",
  review_listicle: "bg-mist text-foreground",
  reference: "bg-mist text-foreground",
  brand_owned: "bg-[var(--positive-surface)] text-positive",
  other: "bg-mist text-slate-quiet",
};

const CONFIDENCE_BADGES: Record<string, string> = {
  strong: "bg-[var(--positive-surface)] text-positive border-border",
  moderate: "bg-mist text-foreground border-border",
  weak: "bg-[var(--warning-surface)] text-warning border-border",
  insufficient: "bg-mist text-slate-quiet border-border",
};

const FETCH_STATUS_LABELS: Record<string, string> = {
  ok: "Verified",
  http_error: "Fetch failed",
  timeout: "Timed out",
  blocked: "Access blocked",
  unreachable: "Unreachable",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function GapAnalysis() {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: report, isLoading } = useGetGapResearchReport(
    { companyId },
    {
      query: {
        queryKey: getGetGapResearchReportQueryKey({ companyId }),
        refetchInterval: (q) =>
          q.state.data?.latestJob?.status === "running" ? 3000 : 30000,
      },
    },
  );

  const start = useStartGapResearch({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetGapResearchReportQueryKey({ companyId }),
        });
        toast({
          title: "Research started",
          description: "You can leave this page — progress is saved on the server.",
        });
      },
      onError: (err: unknown) =>
        toast({
          title:
            (err as { status?: number })?.status === 409
              ? "Research already running"
              : "Could not start research",
          variant: "destructive",
        }),
    },
  });

  const latestJob = report?.latestJob ?? null;
  const snapshot = report?.snapshot ?? null;
  const running = latestJob?.status === "running";

  // ── Filters & sorting ──
  const [topic, setTopic] = useState("all");
  const [channel, setChannel] = useState("all");
  const [competitor, setCompetitor] = useState("all");
  const [model, setModel] = useState("all");
  const [gapType, setGapType] = useState("all");
  const [opportunity, setOpportunity] = useState("all");
  const [sort, setSort] = useState<"evidence" | "recency" | "runs">("evidence");

  const findings = snapshot?.findings ?? [];
  const topics = useMemo(() => [...new Set(findings.map((f) => f.topic))].sort(), [findings]);
  const competitors = useMemo(
    () => [...new Set(findings.flatMap((f) => f.competitors.map((c) => c.domain)))].sort(),
    [findings],
  );
  const models = useMemo(
    () => [...new Set(findings.flatMap((f) => f.modelCoverage.map((m) => m.model)))].sort(),
    [findings],
  );

  const visible = useMemo(() => {
    let list = findings;
    if (topic !== "all") list = list.filter((f) => f.topic === topic);
    if (gapType !== "all") list = list.filter((f) => f.gapType === gapType);
    if (channel !== "all")
      list = list.filter((f) => f.evidence.some((e) => e.channel === channel));
    if (competitor !== "all")
      list = list.filter((f) => f.competitors.some((c) => c.domain === competitor));
    if (model !== "all")
      list = list.filter((f) => f.modelCoverage.some((m) => m.model === model));
    if (opportunity !== "all")
      list = list.filter((f) => f.recommendation.category === opportunity);
    return [...list].sort((a, b) => {
      if (sort === "evidence") return b.citationCount - a.citationCount;
      if (sort === "runs") return b.runCount - a.runCount;
      return (
        new Date(b.lastRunAt ?? 0).getTime() - new Date(a.lastRunAt ?? 0).getTime()
      );
    });
  }, [findings, topic, gapType, channel, competitor, model, opportunity, sort]);

  const stale =
    snapshot &&
    Date.now() - new Date(snapshot.job.finishedAt ?? snapshot.job.createdAt).getTime() >
      7 * 86400_000;

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto space-y-6 sm:space-y-8 m1-stagger visible">
      <header className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <h1 className="steep-heading text-2xl tracking-tight">Gap Analysis</h1>
          <p className="text-[13px] text-slate-quiet mt-1 max-w-2xl">
            Evidence-backed research into the prompts where your brand is missing: who
            surfaces instead, which exact pages get cited, and what to do about it.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <MethodologyDialog job={snapshot?.job ?? latestJob} />
          <button
            className="m1-btn"
            disabled={running || start.isPending}
            onClick={() => start.mutate({ data: { companyId, windowDays: 30 } })}
          >
            {running ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Researching…
              </>
            ) : (
              <>
                <Microscope className="w-4 h-4" />
                {snapshot ? "Refresh research" : "Start research"}
              </>
            )}
          </button>
        </div>
      </header>

      {latestJob && latestJob.status === "running" && <JobProgress job={latestJob} />}
      {latestJob && latestJob.status === "failed" && (
        <div className="m1-card p-4 flex items-center gap-3 border-border bg-[var(--negative-surface)]">
          <XCircle className="w-4 h-4 text-negative shrink-0" />
          <div className="text-[13px] text-foreground">
            The last research run failed{latestJob.error ? `: ${latestJob.error}` : "."}{" "}
            {snapshot ? "Showing the previous completed snapshot below." : "Start a new run to try again."}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="p-6 sm:p-12 text-center text-[13px] text-slate-quiet">
          Loading research…
        </div>
      ) : !snapshot ? (
        <EmptyState running={running} />
      ) : (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-[12px] text-slate-quiet">
              <Clock className="w-3.5 h-3.5" />
              Researched {timeAgo(snapshot.job.finishedAt ?? snapshot.job.createdAt)} ·{" "}
              {snapshot.job.windowDays}-day window · {snapshot.job.eligibleRunCount} eligible
              runs · analysis v{snapshot.job.analysisVersion}
              {stale && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--warning-surface)] text-warning uppercase tracking-wide">
                  Stale — refresh recommended
                </span>
              )}
            </div>
            {snapshot.job.failedSources > 0 && (
              <span className="text-[11px] text-slate-quiet">
                {snapshot.job.failedSources} of {snapshot.job.totalSources} sources could not
                be fetched (shown per source below)
              </span>
            )}
          </div>

          {/* ── Cross-prompt trends ── */}
          {snapshot.trends.length > 0 && (
            <section className="space-y-3">
              <h2 className="steep-heading text-[15px]">
                Cross-prompt trends
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {snapshot.trends.slice(0, 6).map((t) => (
                  <TrendCard key={t.id} trend={t} />
                ))}
              </div>
            </section>
          )}

          {/* ── Filters ── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="steep-heading text-[15px]">
                Prompt-level findings{" "}
                <span className="text-slate-quiet font-normal text-[13px]">
                  ({visible.length} of {findings.length})
                </span>
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <FilterSelect value={topic} onChange={setTopic} allLabel="All topics" options={topics} />
                <FilterSelect
                  value={channel}
                  onChange={setChannel}
                  allLabel="All channels"
                  options={Object.keys(CHANNEL_LABELS).filter((c) => c !== "brand_owned")}
                  labels={CHANNEL_LABELS}
                />
                <FilterSelect value={competitor} onChange={setCompetitor} allLabel="All competitors" options={competitors} />
                <FilterSelect value={model} onChange={setModel} allLabel="All models" options={models} />
                <FilterSelect
                  value={gapType}
                  onChange={setGapType}
                  allLabel="All gaps"
                  options={["full", "partial"]}
                  labels={{ full: "Full gap (0 mentions)", partial: "Partial gap (<50%)" }}
                />
                <FilterSelect
                  value={opportunity}
                  onChange={setOpportunity}
                  allLabel="Any opportunity"
                  options={["on_page", "off_page"]}
                  labels={{ on_page: "Onsite", off_page: "Offsite" }}
                />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  className="h-8 px-2 text-[12px] font-medium bg-background border border-border rounded-lg"
                >
                  <option value="evidence">Sort: evidence strength</option>
                  <option value="recency">Sort: most recent</option>
                  <option value="runs">Sort: most runs</option>
                </select>
              </div>
            </div>

            {visible.length === 0 ? (
              <div className="m1-card p-10 text-center text-[13px] text-slate-quiet">
                {findings.length === 0
                  ? "No gap prompts found in this window — your brand was mentioned for every tracked prompt with runs."
                  : "No findings match the current filters."}
              </div>
            ) : (
              <div className="space-y-4">
                {visible.map((f) => (
                  <FindingCard key={f.id} finding={f} companyId={companyId} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───

function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
  labels,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: string[];
  labels?: Record<string, string>;
}) {
  if (options.length === 0) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 px-2 text-[12px] font-medium bg-background border border-border rounded-lg max-w-[180px]"
    >
      <option value="all">{allLabel}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

function JobProgress({ job }: { job: GapResearchJob }) {
  const phaseLabel: Record<string, string> = {
    collecting: "Collecting eligible runs & citations",
    fetching: `Fetching cited pages (${job.fetchedSources + job.cachedSources + job.failedSources}/${job.totalSources || "…"})`,
    analyzing: "Analyzing evidence & building findings",
    done: "Finalizing",
  };
  const total = job.totalSources || 1;
  const done = Math.min(job.fetchedSources + job.cachedSources + job.failedSources, total);
  return (
    <div className="m1-card p-4 space-y-2">
      <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
        <RefreshCw className="w-4 h-4 animate-spin text-slate-quiet" />
        {phaseLabel[job.phase] ?? job.phase}
        <span className="text-[11px] text-slate-quiet font-normal ml-auto">
          Durable — safe to leave this page
        </span>
      </div>
      <div className="h-1.5 w-full bg-mist rounded-full overflow-hidden">
        <div
          className="h-full bg-foreground rounded-full transition-all duration-500"
          style={{
            width:
              job.phase === "collecting"
                ? "8%"
                : job.phase === "fetching"
                  ? `${10 + (80 * done) / total}%`
                  : "95%",
          }}
        />
      </div>
      {job.failedSources > 0 && (
        <div className="text-[11px] text-slate-quiet">
          {job.failedSources} source{job.failedSources === 1 ? "" : "s"} failed to fetch so
          far — failures are recorded, not hidden.
        </div>
      )}
    </div>
  );
}

function TrendCard({ trend }: { trend: GapResearchTrend }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="m1-card p-4 space-y-2.5 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-medium text-foreground leading-snug">
          {trend.title}
        </h3>
        <span
          className={cn(
            "text-[10px] font-medium px-1.5 py-0.5 rounded-full border uppercase tracking-wide shrink-0",
            CONFIDENCE_BADGES[trend.confidence],
          )}
        >
          {trend.confidence} · n={trend.sampleSize}
        </span>
      </div>
      <p className="text-[12px] text-foreground leading-relaxed">
        <span className="font-medium text-ash uppercase text-[10px] tracking-wide mr-1">
          Observed
        </span>
        {trend.observation}
      </p>
      {trend.hypothesis && (
        <p className="text-[12px] text-slate-quiet leading-relaxed">
          <span className="font-medium uppercase text-[10px] tracking-wide mr-1 text-foreground">
            Hypothesis
          </span>
          {trend.hypothesis}
        </p>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] font-medium text-slate-quiet hover:text-foreground flex items-center gap-1 mt-auto pt-1 rounded-full"
      >
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
        {open ? "Hide" : "Show"} evidence ({trend.evidence.length}) & caveats
      </button>
      {open && (
        <div className="space-y-2 pt-1 border-t border-border">
          {trend.evidence.map((e) => (
            <a
              key={e.url}
              href={e.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-[11px] text-slate-quiet hover:text-foreground"
            >
              <span className={cn("text-[9px] font-medium px-1 py-0.5 rounded-full uppercase shrink-0", CHANNEL_BADGES[e.channel] ?? CHANNEL_BADGES["other"])}>
                {e.citations}×
              </span>
              <span className="truncate">{e.url}</span>
            </a>
          ))}
          {trend.contradictoryEvidence && (
            <p className="text-[11px] text-slate-quiet italic leading-relaxed">
              {trend.contradictoryEvidence}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FindingCard({
  finding,
  companyId,
}: {
  finding: GapResearchFinding;
  companyId: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const rec = finding.recommendation;
  const topEvidence = finding.evidence.slice(0, expanded ? undefined : 3);

  return (
    <div className="m1-card overflow-hidden">
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <Link
              href={`/prompts/${finding.promptId}`}
              className="text-[14px] font-medium text-foreground hover:underline"
            >
              {finding.promptText}
            </Link>
            <div className="flex items-center gap-3 text-[11px] font-medium text-ash uppercase tracking-wide flex-wrap">
              <span>Topic: {finding.topic}</span>
              <span>·</span>
              <span>
                {finding.mentionCount}/{finding.runCount} runs mentioned you
              </span>
              <span>·</span>
              <span>{finding.eligibleRunCount} citation-eligible runs</span>
              {finding.lastRunAt && (
                <>
                  <span>·</span>
                  <span>Last run {timeAgo(finding.lastRunAt)}</span>
                </>
              )}
            </div>
          </div>
          <div
            className={cn(
              "shrink-0 flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border uppercase tracking-wider",
              finding.gapType === "full"
                ? "text-negative bg-[var(--negative-surface)] border-border"
                : "text-warning bg-[var(--warning-surface)] border-border",
            )}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            {finding.gapType === "full" ? "Full gap" : "Partial gap"}
          </div>
        </div>

        {/* Model coverage */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {finding.modelCoverage.map((m) => (
            <span
              key={m.model}
              title={
                m.citationsEligible
                  ? `${m.runs} runs, ${m.mentioned} mentioned you`
                  : `${m.runs} runs — this model returns no grounded citations here, so it is excluded from source evidence`
              }
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded-full tracking-wide",
                m.citationsEligible
                  ? "bg-mist text-foreground"
                  : "bg-mist text-smoke line-through decoration-smoke",
              )}
            >
              {m.model.split("/")[1] ?? m.model} ×{m.runs}
            </span>
          ))}
          {finding.competitors.length > 0 && (
            <>
              <span className="text-[10px] text-slate-quiet ml-1">Surfaced instead:</span>
              {finding.competitors.map((c) => (
                <span
                  key={c.domain}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--negative-surface)] text-negative"
                  title={`Appeared in ${c.runsSurfaced} answer${c.runsSurfaced === 1 ? "" : "s"}`}
                >
                  {c.name}
                </span>
              ))}
            </>
          )}
        </div>

        {/* Evidence table */}
        {finding.evidence.length === 0 ? (
          <div className="bg-mist border border-border rounded-lg p-4 text-[12px] text-slate-quiet">
            No provider-returned citations exist for this prompt's eligible runs in this
            window — there is no source evidence to analyze (this is reported, not
            guessed).
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-3 py-2 bg-fog border-b border-border text-[10px] font-medium text-ash uppercase tracking-wider">
              <div>Cited source</div>
              <div className="w-20 text-right">Citations</div>
              <div className="w-16 text-right">Avg pos</div>
              <div className="w-20 text-right">Last seen</div>
              <div className="w-6" />
            </div>
            <div className="divide-y divide-border">
              {topEvidence.map((e) => (
                <EvidenceRow key={e.id} evidence={e} />
              ))}
            </div>
            {finding.evidence.length > 3 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-full py-2 text-[11px] font-medium text-slate-quiet hover:text-foreground hover:bg-mist transition-colors flex items-center justify-center gap-1 rounded-full"
              >
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", expanded && "rotate-180")} />
                {expanded ? "Show fewer" : `Show all ${finding.evidence.length} sources`}
              </button>
            )}
          </div>
        )}

        {/* Recommendation */}
        <div
          className={cn(
            "rounded-lg border p-4",
            rec.status === "proposed"
              ? "bg-fog border-border"
              : "bg-mist border-border",
          )}
        >
          <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-ash">
                  {rec.status === "proposed" ? "Recommended action" : "Insufficient evidence"}
                </span>
                {rec.status === "proposed" && rec.category && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-foreground text-background uppercase tracking-wide">
                    {rec.category === "on_page" ? "Onsite" : "Offsite"}
                  </span>
                )}
                {rec.playType && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-mist text-foreground">
                    {rec.playType}
                  </span>
                )}
              </div>
              <p className="text-[12px] text-foreground leading-relaxed">{rec.rationale}</p>
            </div>
            {rec.status === "proposed" &&
              (finding.promotion ? (
                <span className="shrink-0 flex items-center gap-1.5 text-[11px] font-medium text-positive bg-[var(--positive-surface)] px-2.5 py-1.5 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" /> In Strategy Actions
                </span>
              ) : (
                <button className="m1-btn m1-btn--outline shrink-0" onClick={() => setPromoteOpen(true)}>
                  <Rocket className="w-3.5 h-3.5 mr-1" /> Promote…
                </button>
              ))}
          </div>
        </div>
      </div>
      <PromoteFindingDialog
        finding={finding}
        companyId={companyId}
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
      />
    </div>
  );
}

function EvidenceRow({ evidence: e }: { evidence: GapEvidenceItem }) {
  const [open, setOpen] = useState(false);
  const page = e.page;
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[1fr_auto_auto_auto_auto] gap-2 md:gap-3 px-3 py-2.5 items-center text-left hover:bg-mist transition-colors rounded-lg"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={`https://www.google.com/s2/favicons?domain=${e.domain}&sz=16`}
              className="w-3.5 h-3.5 rounded-full shrink-0"
              alt=""
            />
            <span className="text-[12px] font-medium text-foreground truncate">
              {page?.title || e.canonicalUrl}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide", CHANNEL_BADGES[e.channel] ?? CHANNEL_BADGES["other"])}>
              {CHANNEL_LABELS[e.channel] ?? e.channel}
            </span>
            <span className="text-[10px] text-slate-quiet truncate">{e.domain}</span>
            {page && page.fetchStatus !== "ok" && (
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-mist text-ash uppercase tracking-wide">
                {FETCH_STATUS_LABELS[page.fetchStatus] ?? page.fetchStatus}
                {page.httpStatus ? ` (${page.httpStatus})` : ""}
              </span>
            )}
            {!page && (
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-mist text-ash uppercase tracking-wide">
                Not fetched
              </span>
            )}
          </div>
          <div className="md:hidden flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-slate-quiet">
            <span>Avg position <strong className="font-medium text-foreground">{e.avgPosition != null ? `#${e.avgPosition.toFixed(1)}` : "—"}</strong></span>
            <span>Last seen <strong className="font-medium text-foreground">{e.lastSeenAt ? timeAgo(e.lastSeenAt) : "—"}</strong></span>
          </div>
        </div>
        <div className="md:w-20 text-right text-[11px] md:text-[12px] font-medium tabular-nums text-foreground">
          {e.citationCount}× in {e.runCount} run{e.runCount === 1 ? "" : "s"}
        </div>
        <div className="hidden md:block w-16 text-right text-[12px] tabular-nums text-foreground">
          {e.avgPosition != null ? `#${e.avgPosition.toFixed(1)}` : "—"}
        </div>
        <div className="hidden md:block w-20 text-right text-[11px] text-slate-quiet">
          {e.lastSeenAt ? timeAgo(e.lastSeenAt) : "—"}
        </div>
        <ChevronDown className={cn("w-3.5 h-3.5 text-slate-quiet transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 bg-fog">
          <a
            href={e.canonicalUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-[11px] text-foreground hover:underline break-all"
          >
            <ExternalLink className="w-3 h-3 shrink-0" /> {e.canonicalUrl}
          </a>
          {page?.snippet && (
            <p className="text-[11px] text-slate-quiet leading-relaxed">
              <span className="font-medium">Page description:</span> {page.snippet}
            </p>
          )}
          {page?.signals && (
            <div className="flex gap-1.5">
              {Object.entries(page.signals)
                .filter(([, v]) => v)
                .map(([k]) => (
                  <span key={k} className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-mist text-foreground uppercase tracking-wide">
                    {k.replace(/^is/, "")}
                  </span>
                ))}
            </div>
          )}
          {e.answerContext && (
            <p className="text-[11px] text-slate-quiet leading-relaxed border-l-2 border-border pl-2">
              <span className="font-medium">Answer context:</span> “{e.answerContext}”
            </p>
          )}
          <div className="text-[10px] text-slate-quiet">
            Cited by {e.models.join(", ")} · runs{" "}
            {e.runIds.slice(0, 6).map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <Link href={`/chats/${id}`} className="underline hover:text-foreground">
                  #{id}
                </Link>
              </span>
            ))}
            {e.runIds.length > 6 && ` +${e.runIds.length - 6} more`}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ running }: { running: boolean }) {
  return (
    <div className="m1-card p-14 text-center flex flex-col items-center">
      <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center mb-4">
        <FlaskConical className="w-5 h-5 text-slate-quiet" />
      </div>
      <p className="text-[14px] font-medium text-foreground">
        {running ? "Research is running…" : "No research yet"}
      </p>
      <p className="text-[13px] text-slate-quiet mt-1 max-w-md">
        {running
          ? "Findings will appear here when the run completes. You can leave this page — progress is saved on the server."
          : "Start a research run to analyze your gap prompts: it verifies cited sources, classifies channels, and proposes evidence-backed actions."}
      </p>
    </div>
  );
}

function MethodologyDialog({ job }: { job: GapResearchJob | null }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="m1-btn m1-btn--outline">
          <ShieldQuestion className="w-4 h-4 mr-1" /> Methodology
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="steep-heading">How this research works</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-[13px] leading-relaxed text-foreground pt-2">
          {job && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-mist border border-border text-center">
              <MethodStat label="Eligible runs" value={job.eligibleRunCount} />
              <MethodStat label="Excluded runs" value={job.ineligibleRunCount} />
              <MethodStat label="Gap prompts" value={job.gapPromptCount} />
              <MethodStat
                label="Sources fetched"
                value={`${job.fetchedSources + job.cachedSources}/${job.totalSources}`}
              />
            </div>
          )}
          <MethodSection title="Eligible runs">
            Findings use only stored prompt runs from the selected window, and source
            evidence comes only from models that perform real web retrieval. Runs from
            models without grounded citations are counted and shown, but excluded from
            source evidence — absence of citations there is not treated as evidence.
          </MethodSection>
          <MethodSection title="Source verification">
            Every cited URL comes from provider-returned citations of real runs — never
            generated. Cited pages are fetched safely (public pages only) to extract the
            title, description, and page-type signals. Failed, blocked, or timed-out
            fetches are labeled per source; inaccessible pages are never presented as
            verified. Fetched copies are reused for up to 7 days.
          </MethodSection>
          <MethodSection title="Classification">
            URLs are deduplicated by canonical form (tracking parameters stripped).
            Channels combine your domain registry (competitor/editorial/UGC/reference)
            with deterministic page signals (comparison, listicle, review patterns in
            title/description).
          </MethodSection>
          <MethodSection title="Observation vs. correlation vs. hypothesis">
            <span className="font-medium">Observed</span> statements are counted facts
            with explicit sample sizes. Cross-prompt patterns are{" "}
            <span className="font-medium">correlations</span> — repeated retrieval is an
            association, not proof of cause. Anything labeled{" "}
            <span className="font-medium">Hypothesis</span> is an interpretation in
            calibrated language, always traceable to its evidence, with contradictory
            context attached. When evidence is too thin, the system says “insufficient
            evidence” instead of speculating.
          </MethodSection>
          <MethodSection title="Confidence & freshness">
            Confidence is a function of sample size: strong ≥10 citations across ≥3
            prompts, moderate ≥5 across ≥2, weak below that, insufficient under 2
            citations. Snapshots older than 7 days are flagged stale. Each snapshot is
            immutable and records its analysis version
            {job ? ` (this one: v${job.analysisVersion})` : ""} so historical findings stay
            reproducible.
          </MethodSection>
          <div className="flex items-start gap-2 p-3 rounded-lg bg-mist/60 border border-border text-[12px] text-foreground">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            This feature reports associations and evidence-backed hypotheses. It never
            claims a source definitively caused an AI answer.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MethodStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-ash uppercase tracking-wider">
        {label}
      </div>
      <div className="text-[15px] font-medium tabular-nums">{value}</div>
    </div>
  );
}

function MethodSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[12px] font-medium uppercase tracking-wider text-ash mb-1">
        {title}
      </h3>
      <p className="text-[12px] text-foreground leading-relaxed">{children}</p>
    </div>
  );
}
