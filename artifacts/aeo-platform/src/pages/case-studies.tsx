import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetCaseStudy,
  getGetCaseStudyQueryKey,
  useSaveCaseStudyContext,
  useRefreshCaseStudy,
  useUpdateCaseStudyRevision,
  useListCompanies,
  getListCompaniesQueryKey,
  type CaseStudyRevision,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  AlertCircle,
  ArrowRight,
  History,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompany } from "@/components/CompanyContext";
import { useToast } from "@/hooks/use-toast";

const inputAreaCls =
  "w-full min-h-[88px] px-3 py-2 text-[13px] font-medium bg-paper border border-border rounded-lg outline-none focus:border-foreground placeholder:text-smoke resize-y";
const labelCls = "block text-[12px] font-medium text-slate-quiet mb-1";

interface ContextForm {
  startingPosition: string;
  strategicFocus: string;
  contextNotes: string;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function displayNarrative(r: CaseStudyRevision): string {
  return r.editedNarrative ?? r.narrative;
}

const STAGE_LABELS: Record<string, string> = {
  collecting_evidence: "Collecting recorded evidence…",
  generating_narrative: "Writing the story from the evidence…",
  saving_revision: "Saving the new revision…",
};

export default function CaseStudies() {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: companies } = useListCompanies(
    { days: 30 },
    { query: { queryKey: getListCompaniesQueryKey({ days: 30 }) } },
  );
  const companyName = companies?.find((c) => c.id === companyId)?.name ?? "";

  const { data, isLoading, isError, refetch } = useGetCaseStudy(
    { companyId },
    {
      query: {
        queryKey: getGetCaseStudyQueryKey({ companyId }),
        // Poll while a refresh job is running so progress and the finished
        // revision appear without a manual reload.
        refetchInterval: (q) =>
          q.state.data?.activeJob?.status === "running" ? 2500 : false,
      },
    },
  );

  const saveContext = useSaveCaseStudyContext();
  const startRefresh = useRefreshCaseStudy();
  const updateRevision = useUpdateCaseStudyRevision();

  // ── Context form, keyed by company so switching never leaks drafts ──
  const serverForm: ContextForm = useMemo(
    () => ({
      startingPosition: data?.caseStudy.startingPosition ?? "",
      strategicFocus: data?.caseStudy.strategicFocus ?? "",
      contextNotes: data?.caseStudy.contextNotes ?? "",
    }),
    [data?.caseStudy],
  );
  const [form, setForm] = useState<ContextForm>(serverForm);
  const [seededFor, setSeededFor] = useState<number | undefined>(undefined);
  const [seeded, setSeeded] = useState<ContextForm>(serverForm);
  const dirty = JSON.stringify(form) !== JSON.stringify(seeded);
  useEffect(() => {
    const companyChanged = seededFor !== companyId;
    if (data && (companyChanged || (!dirty && JSON.stringify(serverForm) !== JSON.stringify(seeded)))) {
      setForm(serverForm);
      setSeeded(serverForm);
      setSeededFor(companyId);
    }
  }, [data, serverForm, seeded, dirty, companyId, seededFor]);

  // ── Revision editing state (isolated per revision id) ──
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  useEffect(() => {
    // Never carry an in-progress edit across companies.
    setEditingId(null);
    setExpandedId(null);
  }, [companyId]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetCaseStudyQueryKey({ companyId }) });

  const handleSaveContext = () => {
    saveContext.mutate(
      {
        data: {
          companyId,
          startingPosition: form.startingPosition.trim() || null,
          strategicFocus: form.strategicFocus.trim() || null,
          contextNotes: form.contextNotes.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setSeeded(form);
          invalidate();
          toast({ title: "Client context saved" });
        },
        onError: (err) =>
          toast({
            title: "Failed to save context",
            description:
              (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
              "Try again.",
            variant: "destructive",
          }),
      },
    );
  };

  const handleRefresh = () => {
    startRefresh.mutate(
      { data: { companyId } },
      {
        onSuccess: () => invalidate(),
        onError: (err) =>
          toast({
            title: "Couldn't start the refresh",
            description:
              (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
              "Try again shortly.",
            variant: "destructive",
          }),
      },
    );
  };

  const handleSaveEdit = (revisionId: number) => {
    updateRevision.mutate(
      { id: revisionId, data: { companyId, editedNarrative: editText } },
      {
        onSuccess: () => {
          setEditingId(null);
          invalidate();
          toast({ title: "Wording saved" });
        },
        onError: () => toast({ title: "Failed to save wording", variant: "destructive" }),
      },
    );
  };

  const handleApprove = (r: CaseStudyRevision, approved: boolean) => {
    updateRevision.mutate(
      { id: r.id, data: { companyId, approved } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: approved ? "Revision approved" : "Approval removed" });
        },
        onError: () => toast({ title: "Failed to update approval", variant: "destructive" }),
      },
    );
  };

  const handleCopy = async (r: CaseStudyRevision) => {
    try {
      await navigator.clipboard.writeText(displayNarrative(r));
      toast({ title: "Story copied to clipboard" });
    } catch {
      toast({ title: "Copy failed — select the text manually", variant: "destructive" });
    }
  };

  if (isLoading && !data) {
    return (
      <div className="p-4 sm:p-8 max-w-[900px] mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-quiet" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="p-4 sm:p-8 max-w-[900px] mx-auto">
        <div className="m1-card p-8 text-center flex flex-col items-center gap-3">
          <AlertCircle className="w-5 h-5 text-negative" />
          <p className="text-[13px] text-slate-quiet">The case study couldn't be loaded.</p>
          <button onClick={() => refetch()} className="m1-btn m1-btn--outline text-[12px]" data-testid="button-retry-load">
            Try again
          </button>
        </div>
      </div>
    );
  }

  const revisions = data.revisions;
  const latest = revisions[0];
  const activeJob = data.activeJob;
  const lastJob = data.lastJob;
  const totalNewActivity = data.newActivity
    ? data.newActivity.runs + data.newActivity.actions + data.newActivity.measurements
    : 0;
  const hasContext =
    !!(data.caseStudy.startingPosition || data.caseStudy.strategicFocus);

  return (
    <div className="p-4 sm:p-8 max-w-[900px] mx-auto space-y-8 m1-stagger visible">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-medium text-ash uppercase tracking-widest mb-1">
            <Link href="/settings" className="hover:text-foreground">Settings</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-slate-quiet">Case Studies</span>
          </div>
          <h1 className="text-2xl steep-heading tracking-tight">Case Study — {companyName}</h1>
          <p className="text-[13px] text-slate-quiet mt-1 max-w-lg">
            A durable value story built from this client's recorded starting position, focus,
            activity, and measured progress — developed through dated revisions, never rewritten.
          </p>
        </div>
        <RefreshControl
          activeJob={activeJob}
          generationAvailable={data.generationAvailable}
          pending={startRefresh.isPending}
          onRefresh={handleRefresh}
        />
      </header>

      {/* Job failure surface: the last good story is untouched. */}
      {!activeJob && lastJob?.status === "failed" && (
        <div data-testid="banner-job-failed" className="flex items-start gap-3 rounded-xl border border-[var(--negative-surface,#fca5a5)] bg-[var(--negative-surface)] px-4 py-3">
          <AlertCircle className="w-4 h-4 text-negative mt-0.5 shrink-0" />
          <div className="text-[13px]">
            <span className="font-medium text-negative">The last refresh didn't finish.</span>{" "}
            <span className="text-foreground/80">{lastJob.error ?? "Try again shortly."}</span>
          </div>
        </div>
      )}

      {/* New activity since the latest revision */}
      {latest && totalNewActivity > 0 && !activeJob && (
        <div data-testid="banner-new-activity" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-fog px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] text-foreground">
            <Sparkles className="w-4 h-4 text-slate-quiet" />
            <span>
              Since the last revision ({fmtDate(latest.createdAt)}):{" "}
              <span className="font-medium">{data.newActivity!.runs} tracking runs</span>,{" "}
              <span className="font-medium">{data.newActivity!.actions} strategy updates</span>,{" "}
              <span className="font-medium">{data.newActivity!.measurements} measurements</span>.
              A refresh would fold these into the story.
            </span>
          </div>
        </div>
      )}

      {/* ── Client context ── */}
      <section className="space-y-3">
        <h2 className="text-[13px] font-medium text-foreground tracking-wide uppercase">Client Context</h2>
        <div className="m1-card p-4 sm:p-6 space-y-4">
          <div>
            <label className={labelCls}>Starting position — where this client began</label>
            <textarea
              className={inputAreaCls}
              value={form.startingPosition}
              placeholder="e.g. Invisible in AI answers for their core buying questions; no owned pages being cited."
              onChange={(e) => setForm((f) => ({ ...f, startingPosition: e.target.value }))}
              data-testid="input-starting-position"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Strategic focus — what the engagement set out to do</label>
              <textarea
                className={inputAreaCls}
                value={form.strategicFocus}
                placeholder="e.g. Win the comparison prompts that drive purchase decisions in their category."
                onChange={(e) => setForm((f) => ({ ...f, strategicFocus: e.target.value }))}
                data-testid="input-strategic-focus"
              />
            </div>
            <div>
              <label className={labelCls}>Context notes — anything that frames the story</label>
              <textarea
                className={inputAreaCls}
                value={form.contextNotes}
                placeholder="Constraints, market shifts, team context…"
                onChange={(e) => setForm((f) => ({ ...f, contextNotes: e.target.value }))}
                data-testid="input-context-notes"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-[12px] text-slate-quiet">
              This framing anchors every generated revision. Metrics always come from recorded
              tracking data, never from this text.
            </p>
            <button
              onClick={handleSaveContext}
              disabled={!dirty || saveContext.isPending}
              className="h-9 px-4 bg-primary text-primary-foreground text-[13px] font-medium rounded-full disabled:opacity-40 shrink-0"
              data-testid="button-save-context"
            >
              {saveContext.isPending ? "Saving…" : dirty ? "Save context" : "Saved"}
            </button>
          </div>
        </div>
      </section>

      {/* ── Value highlights from the latest revision's evidence snapshot ── */}
      {latest && (
        <section className="space-y-3">
          <h2 className="text-[13px] font-medium text-foreground tracking-wide uppercase">
            Evidence Behind the Story
            <span className="ml-2 normal-case font-normal text-slate-quiet tracking-normal">
              measured {latest.periodStart ? `${fmtDate(latest.periodStart)} – ${fmtDate(latest.periodEnd)}` : "—"}
            </span>
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Highlight
              label="Visibility then"
              value={latest.evidence.earliest?.visibilityPct != null ? `${latest.evidence.earliest.visibilityPct}%` : "—"}
              sub={latest.evidence.earliest ? `${fmtDate(latest.evidence.earliest.start)} – ${fmtDate(latest.evidence.earliest.end)}` : "not yet measured"}
            />
            <Highlight
              label="Visibility now"
              value={latest.evidence.latest?.visibilityPct != null ? `${latest.evidence.latest.visibilityPct}%` : "—"}
              sub={latest.evidence.latest ? `${fmtDate(latest.evidence.latest.start)} – ${fmtDate(latest.evidence.latest.end)}` : "not yet measured"}
            />
            <Highlight
              label="Tracked runs"
              value={latest.evidence.totalRuns.toLocaleString()}
              sub={`${latest.evidence.activePrompts} active prompts`}
            />
            <Highlight
              label="Strategy actions"
              value={String(latest.evidence.actionsLive + latest.evidence.actionsInProgress)}
              sub={`${latest.evidence.actionsLive} live · ${latest.evidence.actionsInProgress} in progress`}
            />
          </div>
          {latest.evidence.gaps.length > 0 && (
            <div data-testid="panel-evidence-gaps" className="rounded-xl border border-border bg-fog px-4 py-3">
              <div className="text-[11px] font-medium text-ash uppercase tracking-wider mb-1.5">
                Honest gaps in the record
              </div>
              <ul className="space-y-1">
                {latest.evidence.gaps.map((g, i) => (
                  <li key={i} className="text-[12px] text-slate-quiet flex gap-2">
                    <span className="text-smoke">•</span>
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── The story ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-foreground tracking-wide uppercase">The Story</h2>
          {latest && (
            <span className="text-[12px] text-slate-quiet">
              Revision {latest.revisionNumber} · {latest.kind === "baseline" ? "Baseline" : "Refresh"} · {fmtDate(latest.createdAt)}
            </span>
          )}
        </div>

        {!latest && !activeJob && (
          <div className="m1-card p-10 text-center flex flex-col items-center" data-testid="panel-first-use">
            <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center mb-4">
              <BookOpen className="w-5 h-5 text-slate-quiet" />
            </div>
            <h3 className="steep-heading text-[16px]">No story yet</h3>
            <p className="text-[13px] text-slate-quiet mt-1 mb-2 max-w-md">
              {hasContext
                ? "Generate the baseline to capture where this client stands today. Every later refresh is preserved as a dated revision, so the story's development is never lost."
                : "Start by writing the client's starting position and strategic focus above, then generate the baseline story."}
            </p>
            <p className="text-[12px] text-smoke mb-6 max-w-md">
              The story gets stronger with recorded activity: tracking runs, deployed strategy
              actions, and weekly measurements all become evidence it can cite.
            </p>
            {!data.generationAvailable ? (
              <p className="text-[12px] text-negative" data-testid="text-generation-unavailable">
                Story generation is unavailable — the model API key is not configured.
              </p>
            ) : (
              <button
                onClick={handleRefresh}
                disabled={startRefresh.isPending}
                className="m1-btn"
                data-testid="button-generate-baseline"
              >
                {startRefresh.isPending ? "Starting…" : "Generate baseline story"}
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </button>
            )}
          </div>
        )}

        {activeJob && (
          <div className="m1-card p-6 flex items-center gap-4" data-testid="panel-job-progress">
            <Loader2 className="w-5 h-5 animate-spin text-slate-quiet shrink-0" />
            <div>
              <div className="text-[13px] font-medium text-foreground">
                {STAGE_LABELS[activeJob.stage] ?? "Working…"}
              </div>
              <div className="text-[12px] text-slate-quiet mt-0.5">
                Runs in the background — you can leave this page. The last saved story stays
                untouched until the new revision is ready.
              </div>
            </div>
          </div>
        )}

        {latest && (
          <div className="m1-card overflow-hidden" data-testid="panel-latest-story">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border bg-fog">
              <div className="flex items-center gap-2">
                {latest.approvedAt ? (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--positive-surface)] text-positive uppercase tracking-wider flex items-center gap-1">
                    <Check className="w-3 h-3" /> Approved {fmtDate(latest.approvedAt)}
                  </span>
                ) : (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-mist text-ash uppercase tracking-wider">
                    Awaiting review
                  </span>
                )}
                {latest.editedNarrative && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-mist text-ash uppercase tracking-wider">
                    Edited
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {editingId !== latest.id && (
                  <>
                    <button
                      onClick={() => {
                        setEditingId(latest.id);
                        setEditText(displayNarrative(latest));
                      }}
                      className="h-8 px-3 text-[12px] font-medium rounded-full border border-border flex items-center gap-1.5 hover:bg-fog"
                      data-testid="button-edit-story"
                    >
                      <Pencil className="w-3 h-3" /> Edit wording
                    </button>
                    <button
                      onClick={() => handleApprove(latest, !latest.approvedAt)}
                      disabled={updateRevision.isPending}
                      className="h-8 px-3 text-[12px] font-medium rounded-full border border-border flex items-center gap-1.5 hover:bg-fog disabled:opacity-50"
                      data-testid="button-approve-story"
                    >
                      <Check className="w-3 h-3" /> {latest.approvedAt ? "Unapprove" : "Approve"}
                    </button>
                    <button
                      onClick={() => handleCopy(latest)}
                      className="h-8 px-3 text-[12px] font-medium rounded-full bg-primary text-primary-foreground flex items-center gap-1.5"
                      data-testid="button-copy-story"
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                  </>
                )}
              </div>
            </div>
            {editingId === latest.id ? (
              <div className="p-4 sm:p-6 space-y-3">
                <textarea
                  className="w-full min-h-[320px] px-3 py-2 text-[13px] leading-relaxed bg-paper border border-border rounded-lg outline-none focus:border-foreground resize-y"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  data-testid="input-edit-story"
                />
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => {
                      setEditText(latest.narrative);
                    }}
                    className="text-[12px] font-medium text-slate-quiet underline underline-offset-2"
                    data-testid="button-revert-generated"
                  >
                    Revert to generated wording
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="h-8 px-3 text-[12px] font-medium rounded-full border border-border flex items-center gap-1"
                      data-testid="button-cancel-edit"
                    >
                      <X className="w-3 h-3" /> Cancel
                    </button>
                    <button
                      onClick={() => handleSaveEdit(latest.id)}
                      disabled={updateRevision.isPending}
                      className="h-8 px-4 text-[12px] font-medium rounded-full bg-primary text-primary-foreground disabled:opacity-50"
                      data-testid="button-save-edit"
                    >
                      {updateRevision.isPending ? "Saving…" : "Save wording"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <Narrative text={displayNarrative(latest)} />
            )}
          </div>
        )}
      </section>

      {/* ── Revision timeline ── */}
      {revisions.length > 1 && (
        <section className="space-y-3">
          <h2 className="text-[13px] font-medium text-foreground tracking-wide uppercase flex items-center gap-2">
            <History className="w-4 h-4 text-slate-quiet" /> How the Story Has Developed
          </h2>
          <div className="m1-card divide-y divide-border overflow-hidden">
            {revisions.slice(1).map((r) => (
              <div key={r.id} data-testid={`row-revision-${r.revisionNumber}`}>
                <button
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-fog transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 text-slate-quiet shrink-0 transition-transform",
                        expandedId === r.id ? "" : "-rotate-90",
                      )}
                    />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-foreground">
                        Revision {r.revisionNumber} · {r.kind === "baseline" ? "Baseline" : "Refresh"}
                      </div>
                      <div className="text-[12px] text-slate-quiet">
                        {fmtDate(r.createdAt)} · evidence {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)} ·{" "}
                        {r.evidence.totalRuns} runs on record
                        {r.approvedAt ? " · approved" : ""}
                        {r.editedNarrative ? " · edited" : ""}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleCopy(r);
                    }}
                    className="h-7 px-2.5 text-[11px] font-medium rounded-full border border-border shrink-0 hover:bg-mist"
                    data-testid={`button-copy-revision-${r.revisionNumber}`}
                  >
                    Copy
                  </button>
                </button>
                {expandedId === r.id && (
                  <div className="border-t border-border bg-fog/50">
                    <Narrative text={displayNarrative(r)} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[12px] text-slate-quiet">
            Earlier revisions are preserved exactly as written, with the evidence they were
            grounded in — the client's history is never rewritten.
          </p>
        </section>
      )}
    </div>
  );
}

function RefreshControl({
  activeJob,
  generationAvailable,
  pending,
  onRefresh,
}: {
  activeJob: { status: string } | null;
  generationAvailable: boolean;
  pending: boolean;
  onRefresh: () => void;
}) {
  if (activeJob) {
    return (
      <span className="h-9 px-4 text-[13px] font-medium rounded-full border border-border flex items-center gap-2 text-slate-quiet shrink-0">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing…
      </span>
    );
  }
  if (!generationAvailable) {
    return (
      <span className="text-[12px] text-slate-quiet flex items-center gap-1.5 shrink-0" data-testid="text-refresh-unavailable">
        <AlertCircle className="w-3.5 h-3.5" /> Generation unavailable — model key missing
      </span>
    );
  }
  return (
    <button
      onClick={onRefresh}
      disabled={pending}
      className="h-9 px-4 bg-primary text-primary-foreground text-[13px] font-medium rounded-full flex items-center gap-2 disabled:opacity-50 shrink-0"
      data-testid="button-refresh-story"
    >
      <RefreshCw className={cn("w-3.5 h-3.5", pending && "animate-spin")} />
      {pending ? "Starting…" : "Refresh story"}
    </button>
  );
}

function Highlight({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-fog border border-border rounded-2xl p-4">
      <div className="text-[11px] font-medium text-ash mb-1 uppercase tracking-wider">{label}</div>
      <div className="text-xl font-medium text-foreground tabular-nums tracking-tight">{value}</div>
      <div className="text-[11px] text-slate-quiet mt-0.5">{sub}</div>
    </div>
  );
}

/** Render plain-text narrative: heading lines become styled section labels. */
function Narrative({ text }: { text: string }) {
  const HEADINGS = new Set([
    "starting position",
    "strategic focus",
    "work undertaken",
    "measured progress",
    "where they stand today",
    "looking ahead",
  ]);
  const blocks = text.split(/\n+/).filter((b) => b.trim().length > 0);
  return (
    <div className="p-4 sm:p-6 space-y-3" data-testid="text-narrative">
      {blocks.map((b, i) =>
        HEADINGS.has(b.trim().toLowerCase().replace(/:$/, "")) ? (
          <div key={i} className="text-[11px] font-medium text-ash uppercase tracking-widest pt-2 first:pt-0">
            {b.trim().replace(/:$/, "")}
          </div>
        ) : (
          <p key={i} className="text-[13px] leading-relaxed text-foreground">
            {b.trim()}
          </p>
        ),
      )}
    </div>
  );
}
