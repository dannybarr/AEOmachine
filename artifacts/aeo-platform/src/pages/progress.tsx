import { useState, useMemo } from "react";
import {
  useGetProgress,
  getGetProgressQueryKey,
  useListTrackingJobs,
  getListTrackingJobsQueryKey
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { 
  ResponsiveContainer, 
  ComposedChart, 
  AreaChart,
  Area,
  Line, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  Legend,
  ReferenceLine
} from "recharts";
import { Target, Clock, Calendar, LineChart, Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompany } from "@/components/CompanyContext";
import { MethodologyPanel } from "@/components/MethodologyPanel";

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

export default function Progress() {
  const { companyId } = useCompany();
  const [days, setDays] = useState<number>(30);

  const { data, isLoading } = useGetProgress(
    { companyId, days }, 
    { query: { queryKey: getGetProgressQueryKey({ companyId, days }) } }
  );
  
  const { data: jobs } = useListTrackingJobs(
    { companyId, limit: 1 }, 
    { query: { queryKey: getListTrackingJobsQueryKey({ companyId, limit: 1 }) } }
  );

  const lastJob = jobs?.[0];

  const validEventDates = useMemo(() => {
    if (!data) return [];
    const seriesDates = new Set(data.series.map(s => s.date));
    return Array.from(new Set(data.events.map(e => e.date))).filter(d => seriesDates.has(d));
  }, [data]);

  const isEmpty = !isLoading && data && data.summary.totalRuns === 0 && data.events.length === 0;

  if (isLoading && !data) {
    return (
      <div className="p-4 sm:p-8 max-w-[1200px] mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-quiet" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto space-y-6 sm:space-y-8 m1-stagger visible">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="steep-heading text-2xl tracking-tight">Progress</h1>
          <p className="text-[13px] text-slate-quiet mt-1 flex items-center gap-2">
            Track your AI visibility alongside strategy actions.
            {lastJob && (
              <>
                <span className="text-border">•</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  Last run: {formatDate(lastJob.runDate)} ({lastJob.succeeded}/{lastJob.totalSimulations} success)
                </span>
              </>
            )}
          </p>
        </div>
        
        {/* Time Toggle */}
        <div className="flex items-center gap-4">
        <MethodologyPanel companyId={companyId} days={days} />
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

      {isEmpty ? (
        <div className="bg-paper border border-border rounded-2xl p-12 mt-8 text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center mb-4">
            <LineChart className="w-5 h-5 text-slate-quiet" />
          </div>
          <h2 className="steep-heading text-[16px]">No data yet</h2>
          <p className="text-[13px] text-slate-quiet mt-1 mb-6 max-w-md">
            Your progress timeline will build as you track prompts. Go to the Prompts page to simulate answers and capture your first data point.
          </p>
          <Link href="/prompts" className="m1-btn">
            Go to Prompts <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Link>
        </div>
      ) : (
        <>
          {/* KPIs Summary */}
          {data && (
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 m1-stagger visible" style={{ animationDelay: '90ms' }}>
              <MetricCard 
                label="Visibility" 
                value={data.summary.visibilityPct != null ? `${data.summary.visibilityPct}%` : '-'} 
                delta={data.summary.visibilityDelta} 
              />
              <MetricCard 
                label="Avg Brand Pos" 
                value={data.summary.avgBrandPosition?.toFixed(1) || '-'} 
              />
              <MetricCard 
                label="Avg Citations" 
                value={data.summary.avgCitationsPerRun?.toFixed(1) || '-'} 
                subtitle="per run" 
              />
              <MetricCard 
                label="Total Runs" 
                value={data.summary.totalRuns.toLocaleString()} 
              />
              <MetricCard 
                label="Active Plays" 
                value={data.summary.actionsInProgress} 
                subtitle="in progress" 
              />
              <MetricCard 
                label="Deployed Plays" 
                value={data.summary.actionsLive} 
                subtitle="live" 
              />
            </div>
          )}

          {/* Hero Chart - Visibility */}
          <div className="bg-paper border border-border rounded-2xl p-6 m1-stagger visible" style={{ animationDelay: '180ms' }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="steep-heading text-[14px]">AI Visibility Trend</h2>
                <p className="text-[12px] text-slate-quiet">Brand visibility % over time against deployed strategy actions</p>
              </div>
            </div>
            <div className="h-[320px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data?.series} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis 
                    dataKey="date" 
                    tick={{fontSize: 11, fill: 'var(--muted-foreground)'}} 
                    tickFormatter={formatDate} 
                    axisLine={false} 
                    tickLine={false} 
                    minTickGap={30}
                  />
                  <YAxis 
                    tick={{fontSize: 11, fill: 'var(--muted-foreground)'}} 
                    axisLine={false} 
                    tickLine={false} 
                    domain={[0, 100]} 
                    tickFormatter={(val) => `${val}%`}
                  />
                  <RechartsTooltip content={<VisibilityTooltip events={data?.events || []} />} cursor={{fill: 'var(--muted)', opacity: 0.3}} />
                  <Line 
                    type="monotone" 
                    dataKey="visibilityPct" 
                    name="Visibility"
                    stroke="var(--foreground)" 
                    strokeWidth={2} 
                    dot={{r: 2, fill: 'var(--background)', stroke: 'var(--foreground)', strokeWidth: 1.5}}
                    activeDot={{r: 4, fill: 'var(--foreground)'}} 
                    connectNulls={false} 
                  />
                  {validEventDates.map((date) => (
                    <ReferenceLine 
                      key={date} 
                      x={date} 
                      stroke="var(--muted-foreground)" 
                      strokeDasharray="4 4" 
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Two column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 m1-stagger visible" style={{ animationDelay: '270ms' }}>
            
            <div className="space-y-6">
              {/* Citation Mix */}
              <div className="bg-paper border border-border rounded-2xl p-6">
                <div className="mb-4">
                  <h2 className="steep-heading text-[14px]">Citation Mix</h2>
                  <p className="text-[12px] text-slate-quiet">Provider-verified citations grouped by source role</p>
                </div>
                <div className="h-[260px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data?.series} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis 
                        dataKey="date" 
                        tick={{fontSize: 11, fill: 'var(--muted-foreground)'}} 
                        tickFormatter={formatDate} 
                        axisLine={false} 
                        tickLine={false} 
                        minTickGap={30}
                      />
                      <YAxis tick={{fontSize: 11, fill: 'var(--muted-foreground)'}} axisLine={false} tickLine={false} />
                      <RechartsTooltip content={<CitationTooltip />} cursor={{fill: 'var(--muted)', opacity: 0.3}} />
                      <Area type="monotone" dataKey="ownedCitations" name="Owned website" stackId="1" stroke={CITATION_COLORS.owned} fill={CITATION_COLORS.owned} connectNulls={false} />
                      <Area type="monotone" dataKey="competitorCitations" name="Competitors" stackId="1" stroke={CITATION_COLORS.competitor} fill={CITATION_COLORS.competitor} connectNulls={false} />
                      <Area type="monotone" dataKey="directoryCitations" name="Directories & Databases" stackId="1" stroke={CITATION_COLORS.directory} fill={CITATION_COLORS.directory} connectNulls={false} />
                      <Area type="monotone" dataKey="comparisonCitations" name="Reviews & Comparisons" stackId="1" stroke={CITATION_COLORS.comparison} fill={CITATION_COLORS.comparison} connectNulls={false} />
                      <Area type="monotone" dataKey="editorialCitations" name="Media & Articles" stackId="1" stroke={CITATION_COLORS.editorial} fill={CITATION_COLORS.editorial} connectNulls={false} />
                      <Area type="monotone" dataKey="institutionalCitations" name="Institutional" stackId="1" stroke={CITATION_COLORS.institutional} fill={CITATION_COLORS.institutional} connectNulls={false} />
                      <Area type="monotone" dataKey="ugcCitations" name="UGC" stackId="1" stroke={CITATION_COLORS.ugc} fill={CITATION_COLORS.ugc} connectNulls={false} />
                      <Area type="monotone" dataKey="otherCitations" name="Unresolved" stackId="1" stroke={CITATION_COLORS.other} fill={CITATION_COLORS.other} connectNulls={false} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Volume & Position Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Volume */}
                <div className="bg-paper border border-border rounded-2xl p-6">
                  <div className="mb-4">
                    <h2 className="steep-heading text-[14px]">Tracking Volume</h2>
                    <p className="text-[12px] text-slate-quiet">Simulations and citations</p>
                  </div>
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={data?.series} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis 
                          dataKey="date" 
                          tick={{fontSize: 11, fill: 'var(--muted-foreground)'}} 
                          tickFormatter={formatShortDate} 
                          axisLine={false} 
                          tickLine={false} 
                          minTickGap={20}
                        />
                        <YAxis tick={{fontSize: 11, fill: 'var(--muted-foreground)'}} axisLine={false} tickLine={false} />
                        <RechartsTooltip content={<VolumeTooltip />} cursor={{fill: 'var(--muted)', opacity: 0.2}} />
                        <Bar dataKey="retrievals" name="Retrievals" fill="var(--muted-foreground)" radius={[2, 2, 0, 0]} maxBarSize={40} />
                        <Line type="monotone" dataKey="runs" name="Runs" stroke="var(--foreground)" strokeWidth={2} dot={{r: 1.5, fill: 'var(--background)', stroke: 'var(--foreground)'}} connectNulls={false} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Brand Position */}
                <div className="bg-paper border border-border rounded-2xl p-6">
                  <div className="mb-4">
                    <h2 className="steep-heading text-[14px]">Avg Brand Position</h2>
                    <p className="text-[12px] text-slate-quiet">Position when cited (lower is better)</p>
                  </div>
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={data?.series} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis 
                          dataKey="date" 
                          tick={{fontSize: 11, fill: 'var(--muted-foreground)'}} 
                          tickFormatter={formatShortDate} 
                          axisLine={false} 
                          tickLine={false} 
                          minTickGap={20}
                        />
                        <YAxis 
                          tick={{fontSize: 11, fill: 'var(--muted-foreground)'}} 
                          axisLine={false} 
                          tickLine={false} 
                          reversed={true} 
                          domain={['dataMin - 1', 'dataMax + 1']}
                        />
                        <RechartsTooltip 
                          cursor={{fill: 'var(--muted)', opacity: 0.2}}
                          content={({active, payload, label}) => {
                            if (active && payload && payload.length && payload[0].value != null) {
                              return (
                                <div className="bg-popover border border-border rounded-lg p-3 min-w-[140px]">
                                  <div className="text-[11px] font-medium text-ash mb-2 uppercase tracking-wider">{formatDateLong(label)}</div>
                                  <div className="flex justify-between text-[12px]">
                                    <span className="text-slate-quiet">Avg Position</span>
                                    <span className="font-medium text-foreground tabular-nums">#{Number(payload[0].value).toFixed(1)}</span>
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Line type="monotone" dataKey="avgBrandPosition" name="Avg Position" stroke="var(--chart-competitor)" strokeWidth={2} dot={{r: 2, fill: 'var(--background)', stroke: 'var(--chart-competitor)', strokeWidth: 1.5}} connectNulls={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Events & Measurements */}
            <div className="space-y-6">
              
              {/* Strategy Milestones */}
              <div className="bg-paper border border-border rounded-2xl overflow-hidden">
                <div className="flex items-center gap-3 p-4 border-b border-border bg-fog">
                  <Target className="w-4 h-4 text-slate-quiet" />
                  <h2 className="steep-heading text-[13px]">Strategy Timeline</h2>
                </div>
                <div className="divide-y divide-border">
                  {(!data?.events || data.events.length === 0) && (
                    <div className="p-8 text-center flex flex-col items-center">
                      <p className="text-[13px] text-slate-quiet mb-4">
                        No strategy actions logged for this period.
                      </p>
                      <Link href={`/lab/strategy/${companyId}`} className="m1-btn m1-btn--outline text-[12px]">
                        Log an action
                      </Link>
                    </div>
                  )}
                  {data?.events.map((e, i) => (
                    <div key={i} className="p-4 flex gap-4 hover:bg-fog transition-colors group">
                      <div className="w-12 text-[11px] font-medium text-slate-quiet pt-0.5 tabular-nums">
                        {formatShortDate(e.date)}
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-foreground">{e.title}</div>
                        <div className="flex items-center gap-2 mt-2">
                           <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-mist text-ash uppercase tracking-wider">
                            {e.category.replace('_', ' ')}
                          </span>
                          <span className={cn(
                             "text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider",
                             e.status === 'live' ? "bg-[var(--positive-surface)] text-positive" : "bg-[var(--warning-surface)] text-warning"
                          )}>
                            {e.status.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Share of Voice log */}
              {data?.measurements && data.measurements.length > 0 && (
                <div className="bg-paper border border-border rounded-2xl overflow-hidden">
                  <div className="flex items-center gap-3 p-4 border-b border-border bg-fog">
                    <Calendar className="w-4 h-4 text-slate-quiet" />
                    <h2 className="steep-heading text-[13px]">Weekly Measurements</h2>
                  </div>
                  <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
                    {data.measurements.map((m, i) => (
                      <div key={i} className="p-4 text-[13px] hover:bg-fog transition-colors">
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-medium text-foreground">Week of {formatShortDate(m.weekOf)}</span>
                          {m.shareOfVoicePct != null && (
                            <span className="font-medium text-foreground tabular-nums bg-mist px-2 py-0.5 rounded-full">{m.shareOfVoicePct}% SOV</span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-y-2 mt-2 text-[12px]">
                          <div className="text-slate-quiet">Brand Mentions: <span className="text-foreground font-medium tabular-nums ml-1">{m.brandMentions}</span></div>
                          <div className="text-slate-quiet">Competitor Avg: <span className="text-foreground font-medium tabular-nums ml-1">{m.competitorMentionsAvg ?? '-'}</span></div>
                          <div className="text-slate-quiet">Consensus: <span className="text-foreground font-medium ml-1">{m.consensusAnswer != null ? (m.consensusAnswer ? 'Yes' : 'No') : '-'}</span></div>
                          <div className="truncate text-slate-quiet">Type: <span className="text-foreground font-medium capitalize ml-1">{m.topPageType ?? '-'}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Sub-components & Helpers

function MetricCard({ label, value, subtitle, delta }: { label: string; value: React.ReactNode; subtitle?: string; delta?: number | null }) {
  return (
    <div className="bg-fog border border-border rounded-2xl p-4 flex flex-col justify-center">
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

const VisibilityTooltip = ({ active, payload, label, events }: any) => {
  if (active && payload && payload.length) {
    const date = label;
    const visibility = payload[0].value;
    const dayEvents = events.filter((e: any) => e.date === date);

    return (
      <div className="bg-popover border border-border rounded-lg p-3 min-w-[200px]">
        <div className="text-[11px] font-medium text-ash mb-2 uppercase tracking-wider">{formatDateLong(date)}</div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] font-medium text-foreground">Visibility</span>
          <span className="text-[13px] font-medium text-foreground tabular-nums">{visibility != null ? `${visibility}%` : 'No data'}</span>
        </div>
        {dayEvents.length > 0 && (
          <div className="pt-3 border-t border-border space-y-2 mt-2">
            <div className="text-[10px] font-medium text-ash uppercase tracking-wider mb-2">Strategy Actions</div>
            {dayEvents.map((e: any, i: number) => (
              <div key={i} className="flex flex-col">
                <span className="text-[12px] font-medium text-foreground leading-tight mb-1">{e.title}</span>
                <span className="text-[11px] text-slate-quiet capitalize flex items-center gap-1.5">
                  <span className={cn("w-1.5 h-1.5 rounded-full", e.status === 'live' ? "bg-positive" : "bg-warning")} />
                  {e.category.replace('_', ' ')} • {e.status.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return null;
};

const CitationTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-popover border border-border rounded-lg p-3 min-w-[180px]">
        <div className="text-[11px] font-medium text-ash mb-3 uppercase tracking-wider">{formatDateLong(label)}</div>
        <div className="space-y-2">
          {payload.map((entry: any, index: number) => {
            if (!entry.value) return null; // hide zeros in tooltip for cleaner read
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

const VolumeTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-popover border border-border rounded-lg p-3 min-w-[160px]">
        <div className="text-[11px] font-medium text-ash mb-3 uppercase tracking-wider">{formatDateLong(label)}</div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-slate-quiet font-medium">Retrievals</span>
            <span className="font-medium text-foreground tabular-nums">{payload[0]?.payload.retrievals || 0}</span>
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-slate-quiet font-medium">Runs</span>
            <span className="font-medium text-foreground tabular-nums">{payload[0]?.payload.runs || 0}</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

// Date-only strings ("YYYY-MM-DD") are UTC calendar days; format them in UTC
// so users west of Greenwich do not see the previous day.
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
