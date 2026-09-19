import { useEffect, useMemo, useState } from "react";
import {
  useListCompetitors,
  useAddCompetitor,
  useRemoveCompetitor,
  getListCompetitorsQueryKey,
  useGetSystemStatus,
  getGetSystemStatusQueryKey,
  useListCompanies,
  useCreateCompany,
  usePatchCompany,
  useDeleteCompany,
  getListCompaniesQueryKey,
  type CompanySummary,
} from "@workspace/api-client-react";
import {
  Globe,
  Plus,
  Trash2,
  Shield,
  Search,
  Building2,
  Server,
  AlertCircle,
  Check,
  BookOpen,
  ArrowRight,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useCompany } from "@/components/CompanyContext";
import { useFormDraft } from "@/hooks/use-form-draft";

/** Editable profile fields (all optional strategic context). */
interface ProfileForm {
  name: string;
  domain: string;
  industry: string;
  objective: string;
  targetAudience: string;
  productsServices: string;
  positioning: string;
  geography: string;
  notes: string;
  autoTrackDaily: boolean;
}

function toForm(c: CompanySummary | undefined): ProfileForm {
  return {
    name: c?.name ?? "",
    domain: c?.domain ?? "",
    industry: c?.industry ?? "",
    objective: c?.objective ?? "",
    targetAudience: c?.targetAudience ?? "",
    productsServices: c?.productsServices ?? "",
    positioning: c?.positioning ?? "",
    geography: c?.geography ?? "",
    notes: c?.notes ?? "",
    autoTrackDaily: c?.autoTrackDaily ?? false,
  };
}

const inputCls =
  "w-full h-9 px-3 text-[13px] font-medium bg-paper border border-border rounded-lg outline-none focus:border-foreground placeholder:text-smoke";
const textareaCls =
  "w-full min-h-[72px] px-3 py-2 text-[13px] font-medium bg-paper border border-border rounded-lg outline-none focus:border-foreground placeholder:text-smoke resize-y";
const labelCls = "block text-[12px] font-medium text-slate-quiet mb-1";

export default function Settings() {
  const { companyId, setCompanyId } = useCompany();
  const { data: companies } = useListCompanies(
    { days: 30 },
    { query: { queryKey: getListCompaniesQueryKey({ days: 30 }) } },
  );
  const { data: competitors, isLoading: competitorsLoading } = useListCompetitors(
    { companyId },
    { query: { queryKey: getListCompetitorsQueryKey({ companyId }) } },
  );
  const { data: systemStatus } = useGetSystemStatus({
    query: { queryKey: getGetSystemStatusQueryKey() },
  });

  const addCompetitor = useAddCompetitor();
  const removeCompetitor = useRemoveCompetitor();
  const createCompany = useCreateCompany();
  const patchCompany = usePatchCompany();
  const deleteCompany = useDeleteCompany();

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const selectedCompany = companies?.find((c) => c.id === companyId);

  const [form, setForm] = useState<ProfileForm>(() => toForm(selectedCompany));
  const [newCompetitor, setNewCompetitor] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ domain: "", targetAudience: "" });

  // Recoverable draft: an unfinished new-company form survives a refresh.
  const {
    recoveredDraft: recoveredCreateDraft,
    consumeRecovered: consumeCreateDraft,
    discardDraft: discardCreateDraft,
    clearAfterSave: clearCreateDraft,
  } = useFormDraft<{ domain: string; targetAudience: string }>({
    key: "create-company",
    value: createForm,
    active: showCreate,
    isEmpty: (v) => !v.domain.trim() && !v.targetAudience.trim(),
  });

  const restoreCreateDraft = () => {
    const d = consumeCreateDraft();
    if (d) setCreateForm(d);
  };
  const [confirmDelete, setConfirmDelete] = useState(false);

  const serverForm = useMemo(() => toForm(selectedCompany), [selectedCompany]);
  const [seededForm, setSeededForm] = useState<ProfileForm>(serverForm);
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(seededForm),
    [form, seededForm],
  );

  // Re-seed the form when switching company (always) or when fresh server
  // data arrives and the user has no unsaved edits. Dirty local edits are
  // never discarded by a background refetch.
  const [seedCompanyId, setSeedCompanyId] = useState<number | undefined>(selectedCompany?.id);
  useEffect(() => {
    const companyChanged = selectedCompany?.id !== seedCompanyId;
    if (companyChanged || (!dirty && JSON.stringify(serverForm) !== JSON.stringify(seededForm))) {
      setForm(serverForm);
      setSeededForm(serverForm);
      setSeedCompanyId(selectedCompany?.id);
      if (companyChanged) setConfirmDelete(false);
    }
  }, [serverForm, seededForm, dirty, selectedCompany, seedCompanyId]);

  const set = (patch: Partial<ProfileForm>) => setForm((f) => ({ ...f, ...patch }));

  // Recoverable draft: unsaved profile edits survive a browser refresh.
  const { recoveredDraft, consumeRecovered, discardDraft, clearAfterSave } =
    useFormDraft<ProfileForm>({
      key: `company-profile:${selectedCompany?.id ?? "none"}`,
      value: form,
      active: !!selectedCompany,
      isEmpty: (v) => JSON.stringify(v) === JSON.stringify(serverForm),
    });

  const restoreDraft = () => {
    const d = consumeRecovered();
    if (d) setForm(d);
  };

  const invalidateCompanies = () =>
    queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey({ days: 30 }) });

  const handleSave = () => {
    if (!selectedCompany) return;
    patchCompany.mutate(
      {
        id: selectedCompany.id,
        data: {
          name: form.name.trim(),
          domain: form.domain.trim().toLowerCase(),
          industry: form.industry,
          objective: form.objective,
          targetAudience: form.targetAudience,
          productsServices: form.productsServices,
          positioning: form.positioning,
          geography: form.geography,
          notes: form.notes,
          autoTrackDaily: form.autoTrackDaily,
        },
      },
      {
        onSuccess: () => {
          clearAfterSave();
          invalidateCompanies();
          queryClient.invalidateQueries();
          toast({ title: "Company profile saved" });
        },
        onError: (err) =>
          toast({
            title: "Failed to save profile",
            description:
              (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
              "Check the fields and try again.",
            variant: "destructive",
          }),
      },
    );
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedDomain = createForm.domain.trim().toLowerCase();
    createCompany.mutate(
      {
        data: {
          domain: normalizedDomain,
          targetAudience: createForm.targetAudience.trim() || null,
        },
      },
      {
        onSuccess: (created) => {
          clearCreateDraft();
          invalidateCompanies();
          setCompanyId(created.id);
          setShowCreate(false);
          setCreateForm({ domain: "", targetAudience: "" });
          toast({
            title: "Assessment started automatically",
            description: "Open Brand Audit to track progress and review findings.",
            action: (
              <ToastAction altText="Go to Audit" onClick={() => setLocation("/audit")}>
                View Audit
              </ToastAction>
            ),
          });
        },
        onError: (err) =>
          toast({
            title: "Failed to create company",
            description:
              (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
              "Check the fields and try again.",
            variant: "destructive",
          }),
      },
    );
  };

  const handleDelete = () => {
    if (!selectedCompany) return;
    deleteCompany.mutate(
      { id: selectedCompany.id },
      {
        onSuccess: () => {
          const next = companies?.find((c) => c.id !== selectedCompany.id);
          if (next) setCompanyId(next.id);
          invalidateCompanies();
          queryClient.invalidateQueries();
          setConfirmDelete(false);
          toast({ title: `${selectedCompany.name} removed`, description: "All of its tracked data was deleted." });
        },
        onError: (err) =>
          toast({
            title: "Cannot delete company",
            description:
              (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
              "At least one company must remain.",
            variant: "destructive",
          }),
      },
    );
  };

  const handleAddCompetitor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompetitor.trim()) return;
    addCompetitor.mutate(
      { data: { companyId, domain: newCompetitor.trim().toLowerCase() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCompetitorsQueryKey({ companyId }) });
          setNewCompetitor("");
          toast({ title: "Competitor added" });
        },
        onError: () => toast({ title: "Failed to add competitor", variant: "destructive" }),
      },
    );
  };

  const handleRemoveCompetitor = (id: number) => {
    removeCompetitor.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCompetitorsQueryKey({ companyId }) });
          toast({ title: "Competitor removed" });
        },
        onError: () => toast({ title: "Failed to remove competitor", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="p-4 sm:p-8 max-w-[800px] mx-auto space-y-8 sm:space-y-10 m1-stagger visible">
      <header>
        <h1 className="text-2xl steep-heading tracking-tight">Company Cockpit</h1>
        <p className="text-[13px] text-slate-quiet mt-1">
          Manage each researched company and the strategic context that shapes tracking,
          discovery, and research across the platform.
        </p>
      </header>

      {/* Company manager */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-foreground tracking-wide uppercase">
            <Building2 className="w-4 h-4 text-slate-quiet" />
            Companies
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="h-8 px-3 bg-primary text-primary-foreground text-[13px] font-medium rounded-full flex items-center gap-1.5"
            data-testid="button-add-company"
          >
            <Plus className="w-3.5 h-3.5" /> Add company
          </button>
        </div>

        {showCreate && recoveredCreateDraft && (
          <div
            data-testid="banner-create-draft-recovered"
            className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
          >
            <span className="text-[12px] text-amber-900 font-medium">
              You have an unfinished new-company form from a previous session.
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <button type="button" data-testid="button-restore-create-draft"
                className="text-[12px] font-semibold text-amber-900 underline underline-offset-2"
                onClick={restoreCreateDraft}>
                Restore
              </button>
              <button type="button" data-testid="button-discard-create-draft"
                className="text-[12px] font-medium text-amber-700 hover:text-amber-900"
                onClick={discardCreateDraft}>
                Discard
              </button>
            </span>
          </div>
        )}
        {showCreate && (
          <form onSubmit={handleCreate} className="m1-card p-4 sm:p-5 grid gap-3 sm:grid-cols-2" data-testid="form-create-company">
            <div>
              <label className={labelCls}>Website</label>
               <input className={inputCls} value={createForm.domain} required
                onChange={(e) => setCreateForm((f) => ({ ...f, domain: e.target.value }))}
                  placeholder="acme.com or https://www.acme.com" data-testid="input-create-website" />
            </div>
            <div>
              <label className={labelCls}>Target audience <span className="text-smoke">(optional)</span></label>
              <input className={inputCls} value={createForm.targetAudience}
                onChange={(e) => setCreateForm((f) => ({ ...f, targetAudience: e.target.value }))}
                placeholder="e.g. Finance leaders at growing SaaS teams" data-testid="input-create-target-audience" />
            </div>
            <p className="sm:col-span-2 text-[12px] text-slate-quiet">
              We’ll assess the website in the background and suggest the remaining profile details for your approval.
            </p>
            <div className="sm:col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)}
                className="h-9 px-4 text-[13px] font-medium rounded-full border border-border">
                Cancel
              </button>
              <button type="submit" disabled={createCompany.isPending}
                className="h-9 px-4 bg-primary text-primary-foreground text-[13px] font-medium rounded-full disabled:opacity-50"
                data-testid="button-create-company">
                {createCompany.isPending ? "Starting..." : "Assess website"}
              </button>
            </div>
          </form>
        )}

        <div className="m1-card divide-y divide-border overflow-hidden">
          {companies?.map((c) => (
            <button
              key={c.id}
              onClick={() => setCompanyId(c.id)}
              className={`w-full flex items-center justify-between gap-3 p-3 sm:p-4 text-left transition-colors ${
                c.id === companyId ? "bg-fog" : "hover:bg-fog"
              }`}
              data-testid={`row-company-${c.id}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-mist flex items-center justify-center text-slate-quiet font-medium shrink-0">
                  {c.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-foreground truncate">{c.name}</div>
                  <div className="text-[12px] text-slate-quiet truncate">
                    {c.domain}
                    {c.industry ? ` · ${c.industry}` : " · No industry set"}
                  </div>
                </div>
              </div>
              {c.id === companyId && <Check className="w-4 h-4 text-positive shrink-0" />}
            </button>
          ))}
        </div>
      </section>

      {/* Strategic profile */}
      {selectedCompany && (
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-foreground tracking-wide uppercase">
            <Globe className="w-4 h-4 text-slate-quiet" />
            Strategic Profile ({selectedCompany.name})
          </div>
          <div className="m1-card p-4 sm:p-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Company name</label>
                <input className={inputCls} value={form.name}
                  onChange={(e) => set({ name: e.target.value })} data-testid="input-profile-name" />
              </div>
              <div>
                <label className={labelCls}>Domain</label>
                <input className={inputCls} value={form.domain}
                  onChange={(e) => set({ domain: e.target.value })} data-testid="input-profile-domain" />
              </div>
              <div>
                <label className={labelCls}>Industry — appears as this company's topic on the Dashboard</label>
                <input className={inputCls} value={form.industry} placeholder="Venture Capital"
                  onChange={(e) => set({ industry: e.target.value })} data-testid="input-profile-industry" />
              </div>
              <div>
                <label className={labelCls}>Geography / markets</label>
                <input className={inputCls} value={form.geography} placeholder="UK & Europe"
                  onChange={(e) => set({ geography: e.target.value })} data-testid="input-profile-geography" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Primary objective</label>
              <textarea className={textareaCls} value={form.objective}
                placeholder="What should AI visibility achieve for this company?"
                onChange={(e) => set({ objective: e.target.value })} data-testid="input-profile-objective" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Target audience</label>
                <textarea className={textareaCls} value={form.targetAudience}
                  placeholder="Who are they trying to reach?"
                  onChange={(e) => set({ targetAudience: e.target.value })} data-testid="input-profile-audience" />
              </div>
              <div>
                <label className={labelCls}>Products / services</label>
                <textarea className={textareaCls} value={form.productsServices}
                  placeholder="Core offering"
                  onChange={(e) => set({ productsServices: e.target.value })} data-testid="input-profile-products" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Positioning</label>
              <textarea className={textareaCls} value={form.positioning}
                placeholder="How they differentiate from competitors"
                onChange={(e) => set({ positioning: e.target.value })} data-testid="input-profile-positioning" />
            </div>
            <div>
              <label className={labelCls}>Research notes</label>
              <textarea className={textareaCls} value={form.notes}
                placeholder="Any other relevant detail for research and analysis"
                onChange={(e) => set({ notes: e.target.value })} data-testid="input-profile-notes" />
            </div>
            <label className="flex items-center gap-2 text-[13px] font-medium text-foreground cursor-pointer">
              <input type="checkbox" checked={form.autoTrackDaily}
                onChange={(e) => set({ autoTrackDaily: e.target.checked })}
                className="w-4 h-4 accent-[var(--primary)]" data-testid="input-profile-autotrack" />
              Run daily tracking automatically
            </label>
            <p className="text-[12px] text-slate-quiet border-t border-border pt-3">
              This context informs prompt suggestions and research framing. Tracked visibility runs
              stay unprimed — models answer the exact customer question with no company background —
              so visibility and citation metrics remain unbiased and comparable over time. Each
              tracking and research job snapshots the profile it ran with, so later edits don't
              rewrite past results.
            </p>
            {recoveredDraft && (
              <div
                data-testid="banner-draft-recovered"
                className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
              >
                <span className="text-[12px] text-amber-900 font-medium">
                  Unsaved profile edits from a previous session were found.
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                {confirmDelete ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] text-negative">Delete {selectedCompany.name} and all its data?</span>
                    <button onClick={handleDelete} disabled={deleteCompany.isPending}
                      className="h-8 px-3 text-[13px] font-medium rounded-full bg-negative text-white disabled:opacity-50"
                      data-testid="button-confirm-delete">
                      {deleteCompany.isPending ? "Deleting..." : "Yes, delete"}
                    </button>
                    <button onClick={() => setConfirmDelete(false)}
                      className="h-8 px-3 text-[13px] font-medium rounded-full border border-border">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDelete(true)}
                    className="h-8 px-3 text-[13px] font-medium rounded-full text-negative border border-border hover:bg-[var(--negative-surface)]"
                    data-testid="button-delete-company">
                    <span className="flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" /> Delete company</span>
                  </button>
                )}
              </div>
              <button onClick={handleSave} disabled={!dirty || patchCompany.isPending}
                className="h-9 px-5 bg-primary text-primary-foreground text-[13px] font-medium rounded-full disabled:opacity-50"
                data-testid="button-save-profile">
                {patchCompany.isPending ? "Saving..." : dirty ? "Save profile" : "Saved"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Case Studies entry */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-[13px] font-medium text-foreground tracking-wide uppercase">
          <BookOpen className="w-4 h-4 text-slate-quiet" />
          Case Studies
        </div>
        <Link
          href="/settings/case-studies"
          className="m1-card p-4 sm:p-5 flex items-center justify-between gap-3 hover:bg-fog transition-colors group"
          data-testid="link-settings-case-studies"
        >
          <div>
            <div className="text-[14px] font-medium text-foreground">
              Evolving case study{selectedCompany ? ` — ${selectedCompany.name}` : ""}
            </div>
            <p className="text-[13px] text-slate-quiet mt-0.5 max-w-lg">
              Turn this client's starting position, focus, activity, and measured progress into a
              durable value story with dated revisions.
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-quiet group-hover:text-foreground shrink-0" />
        </Link>
      </section>

      {/* Competitors scoped to company */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-[13px] font-medium text-foreground tracking-wide uppercase">
          <Shield className="w-4 h-4 text-slate-quiet" />
          Competitors ({selectedCompany?.name})
        </div>

        <div className="m1-card overflow-hidden">
          <div className="p-4 border-b border-border bg-fog">
            <form onSubmit={handleAddCompetitor} className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={newCompetitor}
                onChange={(e) => setNewCompetitor(e.target.value)}
                placeholder="competitor.com"
                className="flex-1 h-9 px-3 text-[13px] font-medium bg-paper border border-border rounded-lg outline-none focus:border-foreground placeholder:text-smoke"
              />
              <button
                type="submit"
                disabled={!newCompetitor.trim() || addCompetitor.isPending}
                className="h-9 px-4 bg-primary text-primary-foreground text-[13px] font-medium rounded-full flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {addCompetitor.isPending ? "Adding..." : <><Plus className="w-4 h-4" /> Add</>}
              </button>
            </form>
          </div>

          <div className="divide-y divide-border">
            {competitorsLoading ? (
              <div className="p-6 text-center text-[13px] text-slate-quiet">Loading competitors...</div>
            ) : competitors?.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center">
                <Search className="w-6 h-6 text-smoke mb-3" />
                <p className="text-[13px] text-slate-quiet">No competitors tracked for this company.</p>
              </div>
            ) : (
              competitors?.map((comp) => (
                <div key={comp.id} className="flex items-center justify-between p-4 hover:bg-fog transition-colors">
                  <div className="flex items-center gap-3">
                    <Globe className="w-4 h-4 text-slate-quiet" />
                    <span className="text-[13px] font-medium text-foreground">{comp.domain}</span>
                  </div>
                  <button
                    onClick={() => handleRemoveCompetitor(comp.id)}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-slate-quiet hover:bg-[var(--negative-surface)] hover:text-negative transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* System Status */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-[13px] font-medium text-foreground tracking-wide uppercase">
          <Server className="w-4 h-4 text-slate-quiet" />
          System Status
        </div>

        <div className="m1-card p-4 sm:p-6 flex items-start gap-3 sm:gap-4">
          <div className="w-10 h-10 rounded-full bg-mist flex items-center justify-center shrink-0">
            {systemStatus?.simulationConfigured ? (
              <div className="w-2.5 h-2.5 rounded-full bg-positive" />
            ) : (
              <AlertCircle className="w-5 h-5 text-negative" />
            )}
          </div>
          <div>
            <h3 className="text-[15px] font-medium text-foreground">
              {systemStatus?.simulationConfigured ? "Simulation Engine Connected" : "Simulation Engine Offline"}
            </h3>
            <p className="text-[13px] text-slate-quiet mt-1 max-w-md">
              {systemStatus?.simulationConfigured
                ? "The platform is successfully connected to the simulation backend. API keys and rate limits are healthy."
                : "The backend is missing API keys to run simulations. Please configure the platform environment."}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
