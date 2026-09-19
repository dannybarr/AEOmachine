import { useState, useEffect, useRef } from "react";
import { useFormDraft } from "@/hooks/use-form-draft";
import {
  useListPrompts,
  useCreatePrompt,
  useUpdatePrompt,
  useDeletePrompt,
  getListPromptsQueryKey,
  useSimulateAllPrompts,
  useListTrackingJobs,
  getListTrackingJobsQueryKey,
  useListCompanies,
  useUpdateCompany,
  getListCompaniesQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Plus, Search, MoreHorizontal, MessageSquare, Play, Trash, Pencil, Loader2, CalendarClock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useCompany } from "@/components/CompanyContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

export default function Prompts() {
  const [search, setSearch] = useState("");
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: prompts, isLoading } = useListPrompts({ companyId, search: search || undefined }, { query: { queryKey: getListPromptsQueryKey({ companyId, search: search || undefined }) } });
  const { data: companies } = useListCompanies({ days: 30 }, { query: { queryKey: getListCompaniesQueryKey({ days: 30 }) } });
  const company = companies?.find(c => c.id === companyId);
  const { data: jobs } = useListTrackingJobs(
    { companyId, limit: 1 },
    {
      query: {
        queryKey: getListTrackingJobsQueryKey({ companyId, limit: 1 }),
        // Poll while a batch is running so the button shows live progress.
        refetchInterval: (query) =>
          query.state.data?.[0]?.status === "running" ? 3000 : false,
      },
    },
  );
  const lastJob = jobs?.[0];
  const batchRunning = lastJob?.status === "running";

  // When a running batch finishes, refresh everything and report the result.
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevStatus.current === "running" && lastJob && lastJob.status !== "running") {
      toast({
        title: lastJob.status === "completed" ? "Tracking run complete" : "Tracking run failed",
        description: `${lastJob.succeeded} of ${lastJob.totalSimulations} simulations succeeded${lastJob.failed ? `, ${lastJob.failed} failed` : ""}.`,
        variant: lastJob.status === "completed" ? undefined : "destructive",
      });
      void queryClient.invalidateQueries();
    }
    prevStatus.current = lastJob?.status;
  }, [lastJob, queryClient, toast]);

  const runAll = useSimulateAllPrompts({
    mutation: {
      onSuccess: (job) => {
        toast({
          title: "Tracking run started",
          description: `Running ${job.totalSimulations} simulations across your active prompts.`,
        });
        void queryClient.invalidateQueries({ queryKey: getListTrackingJobsQueryKey({ companyId, limit: 1 }) });
      },
      onError: (err: unknown) => {
        const message =
          err && typeof err === "object" && "error" in err
            ? String((err as { error: unknown }).error)
            : "Tracking run failed to start.";
        toast({ title: "Tracking run failed", description: message, variant: "destructive" });
      },
    },
  });

  const updateCompany = useUpdateCompany({
    mutation: {
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey({ days: 30 }) }),
    },
  });

  const activeCount = prompts?.filter(p => p.active).length ?? 0;

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto space-y-6 m1-stagger visible">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl steep-heading tracking-tight">All Prompts</h1>
          <p className="text-[13px] text-slate-quiet mt-1">Manage and test your tracked prompts across AI models.</p>
        </div>
        <div className="grid grid-cols-2 sm:flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => runAll.mutate({ data: { companyId } })}
            disabled={runAll.isPending || batchRunning || activeCount === 0}
            className="h-9 px-4 rounded-full border border-border bg-paper text-[13px] font-medium text-foreground hover:bg-mist transition-colors inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {runAll.isPending || batchRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {batchRunning
              ? `Running ${lastJob.succeeded + lastJob.failed}/${lastJob.totalSimulations}…`
              : runAll.isPending
                ? "Starting…"
                : "Run all"}
          </button>
          <CreatePromptDialog />
        </div>
      </div>

      <div className="bg-paper border border-border rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CalendarClock className="w-4 h-4 text-slate-quiet" />
          <div>
            <div className="text-[13px] font-medium text-foreground">Daily auto-tracking</div>
            <div className="text-[12px] text-slate-quiet">
              Automatically run every active prompt once per day to build the progress timeline.
              {lastJob && (
                <span>
                  {" "}Last run {lastJob.runDate} — {lastJob.succeeded}/{lastJob.totalSimulations} succeeded
                  {lastJob.trigger === "scheduled" ? " (scheduled)" : ""}.
                </span>
              )}
            </div>
          </div>
        </div>
        <Switch
          checked={company?.autoTrackDaily ?? false}
          disabled={!company || updateCompany.isPending}
          onCheckedChange={(checked) => {
            if (!company) return;
            updateCompany.mutate({
              id: company.id,
              data: {
                name: company.name,
                domain: company.domain,
                industry: company.industry,
                autoTrackDaily: checked,
              },
            });
          }}
        />
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-quiet" />
          <input 
            type="text"
            placeholder="Search prompts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-paper text-[13px] placeholder:text-smoke outline-none focus:border-foreground focus:ring-1 focus:ring-foreground transition-all"
          />
        </div>
      </div>

      <div className="bg-paper border border-border rounded-2xl overflow-hidden">
        <div className="hidden md:grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-6 p-4 border-b border-border bg-fog text-[11px] font-medium text-ash uppercase tracking-wider">
          <div>Prompt Details</div>
          <div className="w-24 text-right">Topic</div>
          <div className="w-24 text-right">Runs</div>
          <div className="w-24 text-right">Visibility</div>
          <div className="w-10"></div>
        </div>
        
        <div className="divide-y divide-border">
          {isLoading ? (
            <div className="p-8 text-center text-slate-quiet text-[13px]">Loading...</div>
          ) : prompts?.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center mb-4">
                <MessageSquare className="w-5 h-5 text-slate-quiet" />
              </div>
              <p className="text-[14px] font-medium text-foreground">No prompts found</p>
              <p className="text-[13px] text-slate-quiet mt-1 mb-6">Create your first test prompt to start gathering insights.</p>
              <CreatePromptDialog />
            </div>
          ) : (
            prompts?.map(prompt => (
              <div key={prompt.id} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-3 md:gap-6 p-4 hover:bg-mist transition-colors items-center group">
                <div className="min-w-0">
                  <Link href={`/prompts/${prompt.id}`} className="text-[14px] font-medium text-foreground hover:underline line-clamp-2 leading-relaxed">
                    {prompt.text}
                  </Link>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {prompt.moneyTopicName && (
                      <span className="text-[10px] font-medium tracking-wide uppercase px-2 py-0.5 rounded-full bg-[var(--warning-surface)] text-warning" title="Linked to a Site Lab money topic">
                        ◆ {prompt.moneyTopicName}
                      </span>
                    )}
                    {prompt.tags?.map(tag => (
                      <span key={tag} className="text-[10px] font-medium tracking-wide uppercase px-2 py-0.5 rounded-full bg-mist text-ash">
                        {tag}
                      </span>
                    ))}
                    <span className="md:hidden text-[11px] text-slate-quiet tabular-nums">
                      {prompt.runCount} {prompt.runCount === 1 ? "run" : "runs"}
                    </span>
                  </div>
                </div>
                
                <div className="md:w-24 text-right row-start-2 md:row-start-auto col-start-1 md:col-start-auto justify-self-start md:justify-self-auto">
                  <span className="text-[12px] font-medium text-foreground bg-mist px-2 py-1 rounded-full">
                    {prompt.topic}
                  </span>
                </div>
                
                <div className="hidden md:block w-24 text-right text-[13px] font-medium tabular-nums text-foreground">
                  {prompt.runCount}
                </div>
                
                <div className="md:w-24 text-right row-start-2 md:row-start-auto col-start-2 md:col-start-auto">
                  {prompt.lastVisibilityPct !== null ? (
                    <span className="text-[13px] font-medium tabular-nums text-positive bg-[var(--positive-surface)] px-2 py-1 rounded-full">
                      {prompt.lastVisibilityPct}%
                    </span>
                  ) : (
                    <span className="text-[12px] text-slate-quiet">-</span>
                  )}
                </div>
                
                <div className="w-10 flex justify-end row-start-1 col-start-2 md:row-start-auto md:col-start-auto">
                  <PromptMenu prompt={prompt} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CreatePromptDialog() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("");
  const [tags, setTags] = useState("");
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { companyId } = useCompany();

  const { recoveredDraft, consumeRecovered, discardDraft, clearAfterSave } =
    useFormDraft({
      key: `prompt-create:${companyId}`,
      value: { text, topic, tags },
      active: open,
      isEmpty: (v) => !v.text.trim() && !v.topic.trim() && !v.tags.trim(),
    });

  const restoreDraft = () => {
    const d = consumeRecovered();
    if (!d) return;
    setText(d.text);
    setTopic(d.topic);
    setTags(d.tags);
  };
  
  const create = useCreatePrompt({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPromptsQueryKey({ companyId }) });
        clearAfterSave();
        setOpen(false);
        setText("");
        setTopic("");
        setTags("");
        toast({ title: "Prompt created" });
      },
      onError: (err) =>
        toast({
          title: "Failed to create prompt",
          description:
            (err as { data?: { error?: string } })?.data?.error ??
            "Your input is kept as a draft — try again.",
          variant: "destructive",
        }),
    }
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !topic.trim()) return;
    
    create.mutate({
      data: {
        companyId,
        text: text.trim(),
        topic: topic.trim(),
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
        // Omit models — the server applies the full canonical registry default.
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="m1-btn">
          <Plus className="w-4 h-4" /> New prompt
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="steep-heading">Track a new prompt</DialogTitle>
        </DialogHeader>
        {recoveredDraft && (
          <DraftBanner onRestore={restoreDraft} onDiscard={discardDraft} />
        )}
        <form onSubmit={onSubmit} className="space-y-4 mt-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground">Prompt text</label>
            <textarea 
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="e.g., What are the best enterprise SEO tools?"
              className="w-full h-24 rounded-lg border border-border p-3 text-[13px] placeholder:text-smoke outline-none focus:border-foreground resize-none"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground">Topic</label>
            <input 
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g., Enterprise SEO"
              className="w-full h-9 rounded-lg border border-border px-3 text-[13px] placeholder:text-smoke outline-none focus:border-foreground"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground">Tags (comma separated)</label>
            <input 
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="e.g., software, b2b, competitor"
              className="w-full h-9 rounded-lg border border-border px-3 text-[13px] placeholder:text-smoke outline-none focus:border-foreground"
            />
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="m1-btn m1-btn--ghost">Cancel</button>
            <button type="submit" disabled={create.isPending || !text.trim() || !topic.trim()} className="m1-btn">
              {create.isPending ? "Saving..." : "Create prompt"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DraftBanner({ onRestore, onDiscard }: { onRestore: () => void; onDiscard: () => void }) {
  return (
    <div
      data-testid="banner-draft-recovered"
      className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 mt-2"
    >
      <span className="text-[12px] text-amber-900 font-medium">
        You have an unfinished draft for this form.
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          data-testid="button-restore-draft"
          className="text-[12px] font-semibold text-amber-900 underline underline-offset-2"
          onClick={onRestore}
        >
          Restore
        </button>
        <button
          type="button"
          data-testid="button-discard-draft"
          className="text-[12px] font-medium text-amber-700 hover:text-amber-900"
          onClick={onDiscard}
        >
          Discard
        </button>
      </span>
    </div>
  );
}

function PromptMenu({ prompt }: { prompt: any }) {
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState(prompt.text);
  const [editTopic, setEditTopic] = useState(prompt.topic);
  const [editTags, setEditTags] = useState(prompt.tags?.join(", ") || "");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { companyId } = useCompany();

  const { recoveredDraft, consumeRecovered, discardDraft, clearAfterSave } =
    useFormDraft({
      key: `prompt-edit:${prompt.id}`,
      value: { text: editText, topic: editTopic, tags: editTags },
      active: editOpen,
      isEmpty: (v) =>
        v.text === prompt.text &&
        v.topic === prompt.topic &&
        v.tags === (prompt.tags?.join(", ") || ""),
    });

  const restoreDraft = () => {
    const d = consumeRecovered();
    if (!d) return;
    setEditText(d.text);
    setEditTopic(d.topic);
    setEditTags(d.tags);
  };
  
  const update = useUpdatePrompt({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPromptsQueryKey({ companyId }) });
        clearAfterSave();
        setEditOpen(false);
        toast({ title: "Prompt updated" });
      },
      onError: (err) =>
        toast({
          title: "Failed to update",
          description:
            (err as { data?: { error?: string } })?.data?.error ??
            "Your edits are kept as a draft — try again.",
          variant: "destructive",
        }),
    }
  });

  const del = useDeletePrompt({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPromptsQueryKey({ companyId }) });
        toast({ title: "Prompt deleted" });
      }
    }
  });

  const onEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editText.trim() || !editTopic.trim()) return;
    
    update.mutate({
      id: prompt.id,
      data: {
        text: editText.trim(),
        topic: editTopic.trim(),
        tags: editTags.split(",").map((t: string) => t.trim()).filter(Boolean),
      }
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-1.5 rounded-full hover:bg-mist text-slate-quiet transition-colors outline-none">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <Link href={`/prompts/${prompt.id}`}>
            <DropdownMenuItem className="cursor-pointer text-[13px] font-medium">
              <Play className="w-3.5 h-3.5 mr-2" /> Simulate
            </DropdownMenuItem>
          </Link>
          <DropdownMenuItem 
            onClick={() => setEditOpen(true)}
            className="cursor-pointer text-[13px] font-medium"
          >
            <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={() => { if(confirm("Delete prompt?")) del.mutate({ id: prompt.id }); }}
            className="cursor-pointer text-negative focus:bg-[var(--negative-surface)] text-[13px] font-medium"
          >
            <Trash className="w-3.5 h-3.5 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="steep-heading">Edit prompt</DialogTitle>
          </DialogHeader>
          {recoveredDraft && (
            <DraftBanner onRestore={restoreDraft} onDiscard={discardDraft} />
          )}
          <form onSubmit={onEditSubmit} className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-foreground">Prompt text</label>
              <textarea 
                value={editText}
                onChange={e => setEditText(e.target.value)}
                className="w-full h-24 rounded-lg border border-border p-3 text-[13px] outline-none focus:border-foreground resize-none"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-foreground">Topic</label>
              <input 
                value={editTopic}
                onChange={e => setEditTopic(e.target.value)}
                className="w-full h-9 rounded-lg border border-border px-3 text-[13px] outline-none focus:border-foreground"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-foreground">Tags (comma separated)</label>
              <input 
                value={editTags}
                onChange={e => setEditTags(e.target.value)}
                className="w-full h-9 rounded-lg border border-border px-3 text-[13px] outline-none focus:border-foreground"
              />
            </div>
            <div className="pt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setEditOpen(false)} className="m1-btn m1-btn--ghost">Cancel</button>
              <button type="submit" disabled={update.isPending || !editText.trim() || !editTopic.trim()} className="m1-btn">
                {update.isPending ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
