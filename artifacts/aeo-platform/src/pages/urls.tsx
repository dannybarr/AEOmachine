import { useListUrls, getListUrlsQueryKey } from "@workspace/api-client-react";
import { Link2, ExternalLink } from "lucide-react";

import { useCompany } from "@/components/CompanyContext";

export default function Urls() {
  const { companyId } = useCompany();
  const { data: urls, isLoading } = useListUrls({ companyId, days: 30, limit: 100 }, { query: { queryKey: getListUrlsQueryKey({ companyId, days: 30, limit: 100 }), refetchInterval: 15000 } });

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto space-y-6 sm:space-y-8 m1-stagger visible">
      <header>
        <h1 className="text-2xl steep-heading tracking-tight">Cited URLs</h1>
        <p className="text-[13px] text-slate-quiet mt-1">
          The exact deep links AI engines are using as reference material.
        </p>
      </header>

      <div className="m1-card overflow-hidden">
        <div className="hidden md:grid grid-cols-[minmax(0,1fr)_auto_auto] gap-6 p-4 border-b border-border bg-fog text-[11px] font-medium text-ash uppercase tracking-wider">
          <div>URL & Domain</div>
          <div className="w-24 text-right">Type</div>
          <div className="w-24 text-right">Retrievals</div>
        </div>
        
        <div className="divide-y divide-border">
          {isLoading ? (
            <div className="p-8 text-center text-slate-quiet text-[13px]">Loading URLs...</div>
          ) : urls?.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <Link2 className="w-8 h-8 text-smoke mb-3" />
              <p className="text-[13px] text-foreground font-medium">No cited URLs found</p>
              <p className="text-[12px] text-slate-quiet mt-1">Run simulations to gather exact page citations.</p>
            </div>
          ) : (
            urls?.map(u => (
              <div key={u.id} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_auto_auto] gap-3 md:gap-6 p-4 hover:bg-fog transition-colors items-center group">
                <div className="overflow-hidden">
                  <a href={u.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-[13px] text-foreground hover:underline group-hover:text-foreground transition-colors break-all">
                    <span className="line-clamp-1 flex-1">{u.url}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                  </a>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <img src={`https://www.google.com/s2/favicons?domain=${u.domain}&sz=16`} className="w-3 h-3 rounded-lg" alt="" />
                    <span className="text-[11px] text-slate-quiet">{u.domain}</span>
                  </div>
                </div>
                
                <div className="md:w-24 text-right">
                  <span className="text-[10px] font-medium text-ash uppercase tracking-widest bg-paper border border-border px-2 py-0.5 rounded-full">
                    {u.domainType}
                  </span>
                </div>
                
                <div className="md:w-24 text-left md:text-right text-[12px] md:text-[14px] font-medium tabular-nums text-slate-quiet md:text-foreground">
                  {u.retrievals.toLocaleString()} <span className="md:hidden">retrievals</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
