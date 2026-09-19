import { useState } from "react";
import { useListDomains, useGetDomainTypeDistribution, getListDomainsQueryKey, getGetDomainTypeDistributionQueryKey, ListDomainsView } from "@workspace/api-client-react";
import { Globe, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

import { useCompany } from "@/components/CompanyContext";

export default function Domains() {
  const { companyId } = useCompany();
  const [view, setView] = useState<ListDomainsView>("top");
  
  const { data: domains, isLoading } = useListDomains({ companyId, view, days: 30, limit: 50 }, { query: { queryKey: getListDomainsQueryKey({ companyId, view, days: 30, limit: 50 }), refetchInterval: 15000 } });
  const { data: distribution } = useGetDomainTypeDistribution({ companyId, days: 30 }, { query: { queryKey: getGetDomainTypeDistributionQueryKey({ companyId, days: 30 }), refetchInterval: 15000 } });

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto space-y-6 sm:space-y-8 m1-stagger visible">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl steep-heading tracking-tight">Source Domains</h1>
          <p className="text-[13px] text-slate-quiet mt-1">
            Explore every website cited by AI models across all your tracked prompts.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 lg:gap-8 items-start">
        <div className="space-y-4">
          <div className="flex items-center gap-0 sm:gap-2 border-b border-border overflow-x-auto">
            {(['top', 'new', 'trending', 'losing'] as ListDomainsView[]).map((v) => (
              <button 
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "pb-2.5 px-2 border-b-2 text-[13px] font-medium capitalize tracking-wide transition-colors outline-none",
                  view === v ? "border-foreground text-foreground" : "border-transparent text-slate-quiet hover:text-foreground"
                )}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="m1-card overflow-hidden">
            <div className="hidden md:grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-4 p-4 border-b border-border bg-fog text-[11px] font-medium text-ash uppercase tracking-wider">
              <div>Domain</div>
              <div className="w-24 text-right">Type</div>
              <div className="w-24 text-right">Retrievals</div>
              <div className="w-24 text-right">Trend</div>
            </div>
            
            <div className="divide-y divide-border">
              {isLoading ? (
                <div className="p-8 text-center text-slate-quiet text-[13px]">Loading domains...</div>
              ) : domains?.length === 0 ? (
                <div className="p-12 text-center flex flex-col items-center">
                  <Globe className="w-8 h-8 text-smoke mb-3" />
                  <p className="text-[13px] text-foreground font-medium">No domains found</p>
                  <p className="text-[12px] text-slate-quiet mt-1">Run simulations to gather source citations.</p>
                </div>
              ) : (
                domains?.map(d => (
                  <div key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 md:gap-4 p-4 hover:bg-fog transition-colors items-center">
                    <div className="flex items-center gap-3 min-w-0">
                      <img src={`https://www.google.com/s2/favicons?domain=${d.domain}&sz=32`} className="w-5 h-5 rounded-lg bg-mist" alt="" />
                      <span className="text-[14px] font-medium text-foreground truncate">{d.domain}</span>
                      {d.isOwned && <span className="bg-primary text-primary-foreground text-[9px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider">Owned</span>}
                    </div>
                    <div className="md:w-24 text-right">
                      <span className="text-[11px] font-medium text-ash uppercase tracking-wider px-2 py-1 rounded-full bg-paper border border-border">
                        {d.domainType}
                      </span>
                    </div>
                    <div className="md:w-24 text-left md:text-right text-[12px] md:text-[14px] font-medium tabular-nums text-slate-quiet md:text-foreground">
                      {d.retrievals.toLocaleString()} <span className="md:hidden">retrievals</span>
                    </div>
                    <div className="md:w-24 text-right flex justify-end">
                      <DeltaBadge value={d.deltaPct} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6 lg:sticky lg:top-8">
          <div className="m1-card p-6">
            <h3 className="text-[14px] font-medium text-foreground mb-4">Domain Types</h3>
            <div className="space-y-4">
              {distribution?.types.map(type => (
                <div key={type.domainType} className="space-y-1.5">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-medium text-foreground capitalize">{type.domainType}</span>
                    <span className="font-medium text-foreground tabular-nums">{type.sharePct}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-mist rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-foreground" style={{ width: `${type.sharePct}%` }} />
                  </div>
                </div>
              ))}
              {!distribution?.types.length && (
                <div className="text-[12px] text-slate-quiet text-center">No type data available.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeltaBadge({ value }: { value: number }) {
  if (!value) return <span className="text-slate-quiet text-[12px]">—</span>;
  const isPos = value > 0;
  return (
    <span className={cn(
      "text-[12px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 w-fit",
      isPos ? "text-positive bg-[var(--positive-surface)] border border-border" : "text-negative bg-[var(--negative-surface)] border border-border"
    )}>
      {isPos ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(value)}%
    </span>
  );
}
