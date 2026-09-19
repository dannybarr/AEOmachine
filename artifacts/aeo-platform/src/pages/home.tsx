import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { 
  useListCompanies, 
  getListCompaniesQueryKey,
  useDeleteCompany,
  useCreateCompany,
  useUpdateCompany
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/components/CompanyContext";
import { Building2, Plus, ArrowRight, Trash2, Edit2, BarChart, Activity, ExternalLink, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function formatNumber(num: number | undefined | null) {
  if (num == null) return "0";
  return num.toLocaleString();
}

function formatPercent(num: number | undefined | null) {
  if (num == null) return "-";
  return Math.round(num) + "%";
}
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Home() {
  const { data: companies, isLoading } = useListCompanies({ days: 30 }, { query: { queryKey: getListCompaniesQueryKey({ days: 30 }) } });
  const { setCompanyId } = useCompany();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<any>(null);
  const [deletingCompany, setDeleteCompany] = useState<any>(null);

  const deleteMutation = useDeleteCompany();
  const updateMutation = useUpdateCompany();

  const handleSelectCompany = (id: number) => {
    setCompanyId(id);
    setLocation("/overview");
  };

  const handleDelete = () => {
    if (!deletingCompany) return;
    deleteMutation.mutate(
      { id: deletingCompany.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey({ days: 30 }) });
          setDeleteCompany(null);
          toast({ title: "Company deleted", description: `${deletingCompany.name} and all its data has been permanently removed.` });
        },
        onError: (err: any) => {
          if (err?.response?.status === 409) {
            toast({ 
              title: "Cannot delete", 
              description: "Cannot delete the last remaining company. Create another company first.",
              variant: "destructive"
            });
          } else {
            toast({ title: "Error", description: "Failed to delete company.", variant: "destructive" });
          }
          setDeleteCompany(null);
        }
      }
    );
  };

  if (isLoading) return <div className="p-4 sm:p-8 text-slate-quiet">Loading portfolio...</div>;

  return (
    <div className="flex-1 overflow-y-auto bg-fog">
      <div className="max-w-[1000px] mx-auto p-4 sm:p-8 space-y-6 sm:space-y-8">
        
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="steep-heading text-2xl tracking-tight mb-1">Company Portfolio</h1>
            <p className="text-[14px] text-slate-quiet">Manage your tracked companies and overview their intelligence status.</p>
          </div>
          <Button onClick={() => setIsAddOpen(true)} className="gap-2 rounded-full font-medium">
            <Plus className="w-4 h-4" /> Add Company
          </Button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {companies?.map(company => (
            <div key={company.id} className="bg-paper border border-border rounded-2xl overflow-hidden flex flex-col hover:border-ash transition-colors group">
              <div 
                className="p-4 sm:p-5 flex-1 cursor-pointer"
                onClick={() => handleSelectCompany(company.id)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-mist rounded-lg flex items-center justify-center text-slate-quiet shrink-0">
                      <span className="font-medium text-lg">{company.name.charAt(0)}</span>
                    </div>
                    <div>
                      <h3 className="font-medium text-[15px] text-foreground transition-colors">{company.name}</h3>
                      <a 
                        href={`https://${company.domain}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-[13px] text-slate-quiet flex items-center gap-1 hover:text-foreground"
                        onClick={e => e.stopPropagation()}
                      >
                        {company.domain} <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm mt-6">
                  <div>
                    <div className="text-ash text-xs font-medium uppercase tracking-wider mb-1">Visibility</div>
                    <div className="font-medium text-lg flex items-center gap-2">
                      {formatPercent(company.visibilityPct)}
                      <BarChart className="w-4 h-4 text-slate-quiet" />
                    </div>
                  </div>
                  <div>
                    <div className="text-ash text-xs font-medium uppercase tracking-wider mb-1">Retrievals</div>
                    <div className="font-medium text-lg flex items-center gap-2">
                      {formatNumber(company.retrievals)}
                      <Activity className="w-4 h-4 text-slate-quiet" />
                    </div>
                  </div>
                  <div>
                    <div className="text-ash text-[11px] uppercase tracking-wider mb-0.5">Prompts</div>
                    <div className="font-medium">{formatNumber(company.promptCount)}</div>
                  </div>
                  <div>
                    <div className="text-ash text-[11px] uppercase tracking-wider mb-0.5">Runs</div>
                    <div className="font-medium">{formatNumber(company.runCount)}</div>
                  </div>
                </div>
              </div>
              
              <div className="bg-mist px-5 py-3 border-t border-border flex items-center justify-between">
                <span className="text-xs text-slate-quiet">
                  {company.lastRunAt ? `Last run ${new Date(company.lastRunAt).toLocaleDateString()}` : "No runs yet"}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="w-8 h-8 h-8 rounded-full" onClick={() => setEditingCompany(company)}>
                    <Edit2 className="w-3.5 h-3.5 text-slate-quiet" />
                  </Button>
                  <Button variant="ghost" size="icon" className="w-8 h-8 h-8 rounded-full hover:text-negative hover:bg-[var(--negative-surface)]" onClick={() => setDeleteCompany(company)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>

      <Dialog open={!!deletingCompany} onOpenChange={(open) => !open && setDeleteCompany(null)}>
        <DialogContent className="sm:max-w-[425px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="steep-heading flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-negative" /> Delete Company
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm">
              Are you sure you want to delete <strong>{deletingCompany?.name}</strong>? 
            </p>
            <p className="text-sm mt-2 text-slate-quiet">
              This will permanently delete all associated prompts, simulation runs, citations, and insights. This action cannot be undone.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-full font-medium" onClick={() => setDeleteCompany(null)}>Cancel</Button>
            <Button variant="destructive" className="rounded-full font-medium" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Reusing Add/Edit Company Dialog from elsewhere or inline here */}
      <CompanyDialog 
        open={isAddOpen} 
        onOpenChange={setIsAddOpen}
      />
      <CompanyDialog 
        open={!!editingCompany} 
        onOpenChange={(open) => !open && setEditingCompany(null)}
        initialData={editingCompany}
      />
    </div>
  );
}

function CompanyDialog({ open, onOpenChange, initialData }: { open: boolean; onOpenChange: (open: boolean) => void, initialData?: any }) {
  const [name, setName] = useState(initialData?.name || "");
  const [domain, setDomain] = useState(initialData?.domain || "");
  const [industry, setIndustry] = useState(initialData?.industry || "");
  
  const queryClient = useQueryClient();
  const createCompany = useCreateCompany();
  const updateCompany = useUpdateCompany();

  // Update local state when initialData changes
  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setDomain(initialData.domain);
      setIndustry(initialData.industry || "");
    } else {
      setName("");
      setDomain("");
      setIndustry("");
    }
  }, [initialData, open]);

  const handleSave = () => {
    if (!name || !domain) return;
    
    if (initialData) {
      updateCompany.mutate(
        { id: initialData.id, data: { name, domain, industry: industry || undefined } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey({ days: 30 }) });
            onOpenChange(false);
          }
        }
      );
    } else {
      createCompany.mutate(
        { data: { name, domain, industry: industry || undefined } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey({ days: 30 }) });
            onOpenChange(false);
            setName("");
            setDomain("");
            setIndustry("");
          }
        }
      );
    }
  };

  const isPending = createCompany.isPending || updateCompany.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="steep-heading flex items-center gap-2">
            <Building2 className="w-5 h-5 text-slate-quiet" />
            {initialData ? "Edit Company" : "Add Tracked Company"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-ash">Company Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Corp"
              className="rounded-lg placeholder:text-smoke"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-ash">Primary Domain</label>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. acme.com"
              className="rounded-lg placeholder:text-smoke"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-ash">Industry (Optional)</label>
            <Input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. B2B SaaS"
              className="rounded-lg placeholder:text-smoke"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-full font-medium" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button 
            onClick={handleSave} 
            disabled={!name || !domain || isPending}
            className="rounded-full font-medium"
          >
            {isPending ? "Saving..." : "Save Company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
