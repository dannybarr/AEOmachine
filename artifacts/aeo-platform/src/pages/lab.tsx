import { useState } from "react";
import { Link } from "wouter";
import { 
  useListSiteTests, 
  useCreateSiteTest,
  useDeleteSiteTest,
  useListCompanies,
  getListSiteTestsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Target, Trash, Activity, Globe, Map, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/components/CompanyContext";
import { useFormDraft } from "@/hooks/use-form-draft";

export default function Lab() {
  const { companyId } = useCompany();
  const { data: sites, isLoading } = useListSiteTests(
    { companyId },
    { query: { queryKey: getListSiteTestsQueryKey({ companyId }) } },
  );
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const del = useDeleteSiteTest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSiteTestsQueryKey({ companyId }) });
        toast({ title: "Site removed" });
      }
    }
  });

  return (
    <div className="p-4 sm:p-8 max-w-[1000px] mx-auto space-y-6 m1-stagger visible">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl steep-heading tracking-tight">Site Testing Zone</h1>
          <p className="text-[13px] text-slate-quiet mt-1">Run live AEO audits on your web properties.</p>
        </div>
        <AddSiteDialog />
      </div>

      <ClientPlaybooks />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full p-8 text-center text-[13px] text-slate-quiet">Loading sites...</div>
        ) : sites?.length === 0 ? (
          <div className="col-span-full bg-paper border border-border rounded-2xl p-12 text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center mb-4">
              <Target className="w-5 h-5 text-slate-quiet" />
            </div>
            <p className="text-[14px] font-medium text-foreground">No sites tracked yet</p>
            <p className="text-[13px] text-slate-quiet mt-1 mb-6">Add a website to start running AEO audits.</p>
            <AddSiteDialog />
          </div>
        ) : (
          sites?.map(site => (
            <div key={site.id} className="bg-paper border border-border rounded-2xl flex flex-col overflow-hidden">
              <div className="p-5 flex-1 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-[15px] font-medium text-foreground truncate" title={site.name}>{site.name}</h3>
                    <a href={site.url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-slate-quiet hover:underline flex items-center gap-1 mt-0.5 truncate">
                      <Globe className="w-3 h-3 shrink-0" /> {site.url}
                    </a>
                  </div>
                  <button 
                    onClick={() => { if(confirm("Remove site?")) del.mutate({ id: site.id, params: { companyId } }); }}
                    className="p-1.5 rounded-full hover:bg-[var(--negative-surface)] text-slate-quiet hover:text-negative transition-colors"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="flex items-center gap-4">
                  <div>
                    <div className="text-[10px] font-medium text-ash uppercase tracking-wider mb-1">Latest Score</div>
                    <div className="text-2xl font-medium tracking-tight text-foreground tabular-nums">
                      {site.latestScore !== null ? `${site.latestScore}/100` : '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium text-ash uppercase tracking-wider mb-1">Audits</div>
                    <div className="text-2xl font-medium tracking-tight text-foreground tabular-nums">
                      {site.snapshotCount}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="p-3 border-t border-border bg-fog">
                <Link href={`/lab/${site.id}`} className="m1-btn w-full m1-btn--outline">
                  View Audits <Activity className="w-4 h-4 ml-1" />
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AddSiteDialog() {
  const { companyId } = useCompany();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { recoveredDraft, consumeRecovered, discardDraft, clearAfterSave } =
    useFormDraft<{ name: string; url: string }>({
      key: `add-site:${companyId}`,
      value: { name, url },
      active: open,
      isEmpty: (v) => !v.name.trim() && !v.url.trim(),
    });

  const restoreDraft = () => {
    const d = consumeRecovered();
    if (!d) return;
    setName(d.name);
    setUrl(d.url);
  };
  
  const create = useCreateSiteTest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSiteTestsQueryKey({ companyId }) });
        clearAfterSave();
        setOpen(false);
        setName("");
        setUrl("");
        toast({ title: "Site added" });
      },
      onError: (err) =>
        toast({
          title: "Failed to add site",
          description:
            (err as { data?: { error?: string } })?.data?.error ?? "Check the fields and try again.",
          variant: "destructive",
        }),
    }
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    
    // Add protocol if missing
    let finalUrl = url.trim();
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl;
    }
    
    create.mutate({
      data: {
        companyId,
        name: name.trim(),
        url: finalUrl
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="m1-btn">
          <Plus className="w-4 h-4" /> Add site
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="steep-heading">Track a new site</DialogTitle>
        </DialogHeader>
        {recoveredDraft && (
          <div
            data-testid="banner-draft-recovered"
            className="mt-2 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
          >
            <span className="text-[12px] text-amber-900 font-medium">
              You have an unfinished draft for this form.
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <button type="button" data-testid="button-restore-draft"
                className="text-[12px] font-semibold text-amber-900 underline underline-offset-2"
                onClick={restoreDraft}>
                Restore
              </button>
              <button type="button" data-testid="button-discard-draft"
                className="text-[12px] font-medium text-amber-700 hover:text-amber-900"
                onClick={discardDraft}>
                Discard
              </button>
            </span>
          </div>
        )}
        <form onSubmit={onSubmit} className="space-y-4 mt-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground">Site Name</label>
            <input 
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Acme Corp Blog"
              className="w-full h-9 rounded-lg border border-border px-3 text-[13px] placeholder:text-smoke outline-none focus:border-foreground"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground">URL</label>
            <input 
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="e.g., https://acme.com/blog"
              className="w-full h-9 rounded-lg border border-border px-3 text-[13px] placeholder:text-smoke outline-none focus:border-foreground"
              required
            />
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="m1-btn m1-btn--ghost">Cancel</button>
            <button type="submit" disabled={create.isPending || !name.trim() || !url.trim()} className="m1-btn">
              {create.isPending ? "Adding..." : "Add site"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClientPlaybooks() {
  const { data: companies, isLoading } = useListCompanies({ days: 30 });

  return (
    <div className="bg-paper border border-border rounded-2xl overflow-hidden">
      <div className="p-4 border-b border-border bg-fog flex items-center gap-2">
        <Map className="w-4 h-4 text-slate-quiet" />
        <h2 className="text-[13px] steep-heading">Client Playbooks</h2>
        <span className="text-[11px] text-slate-quiet">the 5-step AEO strategy program per client</span>
      </div>
      {isLoading ? (
        <div className="p-6 text-center text-[13px] text-slate-quiet">Loading clients...</div>
      ) : !companies || companies.length === 0 ? (
        <div className="p-6 text-center text-[13px] text-slate-quiet">No clients yet. Add a company to start a playbook.</div>
      ) : (
        <div className="divide-y divide-border">
          {companies.map(c => (
            <Link
              key={c.id}
              href={`/lab/strategy/${c.id}`}
              className="p-4 flex items-center justify-between gap-3 hover:bg-mist transition-colors group"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground">{c.name}</div>
                <div className="text-[12px] text-slate-quiet mt-0.5">
                  {c.promptCount} prompts tracked · {c.runCount} runs · {c.visibilityPct}% visibility
                </div>
              </div>
              <span className="m1-btn m1-btn--outline shrink-0">
                Open playbook <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
