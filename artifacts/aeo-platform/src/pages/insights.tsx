import { useListInsights, getListInsightsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Zap, AlertTriangle, Info, CheckCircle2, ArrowRight, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

import { useCompany } from "@/components/CompanyContext";

export default function Insights() {
  const { companyId } = useCompany();
  const { data: insights, isLoading } = useListInsights({ companyId, days: 30 }, { query: { queryKey: getListInsightsQueryKey({ companyId, days: 30 }), refetchInterval: 15000 } });

  return (
    <div className="p-4 sm:p-8 max-w-[900px] mx-auto space-y-6 sm:space-y-8 m1-stagger visible">
      <header>
        <h1 className="text-2xl steep-heading tracking-tight">Insights</h1>
        <p className="text-[13px] text-slate-quiet mt-1">
          Evidence-led findings from tracked simulations. Actions are withheld when the sample cannot support one.
        </p>
      </header>

      <div className="space-y-4">
        {isLoading ? (
          <div className="p-12 text-center text-[13px] text-slate-quiet">Loading insights...</div>
        ) : insights?.length === 0 ? (
          <div className="m1-card p-6 sm:p-12 text-center flex flex-col items-center justify-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center">
              <Zap className="w-5 h-5 text-slate-quiet" />
            </div>
            <div className="space-y-1">
              <p className="text-[14px] font-medium text-foreground">No insights available yet</p>
              <p className="text-[13px] text-slate-quiet max-w-sm mx-auto">
                Run more simulations and track additional prompts to generate meaningful insights about your brand's AI presence.
              </p>
            </div>
            <Link href="/prompts" className="m1-btn mt-2">Go to Prompts</Link>
          </div>
        ) : (
          insights?.map((insight) => (
            <div key={insight.id} className="m1-card p-4 sm:p-5 group flex flex-col sm:flex-row gap-4 sm:gap-5 items-start sm:items-center">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center shrink-0 border",
                insight.severity === 'warning' ? "bg-[var(--negative-surface)] border-border text-negative" :
                insight.severity === 'good' ? "bg-[var(--positive-surface)] border-border text-positive" :
                "bg-mist border-border text-foreground"
              )}>
                {insight.severity === 'warning' ? <AlertTriangle className="w-5 h-5" /> :
                 insight.severity === 'good' ? <CheckCircle2 className="w-5 h-5" /> :
                 <Info className="w-5 h-5" />}
              </div>
              
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14px] font-medium text-foreground">{insight.title}</h3>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-ash bg-mist px-2 py-0.5 rounded-full">
                    {insight.kind.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-[13px] text-foreground leading-relaxed">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-ash mr-1.5">Observed</span>
                  {insight.observation}
                </p>
                {insight.action && (
                  <p className="text-[13px] text-foreground leading-relaxed">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-ash mr-1.5">Test next</span>
                    {insight.action}
                  </p>
                )}
                {insight.whyItMayWork && (
                  <p className="text-[12px] text-slate-quiet leading-relaxed">
                    <span className="font-medium text-foreground">Why it may work:</span>{" "}
                    {insight.whyItMayWork}
                  </p>
                )}
                <div className="flex items-start gap-1.5 text-[11px] text-slate-quiet leading-relaxed">
                  <FlaskConical className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{insight.caveat}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-ash">
                  <span className="px-1.5 py-0.5 rounded-full bg-mist border border-border">
                    {insight.confidence} confidence
                  </span>
                  <span>{insight.evidenceLabel}</span>
                </div>
              </div>

              {insight.metricLabel && insight.metricValue && (
                <div className="shrink-0 flex flex-col items-start sm:items-end text-left sm:text-right sm:px-4">
                  <span className="text-[11px] font-medium text-ash uppercase tracking-wide">
                    {insight.metricLabel}
                  </span>
                  <span className="text-[16px] font-medium text-foreground tabular-nums">
                    {insight.metricValue}
                  </span>
                </div>
              )}

              {insight.href && (
                <Link href={insight.href} className="shrink-0 p-2 text-slate-quiet hover:text-foreground transition-colors group-hover:bg-mist rounded-full">
                  <ArrowRight className="w-5 h-5" />
                </Link>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
