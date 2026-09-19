import { useMemo, useState, useEffect } from "react";
import {
  useListStrategyIdeas,
  useDeployStrategyIdea,
  usePromoteGapFinding,
  useGetGapResearchReport,
  useGetCompanyPlaybook,
  getListStrategyItemsQueryKey,
  getListStrategyIdeasQueryKey,
  getGetCompanyPlaybookQueryKey,
  getGetGapResearchReportQueryKey,
  type StrategyIdea,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Rocket, Sparkles, ExternalLink, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { useFormDraft } from "@/hooks/use-form-draft";
import {
  getRecommendationSupportingEvidence,
  selectDeploymentFinding,
} from "@/lib/actionResearchEvidence";

const PRIORITY_STYLES: Record<string, string> = {
  P0: "bg-rose-50 text-rose-700",
  P1: "bg-amber-50 text-amber-700",
  P2: "bg-slate-100 text-slate-600",
};

function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export interface StrategyIdeaPreset {
  title: string;
  category: "on_page" | "off_page";
  playType: string;
  description: string;
  rationale: string;
  priority: "P0" | "P1" | "P2";
}

interface DeployIdeaDialogProps {
  companyId: number;
  /** Restrict the picker to one category (on_page | off_page). */
  category?: "on_page" | "off_page";
  triggerLabel?: string;
  triggerClassName?: string;
  initialIdeaTitle?: string;
  initialFindingId?: number;
  /** When false, never infer a different research finding from the idea title. */
  allowFindingFallback?: boolean;
  initialCustomIdea?: StrategyIdeaPreset;
}

export function DeployIdeaDialog({
  companyId,
  category,
  triggerLabel = "Deploy Idea",
  triggerClassName,
  initialIdeaTitle,
  initialFindingId,
  allowFindingFallback = true,
  initialCustomIdea,
}: DeployIdeaDialogProps) {
  const [open, setOpen] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [mode, setMode] = useState<"library" | "custom">("library");

  // Library mode state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<StrategyIdea | null>(null);
  // If a draft is restored before the ideas query resolves, remember the
  // selected idea ID and apply it once ideas arrive so the selection is
  // never silently dropped.
  const [pendingRestoreIdeaId, setPendingRestoreIdeaId] = useState<number | null>(null);

  // Custom mode state
  const [customTitle, setCustomTitle] = useState("");
  const [customCategory, setCustomCategory] = useState<"on_page" | "off_page">(category ?? "on_page");
  const [customPlayType, setCustomPlayType] = useState("");
  const [customPriority, setCustomPriority] = useState<"P0" | "P1" | "P2">("P1");
  const [customDescription, setCustomDescription] = useState("");
  const [customRationale, setCustomRationale] = useState("");

  // Action brief state
  const [actionAngle, setActionAngle] = useState("");
  const [actionAngleEdited, setActionAngleEdited] = useState(false);
  const [targetAudience, setTargetAudience] = useState("");
  const [proofPoint, setProofPoint] = useState("");
  const [owner, setOwner] = useState("");
  const [successMetric, setSuccessMetric] = useState("");

  // Metadata state
  const [moneyTopicId, setMoneyTopicId] = useState("");
  const [moneyTopicEdited, setMoneyTopicEdited] = useState(false);
  const [targetDate, setTargetDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (category) setCustomCategory(category);
  }, [category]);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Recoverable draft: unfinished deployment briefs survive close/refresh.
  const draftValue = {
    mode,
    selectedIdeaId: selected?.id ?? pendingRestoreIdeaId ?? null,
    customTitle,
    customCategory,
    customPlayType,
    customPriority,
    customDescription,
    customRationale,
    actionAngle,
    actionAngleEdited,
    targetAudience,
    proofPoint,
    owner,
    successMetric,
    moneyTopicId,
    moneyTopicEdited,
    targetDate,
    notes,
  };
  type DeployDraft = typeof draftValue;
  const { recoveredDraft, consumeRecovered, discardDraft, clearAfterSave } =
    useFormDraft<DeployDraft>({
      key: `deploy-idea:${companyId}:${category ?? "any"}`,
      value: draftValue,
      active: open,
      isEmpty: (v) =>
        v.selectedIdeaId === null &&
        !v.customTitle.trim() &&
        !v.customPlayType.trim() &&
        !v.customDescription.trim() &&
        !v.customRationale.trim() &&
        !v.actionAngle.trim() &&
        !v.targetAudience.trim() &&
        !v.proofPoint.trim() &&
        !v.owner.trim() &&
        !v.successMetric.trim() &&
        !v.notes.trim() &&
        !v.targetDate,
    });

  const { data: ideas, isLoading } = useListStrategyIdeas(
    category ? { category } : undefined,
  );
  const { data: playbook } = useGetCompanyPlaybook(companyId, {
    query: {
      enabled: open,
      queryKey: getGetCompanyPlaybookQueryKey(companyId),
    },
  });
  const moneyTopics = playbook?.moneyTopics ?? [];

  const {
    data: reportData,
    isLoading: isResearchLoading,
    isError: isResearchError,
  } = useGetGapResearchReport(
    { companyId },
    { query: { enabled: open, queryKey: getGetGapResearchReportQueryKey({ companyId }) } }
  );

  const matchedFinding = useMemo(() => {
    if (mode === "custom" || !selected || !reportData?.snapshot?.findings) return null;
    return selectDeploymentFinding(
      reportData.snapshot.findings,
      selected,
      initialFindingId,
      allowFindingFallback,
    );
  }, [
    selected,
    reportData,
    mode,
    initialFindingId,
    allowFindingFallback,
  ]);

  const bestEvidence = useMemo(() => {
    return matchedFinding
      ? getRecommendationSupportingEvidence(matchedFinding)
      : null;
  }, [matchedFinding]);
  const surfacedCompetitor = useMemo(
    () =>
      matchedFinding
        ? [...matchedFinding.competitors]
            .filter((competitor) => competitor.runsSurfaced > 0)
            .sort((a, b) => b.runsSurfaced - a.runsSurfaced)[0] ?? null
        : null,
    [matchedFinding],
  );

  useEffect(() => {
    if (mode === "library" && selected) {
      if (!actionAngleEdited) {
        setActionAngle(matchedFinding?.recommendation.title || selected.description || "");
      }
      if (!moneyTopicEdited && matchedFinding?.topic) {
        const matchingTopic = moneyTopics.find(
          (topic) =>
            topic.topic.trim().toLowerCase() ===
            matchedFinding.topic.trim().toLowerCase(),
        );
        setMoneyTopicId(matchingTopic ? String(matchingTopic.id) : "");
      }
    } else if (mode === "custom") {
      if (!actionAngleEdited) {
        setActionAngle(customTitle);
      }
    }
  }, [
    mode,
    selected,
    matchedFinding,
    moneyTopics,
    actionAngleEdited,
    moneyTopicEdited,
    customTitle,
  ]);

  const grouped = useMemo(() => {
    const map = new Map<string, StrategyIdea[]>();
    for (const idea of ideas ?? []) {
      const key = idea.category === "on_page" ? "Onsite plays" : "Offsite plays";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(idea);
    }
    return Array.from(map.entries());
  }, [ideas]);

  const resetForm = () => {
    setMode("library");
    setSelected(null);
    setCustomTitle("");
    setCustomCategory(category ?? "on_page");
    setCustomPlayType("");
    setCustomPriority("P1");
    setCustomDescription("");
    setCustomRationale("");
    setActionAngle("");
    setActionAngleEdited(false);
    setTargetAudience("");
    setProofPoint("");
    setOwner("");
    setSuccessMetric("");
    setMoneyTopicId("");
    setMoneyTopicEdited(false);
    setTargetDate("");
    setNotes("");
  };

  useEffect(() => {
    if (!open || hasInitialized) return;

    if (initialIdeaTitle) {
      if (!ideas) return;
      const foundIdea = ideas.find(
        (idea) => idea.title.toLowerCase() === initialIdeaTitle.toLowerCase(),
      );
      if (foundIdea) {
        setHasInitialized(true);
        setMode("library");
        setSelected(foundIdea);
        return;
      }
    }

    setHasInitialized(true);
    if (initialCustomIdea) {
      setMode("custom");
      setCustomTitle(initialCustomIdea.title);
      setCustomCategory(initialCustomIdea.category);
      setCustomPlayType(initialCustomIdea.playType);
      setCustomDescription(initialCustomIdea.description);
      setCustomRationale(initialCustomIdea.rationale);
      setCustomPriority(initialCustomIdea.priority);
    }
  }, [open, ideas, initialIdeaTitle, initialCustomIdea, hasInitialized]);

  const onOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
      setHasInitialized(false);
    }
  };

  const invalidateData = () => {
    queryClient.invalidateQueries({ queryKey: getListStrategyItemsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStrategyIdeasQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCompanyPlaybookQueryKey(companyId) });
    queryClient.invalidateQueries({ queryKey: getGetGapResearchReportQueryKey({ companyId }) });
  };

  useEffect(() => {
    if (pendingRestoreIdeaId == null || !ideas) return;
    const idea = ideas.find((i) => i.id === pendingRestoreIdeaId);
    if (idea) setSelected(idea);
    setPendingRestoreIdeaId(null);
  }, [pendingRestoreIdeaId, ideas]);
  useEffect(() => {
    if (!open) setPendingRestoreIdeaId(null);
  }, [open]);

  const restoreDraft = () => {
    const d = consumeRecovered();
    if (!d) return;
    setHasInitialized(true);
    setMode(d.mode);
    if (d.selectedIdeaId != null) {
      if (ideas) {
        setSelected(ideas.find((i) => i.id === d.selectedIdeaId) ?? null);
      } else {
        setPendingRestoreIdeaId(d.selectedIdeaId);
      }
    }
    setCustomTitle(d.customTitle);
    setCustomCategory(d.customCategory);
    setCustomPlayType(d.customPlayType);
    setCustomPriority(d.customPriority);
    setCustomDescription(d.customDescription);
    setCustomRationale(d.customRationale);
    setActionAngle(d.actionAngle);
    setActionAngleEdited(d.actionAngleEdited);
    setTargetAudience(d.targetAudience);
    setProofPoint(d.proofPoint);
    setOwner(d.owner);
    setSuccessMetric(d.successMetric);
    setMoneyTopicId(d.moneyTopicId);
    setMoneyTopicEdited(d.moneyTopicEdited);
    setTargetDate(d.targetDate);
    setNotes(d.notes);
  };

  const promoteFinding = usePromoteGapFinding({
    mutation: {
      onSuccess: () => {
        invalidateData();
        clearAfterSave();
        onOpenChange(false);
        toast({ title: "Idea promoted from research" });
      },
      onError: () => toast({ title: "Could not promote idea", variant: "destructive" }),
    }
  });

  const deploy = useDeployStrategyIdea({
    mutation: {
      onSuccess: () => {
        invalidateData();
        clearAfterSave();
        onOpenChange(false);
        toast({ title: "Idea deployed to client" });
      },
      onError: () =>
        toast({ title: "Could not deploy idea", variant: "destructive" }),
    },
  });

  const onSubmit = () => {
    if (!actionAngle.trim()) return;

    const isCustomValid =
      customTitle.trim().length > 0 &&
      customPlayType.trim().length > 0 &&
      customDescription.trim().length > 0 &&
      customRationale.trim().length > 0;

    if (mode === "library" && !selected) return;
    if (mode === "custom" && !isCustomValid) return;

    const selectedTopic = moneyTopics.find(
      (topic) => String(topic.id) === moneyTopicId,
    );

    const effectiveMoneyTopic =
      selectedTopic?.topic ??
      (!moneyTopicEdited ? matchedFinding?.topic : null) ??
      null;

    const brief = {
      actionAngle: actionAngle.trim(),
      targetAudience: targetAudience.trim() || null,
      proofPoint: proofPoint.trim() || null,
      owner: owner.trim() || null,
      successMetric: successMetric.trim() || null,
    };

    const basePayload = {
      companyId,
      moneyTopic: effectiveMoneyTopic,
      moneyTopicId: moneyTopicId ? Number(moneyTopicId) : null,
      notes: notes.trim() || null,
      targetDate: targetDate || null,
      brief,
    };

    if (mode === "library" && selected) {
      if (matchedFinding) {
        promoteFinding.mutate({
          id: matchedFinding.id,
          data: {
            ...basePayload,
            ideaId: selected.id,
            category: selected.category,
          },
        });
      } else {
        deploy.mutate({
          data: {
            ...basePayload,
            ideaId: selected.id,
          },
        });
      }
    } else if (mode === "custom") {
      deploy.mutate({
        data: {
          ...basePayload,
          newIdea: {
            title: customTitle.trim(),
            category: customCategory,
            playType: customPlayType.trim(),
            description: customDescription.trim(),
            rationale: customRationale.trim(),
            priority: customPriority,
          }
        },
      });
    }
  };

  const isPending = deploy.isPending || promoteFinding.isPending;
  const exampleHref = safeHttpUrl(bestEvidence?.canonicalUrl);

  const isCustomValid =
    customTitle.trim().length > 0 &&
    customPlayType.trim().length > 0 &&
    customDescription.trim().length > 0 &&
    customRationale.trim().length > 0;

  const isReadyToDeploy =
    (mode === "library" ? !!selected : isCustomValid) &&
    actionAngle.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button className={cn("m1-btn", triggerClassName)}>
          <Rocket className="w-4 h-4 mr-1.5" /> {triggerLabel}
        </button>
      </DialogTrigger>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden p-4 sm:h-auto sm:max-h-[90vh] sm:max-w-[640px] sm:p-6">
        <DialogHeader className="shrink-0 mb-2">
          <DialogTitle>Deploy a strategy idea</DialogTitle>
        </DialogHeader>

        <div className="flex bg-muted p-1 rounded-md mb-2 w-fit shrink-0">
          <button
            type="button"
            data-testid="button-library-ideas"
            onClick={() => {
              setMode("library");
              setActionAngleEdited(false);
            }}
            className={cn("px-4 py-1.5 text-[13px] font-medium rounded-sm transition-all", mode === 'library' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            Library Ideas
          </button>
          <button
            type="button"
            data-testid="button-new-idea"
            onClick={() => {
              setMode("custom");
              setActionAngleEdited(false);
            }}
            className={cn("px-4 py-1.5 text-[13px] font-medium rounded-sm transition-all", mode === 'custom' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            New Idea
          </button>
        </div>

        {recoveredDraft && (
          <div
            data-testid="banner-draft-recovered"
            className="shrink-0 mb-2 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
          >
            <span className="text-[12px] text-amber-900 font-medium">
              You have an unfinished draft for this form.
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="button-restore-draft"
                className="text-[12px] font-semibold text-amber-900 underline underline-offset-2"
                onClick={restoreDraft}
              >
                Restore
              </button>
              <button
                type="button"
                data-testid="button-discard-draft"
                className="text-[12px] font-medium text-amber-700 hover:text-amber-900"
                onClick={discardDraft}
              >
                Discard
              </button>
            </span>
          </div>
        )}

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-3 -mr-3 space-y-6 pb-2"
          data-testid="scroll-deploy-idea-form"
        >
          {mode === "library" ? (
            <div className="space-y-6">
              <div>
                <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Library Idea
                </label>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid="button-open-idea-library"
                      role="combobox"
                      aria-expanded={pickerOpen}
                      className="w-full flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-[13px] text-left hover:bg-muted/50 transition-colors"
                    >
                      <span
                        className={cn(
                          "truncate",
                          !selected && "text-muted-foreground",
                        )}
                      >
                        {selected
                          ? selected.title
                          : isLoading
                            ? "Loading ideas..."
                            : "Search the Ideas library..."}
                      </span>
                      <ChevronsUpDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] sm:w-[520px] p-0"
                    align="start"
                    side="bottom"
                    avoidCollisions
                  >
                    <Command className="flex max-h-[min(350px,50dvh)] flex-col overflow-hidden">
                      <CommandInput placeholder="Search plays by name or type..." />
                      <CommandList className="overflow-y-auto flex-1">
                        <CommandEmpty>No matching ideas.</CommandEmpty>
                        {grouped.map(([group, groupIdeas]) => (
                          <CommandGroup key={group} heading={group}>
                            {groupIdeas.map((idea) => (
                              <CommandItem
                                key={idea.id}
                                value={`${idea.title} ${idea.playType}`}
                                onSelect={() => {
                                  setSelected(idea);
                                  setActionAngleEdited(false);
                                  setMoneyTopicEdited(false);
                                  setPickerOpen(false);
                                }}
                                className="flex items-start gap-2 py-2.5"
                              >
                                <Check
                                  className={cn(
                                    "w-4 h-4 mt-0.5 shrink-0",
                                    selected?.id === idea.id
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[13px] font-medium truncate">
                                      {idea.title}
                                    </span>
                                    <span
                                      className={cn(
                                        "text-[10px] font-bold px-1.5 py-0.5 rounded-sm shrink-0",
                                        PRIORITY_STYLES[idea.priority],
                                      )}
                                    >
                                      {idea.priority}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-muted-foreground truncate">
                                    {idea.playType}
                                  </div>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {selected && (
                <>
                  {isResearchLoading ? (
                    <div className="rounded-md border border-border bg-muted/30 p-4 flex items-center gap-2 text-[12px] text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Checking this play against the company’s latest tracked AI-answer evidence...
                    </div>
                  ) : isResearchError ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50/50 p-4">
                      <h4 className="text-[13px] font-semibold text-amber-900 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" />
                        Company evidence unavailable
                      </h4>
                      <p className="text-[12px] text-amber-800 mt-1.5 leading-relaxed">
                        We couldn’t check the latest company research. You can still deploy this as an original play, but it will not be presented as evidence-backed.
                      </p>
                    </div>
                  ) : matchedFinding ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-4 space-y-4 shadow-sm">
                      <div>
                        <h4 className="text-[13px] font-semibold text-emerald-900 flex items-center gap-1.5">
                          <Check className="w-4 h-4" />
                          Recommended Action
                        </h4>
                        <p className="text-[13px] text-emerald-800 mt-1.5 leading-relaxed">
                          Based on tracked prompt <strong>"{matchedFinding.promptText}"</strong>. {matchedFinding.recommendation.rationale}
                        </p>
                      </div>

                      {bestEvidence && surfacedCompetitor && (
                        <div className="rounded-md border border-emerald-100 bg-emerald-100/50 p-3">
                          <h5 className="text-[11px] font-semibold text-emerald-900 uppercase tracking-wider mb-1.5">
                            Example surfaced peer
                          </h5>
                          <p className="text-[12px] text-emerald-800/90 leading-relaxed">
                            <strong>{surfacedCompetitor.name || surfacedCompetitor.domain}</strong> surfaced in tracked answers while <strong>{bestEvidence.domain}</strong> was cited {bestEvidence.citationCount} times across {bestEvidence.runCount} answer runs via a {bestEvidence.channel.replace(/_/g, ' ')} source. Use the source as a concrete pattern to study, not proof that it caused the peer’s visibility.
                          </p>
                          {exampleHref && (
                            <a href={exampleHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-2 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 underline underline-offset-2">
                              <ExternalLink className="w-3 h-3" /> View source page
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-4 shadow-sm">
                      <h4 className="text-[13px] font-semibold text-slate-800 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-slate-500" />
                        Original Play
                      </h4>
                      <p className="text-[12px] text-slate-500 mt-1 mb-3">No company-specific precedent on file. This is a proactive strategy.</p>
                      <p className="text-[13px] text-slate-700 leading-relaxed">
                        {selected.description}
                      </p>
                      <p className="text-[13px] text-slate-600 leading-relaxed mt-2">
                        <span className="font-semibold text-slate-700">Why it works:</span> {selected.rationale}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Play Title <span className="text-rose-500">*</span></label>
                  <input
                    data-testid="input-new-idea-title"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                    placeholder="e.g. Add Schema Markup to FAQ"
                    value={customTitle}
                    onChange={(e) => {
                      setCustomTitle(e.target.value);
                      if (!actionAngleEdited) setActionAngle(e.target.value);
                    }}
                  />
                </div>
                <div>
                  <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Category</label>
                  <select
                    data-testid="select-new-idea-category"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-60"
                    value={customCategory}
                    disabled={category !== undefined}
                    onChange={(e) =>
                      setCustomCategory(
                        e.target.value as "on_page" | "off_page",
                      )
                    }
                  >
                    <option value="on_page">Onsite</option>
                    <option value="off_page">Offsite</option>
                  </select>
                </div>
                <div>
                  <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Priority</label>
                  <select
                    data-testid="select-new-idea-priority"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                    value={customPriority}
                    onChange={(e) =>
                      setCustomPriority(e.target.value as "P0" | "P1" | "P2")
                    }
                  >
                    <option value="P0">P0 - Highest</option>
                    <option value="P1">P1 - Medium</option>
                    <option value="P2">P2 - Low</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Play Type <span className="text-rose-500">*</span></label>
                  <input
                    data-testid="input-new-idea-play-type"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                    placeholder="e.g. Content Refresh, FAQ Addition..."
                    value={customPlayType}
                    onChange={(e) => setCustomPlayType(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Description <span className="text-rose-500">*</span></label>
                  <textarea
                    data-testid="input-new-idea-description"
                    rows={2}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] resize-none"
                    placeholder="What does this play involve?"
                    value={customDescription}
                    onChange={(e) => setCustomDescription(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Rationale <span className="text-rose-500">*</span></label>
                  <textarea
                    data-testid="input-new-idea-rationale"
                    rows={2}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] resize-none"
                    placeholder="Why is this expected to drive results?"
                    value={customRationale}
                    onChange={(e) => setCustomRationale(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {((mode === "library" && selected) || mode === "custom") && (
            <div className="space-y-6">
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-[14px] font-semibold text-foreground">Action Brief</h4>

                <div>
                  <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Action Angle <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    data-testid="input-action-angle"
                    value={actionAngle}
                    onChange={(e) => {
                      setActionAngle(e.target.value);
                      setActionAngleEdited(true);
                    }}
                    rows={2}
                    placeholder="Concrete angle for this action..."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] resize-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Target Audience</label>
                    <input
                      value={targetAudience}
                      onChange={e => setTargetAudience(e.target.value)}
                      placeholder="e.g. Enterprise IT buyers"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Proof Point / Data</label>
                    <input
                      value={proofPoint}
                      onChange={e => setProofPoint(e.target.value)}
                      placeholder="e.g. 45% faster deployment"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Success Metric</label>
                    <input
                      value={successMetric}
                      onChange={e => setSuccessMetric(e.target.value)}
                      placeholder="e.g. CTR > 2%"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Owner</label>
                    <input
                      value={owner}
                      onChange={e => setOwner(e.target.value)}
                      placeholder="e.g. Content Team"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-[14px] font-semibold text-foreground">Metadata</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                      Money topic
                    </label>
                    <select
                      data-testid="select-money-topic"
                      value={moneyTopicId}
                      onChange={(e) => {
                        setMoneyTopicId(e.target.value);
                        setMoneyTopicEdited(true);
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                    >
                      <option value="">
                        {moneyTopics.length === 0
                          ? "No topics captured yet"
                          : "No topic (unlinked)"}
                      </option>
                      {moneyTopics.map((topic) => (
                        <option key={topic.id} value={String(topic.id)}>
                          {topic.topic}
                        </option>
                      ))}
                    </select>
                    {moneyTopics.length === 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Capture money topics in Site Lab to link this play to research.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                      Target date
                    </label>
                    <input
                      data-testid="input-target-date"
                      type="date"
                      value={targetDate}
                      onChange={(e) => setTargetDate(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Internal Notes
                  </label>
                  <textarea
                    data-testid="input-internal-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Context or internal references..."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] resize-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t border-border shrink-0 mt-2">
          <button
            type="button"
            data-testid="button-cancel-deploy-idea"
            className="m1-btn m1-btn--outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="button-submit-deploy-idea"
            className="m1-btn"
            disabled={!isReadyToDeploy || isPending}
            onClick={onSubmit}
          >
            {isPending ? "Deploying..." : "Deploy to client"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}