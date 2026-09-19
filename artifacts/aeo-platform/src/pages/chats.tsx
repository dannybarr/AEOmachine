import { useState } from "react";
import { useListRuns } from "@workspace/api-client-react";
import { useModels, modelLabel } from "@/hooks/use-models";
import { Link } from "wouter";
import { MessageSquare, Bot } from "lucide-react";

import { useCompany } from "@/components/CompanyContext";

export default function Chats() {
  const { companyId } = useCompany();
  const models = useModels();
  const [model, setModel] = useState<string>("");
  const { data: runs, isLoading } = useListRuns({ companyId, model: model || undefined });

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto space-y-6 m1-stagger visible">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl steep-heading tracking-tight">All Chats</h1>
          <p className="text-[13px] text-slate-quiet mt-1">Recorded AI engine responses for your tracked prompts.</p>
        </div>
        
        <select 
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="h-9 px-3 text-[13px] font-medium bg-paper border border-border rounded-lg outline-none focus:border-foreground w-full sm:w-48"
        >
          <option value="">All models</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="m1-card overflow-hidden">
        <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto] gap-4 p-4 border-b border-border bg-fog text-[11px] font-medium text-ash uppercase tracking-wider">
          <div>Prompt & Answer Preview</div>
          <div className="w-32 text-right">Model</div>
          <div className="w-24 text-right">Citations</div>
          <div className="w-32 text-right">Date</div>
        </div>
        
        <div className="divide-y divide-border">
          {isLoading ? (
            <div className="p-8 text-center text-slate-quiet text-[13px]">Loading...</div>
          ) : runs?.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center mb-4">
                <MessageSquare className="w-5 h-5 text-slate-quiet" />
              </div>
              <p className="text-[14px] font-medium text-foreground">No chats recorded yet</p>
              <p className="text-[13px] text-slate-quiet mt-1">Run a simulation from the Prompts page to populate this list.</p>
            </div>
          ) : (
            runs?.map(run => (
              <Link key={run.id} href={`/chats/${run.id}`} className="block p-4 hover:bg-fog transition-colors group">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[1fr_auto_auto_auto] gap-3 md:gap-4 items-start">
                  <div className="space-y-1.5 md:pr-8">
                    <div className="text-[14px] font-medium text-foreground group-hover:underline line-clamp-1">
                      {run.promptText}
                    </div>
                    {run.answerPreview && (
                      <div className="text-[13px] text-slate-quiet line-clamp-2 leading-relaxed">
                        {run.answerPreview}
                      </div>
                    )}
                  </div>
                  
                  <div className="md:w-32 text-right flex justify-end">
                    <div className="flex items-center gap-1.5 text-[12px] font-medium bg-paper border border-border px-2 py-0.5 rounded-full">
                      <Bot className="w-3 h-3 text-slate-quiet" />
                      <span>{modelLabel(models, run.model)}</span>
                    </div>
                  </div>
                  
                  <div className="md:w-24 text-left md:text-right text-[12px] md:text-[13px] font-medium tabular-nums text-slate-quiet md:text-foreground pt-1">
                    {run.citationCount} <span className="md:hidden">citations</span>
                  </div>
                  
                  <div className="md:w-32 text-right text-[12px] text-slate-quiet pt-1">
                    {new Date(run.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
