import { useParams, Link } from "wouter";
import { 
  useGetSiteTest, 
  useRunSiteAudit,
  getGetSiteTestQueryKey,
  getListSiteTestsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play, ExternalLink, Activity, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useCompany } from "@/components/CompanyContext";

export default function LabDetail() {
  const { id } = useParams<{ id: string }>();
  const siteId = parseInt(id, 10);
  const { companyId } = useCompany();
  
  const { data: site, isLoading: loadingSite } = useGetSiteTest(siteId, { companyId }, { query: { enabled: !!siteId, queryKey: getGetSiteTestQueryKey(siteId, { companyId }) } });
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const audit = useRunSiteAudit({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSiteTestQueryKey(siteId, { companyId }) });
        queryClient.invalidateQueries({ queryKey: getListSiteTestsQueryKey({ companyId }) });
        toast({ title: "Audit complete!" });
      },
      onError: (err: any) => {
        // Simple heuristic for 502/unreachable
        const msg = err?.response?.status === 502 ? "Site unreachable (502)" : "Audit failed";
        toast({ title: msg, variant: "destructive" });
      }
    }
  });

  const onRunAudit = () => {
    if (audit.isPending) return;
    audit.mutate({ id: siteId, params: { companyId } });
  };

  if (loadingSite) return <div className="p-4 sm:p-8 text-center">Loading...</div>;
  if (!site) return <div className="p-4 sm:p-8 text-center text-negative">Site not found</div>;

  return (
    <div className="p-4 sm:p-8 max-w-[1000px] mx-auto space-y-6 sm:space-y-8 m1-stagger visible">
      
      {/* Header */}
      <div className="space-y-4">
        <Link href="/lab" className="inline-flex items-center text-[12px] font-medium text-slate-quiet hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to lab
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl steep-heading tracking-tight leading-snug">
              {site.name}
            </h1>
            <a href={site.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-slate-quiet hover:underline flex items-center gap-1 mt-1">
              {site.url} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          
          <button 
            onClick={onRunAudit}
            disabled={audit.isPending}
            className="m1-btn shrink-0"
          >
            {audit.isPending ? (
              <><Activity className="w-4 h-4 animate-spin" /> Running audit...</>
            ) : (
              <><Play className="w-4 h-4" /> Run audit</>
            )}
          </button>
        </div>
      </div>

      {/* Snapshot History */}
      <div className="space-y-4">
        <h2 className="text-lg steep-heading">Audit History</h2>
        
        <div className="space-y-6">
          {site.snapshots.length === 0 ? (
            <div className="bg-paper border border-border rounded-2xl p-12 text-center flex flex-col items-center">
              <Activity className="w-8 h-8 text-smoke mb-3" />
              <p className="text-[14px] font-medium text-foreground">No audits run yet</p>
              <p className="text-[13px] text-slate-quiet mt-1">Run an audit to check AEO compliance.</p>
            </div>
          ) : (
            site.snapshots.map((snap) => (
              <div key={snap.id} className="bg-paper border border-border rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-border bg-fog">
                  <div className="flex items-center gap-4">
                    <div className="text-[13px] font-medium text-foreground">
                      {new Date(snap.createdAt).toLocaleString(undefined, { 
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' 
                      })}
                    </div>
                    {snap.httpStatus !== 200 && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--negative-surface)] text-negative uppercase tracking-wide">
                        HTTP {snap.httpStatus || 'Error'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-ash uppercase tracking-wider">Score</span>
                    <span className={cn(
                      "text-[16px] font-medium tabular-nums",
                      snap.score >= 80 ? "text-positive" : snap.score >= 50 ? "text-warning" : "text-negative"
                    )}>
                      {snap.score}/100
                    </span>
                  </div>
                </div>
                
                <div className="divide-y divide-border">
                  {snap.checks.map((check, idx) => (
                    <div key={idx} className="p-4 flex gap-4 items-start hover:bg-mist transition-colors">
                      <div className="shrink-0 mt-0.5">
                        {check.passed ? (
                          <CheckCircle className="w-4 h-4 text-positive" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-warning" />
                        )}
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-foreground">{check.label}</div>
                        <div className="text-[12px] text-slate-quiet mt-1 leading-relaxed">
                          {check.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
