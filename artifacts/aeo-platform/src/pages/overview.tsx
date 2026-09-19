import { useState } from "react";
import { 
  useGetOverviewSummary, 
  useGetOverviewTimeseries,
  useListDomains,
  useGetDomainTypeDistribution,
  useListRuns,
  ListDomainsView,
  getGetOverviewSummaryQueryKey,
  getGetOverviewTimeseriesQueryKey,
  getListDomainsQueryKey,
  getGetDomainTypeDistributionQueryKey,
  getListRunsQueryKey,
  useListCompanies
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { TrendingUp, TrendingDown, ExternalLink, MessageSquare, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompany } from "@/components/CompanyContext";
import { useModels, modelLabel } from "@/hooks/use-models";
import { MethodologyPanel } from "@/components/MethodologyPanel";

export default function Overview() {
  const [domainView, setDomainView] = useState<ListDomainsView>("top");
  const { companyId } = useCompany();
  const models = useModels();
  const { data: companies } = useListCompanies({ days: 30 });
  const companyName = companies?.find(c => c.id === companyId)?.name || "your brand";
  
  const { data: summary } = useGetOverviewSummary({ companyId, days: 30 }, { query: { refetchInterval: 15000, queryKey: getGetOverviewSummaryQueryKey({ companyId, days: 30 }) } });
  const { data: timeseries } = useGetOverviewTimeseries({ companyId, days: 30 }, { query: { refetchInterval: 15000, queryKey: getGetOverviewTimeseriesQueryKey({ companyId, days: 30 }) } });
  const { data: domains } = useListDomains({ companyId, view: domainView, days: 30, limit: 10 }, { query: { refetchInterval: 15000, queryKey: getListDomainsQueryKey({ companyId, view: domainView, days: 30, limit: 10 }) } });
  const { data: distribution } = useGetDomainTypeDistribution({ companyId, days: 30 }, { query: { refetchInterval: 15000, queryKey: getGetDomainTypeDistributionQueryKey({ companyId, days: 30 }) } });
  const { data: chats } = useListRuns({ companyId, limit: 5 }, { query: { refetchInterval: 15000, queryKey: getListRunsQueryKey({ companyId, limit: 5 }) } });

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto space-y-8 sm:space-y-10 m1-stagger visible">
      
      {/* Top Strip */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[13px] text-slate-quiet font-medium">
          Showing 30 days data for {companyName}
          <MethodologyPanel companyId={companyId} days={30} />
        </div>
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          {timeseries && timeseries.length > 1 && (
            <div className="h-8 w-24 flex items-end">
              <Sparkline data={timeseries.map(t => t.visibilityPct)} />
            </div>
          )}
          <div className="grid grid-cols-2 sm:flex items-center gap-3 sm:gap-4 text-[13px] font-medium">
            <span className="text-foreground">{summary?.totalPrompts || 0}</span>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 bg-primary rounded-lg flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-background rounded-full" />
              </div>
              <span className="text-foreground">{summary?.brandName || "Brand"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-foreground">{summary?.visibilityPct ?? 0}%</span>
              <DeltaBadge value={summary?.visibilityDelta ?? 0} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-foreground">{summary?.mentionRatePct ?? 0}%</span>
              <DeltaBadge value={summary?.mentionRateDelta ?? 0} />
            </div>
          </div>
        </div>
      </div>

      {/* Source Distribution Section */}
      <section className="space-y-6">
        <div>
          <h2 className="steep-heading text-lg mb-1">Source distribution</h2>
          <p className="text-[13px] text-slate-quiet">Discover which websites and source types contribute most to AI answers.</p>
        </div>

        <div className="flex gap-8 border-b border-border">
          <button className="pb-2.5 border-b-2 border-foreground text-[13px] font-medium text-foreground rounded-full">Domains</button>
          <button className="pb-2.5 border-b-2 border-transparent text-[13px] font-medium text-slate-quiet hover:text-foreground rounded-full">URLs</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6 lg:gap-12">
          {/* Domains Table */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 sm:gap-4 overflow-x-auto">
                {(['top', 'new', 'trending', 'losing'] as ListDomainsView[]).map((view) => (
                  <button 
                    key={view}
                    onClick={() => setDomainView(view)}
                    className={cn(
                      "text-[12px] font-medium capitalize tracking-wide rounded-full",
                      domainView === view ? "text-foreground" : "text-slate-quiet hover:text-foreground"
                    )}
                  >
                    {view}
                  </button>
                ))}
              </div>
              <span className="text-[11px] font-medium text-ash uppercase tracking-wider">Retrievals</span>
            </div>

            <div className="space-y-1">
              {domains?.map((d) => (
                  <div key={d.id} className="group flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-mist transition-colors">
                   <div className="flex items-center gap-2.5 min-w-0">
                    <img src={`https://www.google.com/s2/favicons?domain=${d.domain}&sz=32`} className="w-4 h-4 rounded-lg bg-mist" alt="" />
                    <span className="text-[13px] font-medium text-foreground truncate">{d.domain}</span>
                    {d.isOwned && <span className="bg-primary text-primary-foreground text-[9px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider">Owned</span>}
                  </div>
                  <span className="text-[13px] font-medium text-foreground tabular-nums">{d.retrievals.toLocaleString()}</span>
                </div>
              ))}
              {!domains?.length && (
                <div className="p-4 text-center text-[13px] text-slate-quiet bg-fog rounded-lg border border-border">
                  No domains found for this period.
                </div>
              )}
            </div>
          </div>

          {/* Domain Types */}
          <div className="bg-fog rounded-2xl p-4 sm:p-6 border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-6 sm:mb-8">
              <h3 className="text-[13px] font-medium text-foreground">Domain types</h3>
              <div className="text-[12px] text-slate-quiet flex items-center gap-1.5">
                Total retrievals: <span className="font-medium text-foreground">{distribution?.totalRetrievals?.toLocaleString() ?? 0}</span>
              </div>
            </div>

            <div className="space-y-3.5">
              {distribution?.types.map((type) => (
                <div key={type.domainType} className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getDomainColor(type.domainType) }} />
                  <span className="text-[13px] font-medium text-foreground capitalize flex-1">{type.domainType}</span>
                  <span className="text-[13px] text-slate-quiet tabular-nums">{type.sharePct}%</span>
                </div>
              ))}
            </div>
            
            <div className="mt-8 pt-4 border-t border-border">
              <Link href="/domains" className="text-[12px] font-medium text-foreground flex items-center gap-1 hover:underline">
                All domains <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* All Chats Section */}
      <section className="space-y-6 pt-8 border-t border-border m1-stagger visible" style={{ animationDelay: '90ms' }}>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="steep-heading text-lg mb-1">Recent chats</h2>
            <p className="text-[13px] text-slate-quiet">All chats for your tracked prompts.</p>
          </div>
          <Link href="/chats" className="m1-btn m1-btn--outline">View all chats</Link>
        </div>

        <div className="bg-paper border border-border rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto] gap-4 p-3 border-b border-border bg-fog text-[11px] font-medium text-ash uppercase tracking-wider">
            <div>Prompt</div>
            <div className="w-24 text-right">Model</div>
            <div className="w-24 text-right">Citations</div>
            <div className="w-32 text-right">Date</div>
          </div>
          <div className="divide-y divide-border">
            {chats?.map((chat) => (
              <Link key={chat.id} href={`/chats/${chat.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[1fr_auto_auto_auto] gap-2 md:gap-4 p-3 hover:bg-mist transition-colors items-center group">
                <div className="text-[13px] font-medium text-foreground truncate group-hover:underline">{chat.promptText}</div>
                <div className="md:w-24 text-right text-[12px] text-slate-quiet">{modelLabel(models, chat.model)}</div>
                <div className="md:w-24 text-left md:text-right text-[12px] md:text-[13px] font-medium text-slate-quiet md:text-foreground tabular-nums">{chat.citationCount} <span className="md:hidden">citations</span></div>
                <div className="md:w-32 text-right text-[12px] text-slate-quiet">
                  {new Date(chat.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </div>
              </Link>
            ))}
            {!chats?.length && (
              <div className="p-8 text-center text-slate-quiet text-[13px]">
                No chats recorded yet. Run a prompt to see data here.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function DeltaBadge({ value }: { value: number }) {
  if (!value) return <span className="text-slate-quiet text-[12px] ml-1">0%</span>;
  const isPos = value > 0;
  return (
    <span className={cn(
      "text-[11px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ml-1",
      isPos ? "text-positive bg-[var(--positive-surface)]" : "text-negative bg-[var(--negative-surface)]"
    )}>
      {isPos ? "+" : ""}{value}%
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

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 100;
  const height = 32;
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="100%" height="100%" viewBox={`0 -2 100 36`} preserveAspectRatio="none" className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke="var(--foreground)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
