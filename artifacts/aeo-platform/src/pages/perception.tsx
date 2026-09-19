import { useGetPerception, getGetPerceptionQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { MessageSquareQuote, Bot, Target } from "lucide-react";
import { cn } from "@/lib/utils";

import { useCompany } from "@/components/CompanyContext";
import { useModels, modelLabel } from "@/hooks/use-models";

export default function Perception() {
  const { companyId } = useCompany();
  const models = useModels();
  const { data: perception, isLoading } = useGetPerception({ companyId, days: 30 }, { query: { queryKey: getGetPerceptionQueryKey({ companyId, days: 30 }), refetchInterval: 15000 } });

  return (
    <div className="p-4 sm:p-8 max-w-[1000px] mx-auto space-y-6 sm:space-y-8 m1-stagger visible">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl steep-heading tracking-tight flex items-center gap-2">
            Perception <span className="text-[11px] font-medium font-sans bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full uppercase tracking-wider translate-y-[-2px]">Beta</span>
          </h1>
          <p className="text-[13px] text-slate-quiet mt-1">
            How different AI engines literally talk about your brand in their generated responses.
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="p-12 text-center text-[13px] text-slate-quiet">Loading perception data...</div>
      ) : perception?.length === 0 ? (
        <div className="m1-card p-6 sm:p-12 text-center flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center">
            <Target className="w-5 h-5 text-slate-quiet" />
          </div>
          <div className="space-y-1">
            <p className="text-[14px] font-medium text-foreground">No perception data available</p>
            <p className="text-[13px] text-slate-quiet max-w-sm mx-auto">
              We haven't detected enough mentions of your brand in AI responses to generate perception summaries.
            </p>
          </div>
          <Link href="/prompts" className="m1-btn mt-2">Run more simulations</Link>
        </div>
      ) : (
        <div className="space-y-8 sm:space-y-12">
          {perception?.map((p) => (
            <section key={p.model} className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
                <h2 className="text-[15px] steep-heading flex items-center gap-2">
                  <Bot className="w-4 h-4 text-slate-quiet" /> {modelLabel(models, p.model)}
                </h2>
                <div className="flex items-center gap-4 text-[12px]">
                  <div className="text-slate-quiet">
                    <span className="font-medium text-foreground tabular-nums">{p.mentionCount}</span> mentions
                  </div>
                  <div className="text-slate-quiet">
                    <span className="font-medium text-foreground tabular-nums">{p.mentionRatePct}%</span> mention rate
                  </div>
                </div>
              </div>

              {p.excerpts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {p.excerpts.map((excerpt, idx) => (
                  <div key={`${excerpt.runId}-${idx}`} className="m1-card p-4 sm:p-5 space-y-4 flex flex-col">
                      <div className="flex-1">
                        <MessageSquareQuote className="w-6 h-6 text-border mb-3" />
                        <blockquote className="text-[13px] leading-relaxed text-foreground italic">
                          "{excerpt.excerpt}"
                        </blockquote>
                      </div>
                      <div className="pt-4 border-t border-border mt-auto flex items-center justify-between">
                        <Link href={`/prompts/${excerpt.promptId}`} className="text-[11px] font-medium text-slate-quiet hover:text-foreground truncate max-w-[70%]">
                          {excerpt.promptText}
                        </Link>
                        <Link href={`/chats/${excerpt.runId}`} className="text-[11px] font-medium text-foreground bg-mist px-2 py-1 rounded-full hover:bg-fog transition-colors">
                          View Chat
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[13px] text-slate-quiet italic py-4">No specific excerpts captured for this model yet.</div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
