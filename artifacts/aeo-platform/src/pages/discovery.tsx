import { useEffect, useMemo, useState } from "react";
import {
  getGetWebsiteAssessmentQueryKey,
  getListAudienceRecommendationsQueryKey,
  getListCompaniesQueryKey,
  getListPromptsQueryKey,
  type AudienceRecommendation,
  type InferredCompanyProfile,
  type InferredProfileApproval,
  useApproveInferredCompanyProfile,
  useBulkAddAudienceRecommendations,
  useDismissAudienceRecommendation,
  useGetWebsiteAssessment,
  useListAudienceRecommendations,
  useStartWebsiteAssessment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Lightbulb,
  Search,
  Sparkles,
  Target,
  UserRound,
  ExternalLink,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/components/CompanyContext";
import {
  DiscoveryEmptyState,
  DiscoveryScanTrigger,
} from "@/components/discovery/DiscoveryScanTrigger";

interface ProfileDraft {
  targetAudience: string;
  industry: string;
  objective: string;
  productsServices: string;
  positioning: string;
  geography: string;
}

const profileFields: Array<{ key: keyof ProfileDraft; label: string; placeholder: string }> = [
  { key: "targetAudience", label: "Target audience", placeholder: "Who is most likely to buy or influence a purchase?" },
  { key: "industry", label: "Industry", placeholder: "Primary market category" },
  { key: "objective", label: "Primary objective", placeholder: "What should visibility achieve?" },
  { key: "productsServices", label: "Products / services", placeholder: "What the company sells" },
  { key: "positioning", label: "Positioning", placeholder: "How the company is differentiated" },
  { key: "geography", label: "Geography", placeholder: "Markets served" },
];

const emptyProfile: ProfileDraft = {
  targetAudience: "",
  industry: "",
  objective: "",
  productsServices: "",
  positioning: "",
  geography: "",
};

function errorMessage(error: unknown) {
  return (
    (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (error as { data?: { error?: string } })?.data?.error ??
    "Something went wrong. Please try again."
  );
}

function isNotFoundError(error: unknown) {
  const status = (error as { status?: number; response?: { status?: number } })?.response?.status ??
    (error as { status?: number })?.status;
  return status === 404;
}

function toProfileDraft(profile: InferredCompanyProfile): ProfileDraft {
  return {
    targetAudience: profile.targetAudience ?? "",
    industry: profile.industry ?? "",
    objective: profile.objective ?? "",
    productsServices: profile.productsServices ?? "",
    positioning: profile.positioning ?? "",
    geography: profile.geography ?? "",
  };
}

export default function Discovery() {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const assessmentKey = getGetWebsiteAssessmentQueryKey({ companyId });
  const recommendationParams = { companyId, status: "all" as const };
  const recommendationsKey = getListAudienceRecommendationsQueryKey(recommendationParams);
  const assessmentQuery = useGetWebsiteAssessment(
    { companyId },
    {
      query: {
        queryKey: assessmentKey,
        refetchInterval: (query) => {
          const status = query.state.data?.job.status;
          return status === "running"
            ? 3000
            : false;
        },
        retry: (failureCount, error) => !isNotFoundError(error) && failureCount < 3,
      },
    },
  );

  const recommendationsQuery = useListAudienceRecommendations(
    recommendationParams,
    { query: { queryKey: recommendationsKey } },
  );

  const startAssessment = useStartWebsiteAssessment();
  const approveProfile = useApproveInferredCompanyProfile();
  const dismissRecommendation = useDismissAudienceRecommendation();
  const bulkAdd = useBulkAddAudienceRecommendations();

  const assessment = assessmentQuery.data;
  const assessmentStatus = assessment?.job.status ?? "idle";
  const assessmentPhase = assessment?.job.phase;
  const assessmentError = assessment?.job.error ?? "";
  const inferred = assessment?.profile;
  const profileApproved = inferred?.status === "approved";
  const savedAssessmentDate = assessment?.audit?.generatedAt
    ?? inferred?.approvedAt
    ?? assessment?.job.finishedAt
    ?? inferred?.createdAt
    ?? assessment?.job.createdAt;
  const recommendations = recommendationsQuery.data ?? [];

  const [profile, setProfile] = useState<ProfileDraft>(emptyProfile);
  const [profileSeed, setProfileSeed] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [topicFilter, setTopicFilter] = useState("all");
  const [intentFilter, setIntentFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [groupByTopic, setGroupByTopic] = useState(false);

  useEffect(() => {
    setSelected(new Set());
    setTopicFilter("all");
    setIntentFilter("all");
    setSearch("");
    setGroupByTopic(false);
    setProfile(emptyProfile);
    setProfileSeed("");
  }, [companyId]);

  useEffect(() => {
    const seed = JSON.stringify(inferred);
    if (inferred && seed !== profileSeed) {
      setProfile(toProfileDraft(inferred));
      setProfileSeed(seed);
    }
  }, [inferred, profileSeed]);

  const topics = useMemo(
    () => Array.from(new Set(recommendations.map((item) => item.moneyTopic))).sort(),
    [recommendations],
  );
  const intents = useMemo(
    () => Array.from(new Set(recommendations.map((item) => item.intent))).sort(),
    [recommendations],
  );
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return recommendations.filter(
      (item) =>
        item.status !== "dismissed" &&
        (topicFilter === "all" || item.moneyTopic === topicFilter) &&
        (intentFilter === "all" || item.intent === intentFilter) &&
        (!query ||
          [item.question, item.moneyTopic, item.persona, item.rationale].some((value) =>
            value.toLowerCase().includes(query),
          )),
    );
  }, [recommendations, topicFilter, intentFilter, search]);

  const pendingVisible = visible.filter((item) => !["added", "tracked"].includes(item.status));
  const trackedCount = visible.length - pendingVisible.length;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: assessmentKey });
    queryClient.invalidateQueries({ queryKey: recommendationsKey });
  };

  const handleRescan = () => {
    startAssessment.mutate(
      { params: { companyId } },
      {
        onSuccess: () => {
          refresh();
          toast({
            title: "Website rescan started",
            description: "Your saved assessment and questions remain available while new results are generated.",
          });
        },
        onError: (error) =>
          toast({ title: "Could not start website rescan", description: errorMessage(error), variant: "destructive" }),
      },
    );
  };

  const handleApprove = () => {
    if (!inferred) return;
    const data: InferredProfileApproval = {
      profileId: inferred.id,
      targetAudience: profile.targetAudience || null,
      industry: profile.industry || null,
      objective: profile.objective || null,
      productsServices: profile.productsServices || null,
      positioning: profile.positioning || null,
      geography: profile.geography || null,
    };
    approveProfile.mutate(
      { params: { companyId }, data },
      {
        onSuccess: () => {
          refresh();
          queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey({ days: 30 }) });
          toast({ title: "Audience context approved" });
        },
        onError: (error) =>
          toast({ title: "Could not approve audience context", description: errorMessage(error), variant: "destructive" }),
      },
    );
  };

  const handleDismiss = (id: number) => {
    dismissRecommendation.mutate(
      { id, params: { companyId } },
      {
        onSuccess: refresh,
        onError: (error) =>
          toast({ title: "Could not dismiss recommendation", description: errorMessage(error), variant: "destructive" }),
      },
    );
  };

  const handleBulkAdd = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await bulkAdd.mutateAsync({ params: { companyId }, data: { recommendationIds: ids } });
      setSelected(new Set());
      refresh();
      queryClient.invalidateQueries({ queryKey: getListPromptsQueryKey({ companyId }) });
      toast({ title: `${ids.length} question${ids.length === 1 ? "" : "s"} added to tracking` });
    } catch (error) {
      refresh();
      toast({ title: "Some questions could not be added", description: errorMessage(error), variant: "destructive" });
    }
  };

  const isStarting = startAssessment.isPending;
  const isRunning = assessmentStatus === "running" || isStarting;
  const isFailed = assessmentStatus === "failed" && !isStarting;
  const isIdle = !isRunning && !isFailed;
  const activeAssessment = assessmentStatus === "running";
  const failedAssessment = assessmentStatus === "failed";

  const [displayProgress, setDisplayProgress] = useState(0);
  const [hasReachedResearch, setHasReachedResearch] = useState(false);

  useEffect(() => {
    if (activeAssessment) {
      const crawlProgress = assessment?.job?.totalPages
        ? Math.round(
            (((assessment.job.fetchedPages ?? 0) + (assessment.job.failedPages ?? 0)) /
              assessment.job.totalPages) *
              100,
          )
        : 0;
      const phase = assessment?.job?.phase;
      if (phase === "researching") {
        setHasReachedResearch(true);
      }

      let nextProgress = 4;
      if (phase === "crawling") nextProgress = 8 + Math.round(Math.min(100, crawlProgress) * 0.44);
      if (phase === "analyzing") nextProgress = hasReachedResearch ? 84 : 60;
      if (phase === "researching") nextProgress = 72;
      if (phase === "saving") nextProgress = 94;
      if (phase === "done") nextProgress = 100;

      setDisplayProgress((current) => Math.max(current, nextProgress));
    } else {
      setDisplayProgress(0);
      setHasReachedResearch(false);
    }
  }, [
    activeAssessment,
    assessment?.job?.phase,
    assessment?.job?.totalPages,
    assessment?.job?.fetchedPages,
    assessment?.job?.failedPages,
    hasReachedResearch,
  ]);

  return (
    <div className="mx-auto max-w-[1240px] space-y-8 p-4 sm:p-8 m1-stagger visible">
      <header className="flex flex-col gap-4 rounded-[16px] border border-border bg-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h1 className="font-serif text-2xl font-normal tracking-tight text-ink">Audience Intelligence</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-slate-quiet">
            Identify your target audiences and discover the questions they actually ask general LLMs. Track strategically important money topics to monitor visibility.
          </p>
        </div>

        {recommendations.length > 0 && (
          <div className="flex shrink-0">
            <DiscoveryScanTrigger
              isIdle={isIdle}
              isRunning={isRunning}
              isFailed={isFailed}
              phase={isStarting ? undefined : assessmentPhase}
              progress={displayProgress}
              error={assessmentError}
              onStart={handleRescan}
              disabled={startAssessment.isPending || activeAssessment}
            />
          </div>
        )}
      </header>

      {assessment && !assessmentQuery.isLoading && (
        <section
          className="flex flex-col gap-3 rounded-[16px] border border-border bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          aria-label="Saved assessment status"
          data-testid="status-saved-assessment"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${failedAssessment ? "text-slate-quiet" : activeAssessment ? "text-sienna" : "text-positive"}`} />
            <div>
              <p className="text-[13px] font-semibold text-ink">
                Saved assessment
                {savedAssessmentDate ? ` · ${formatAssessmentDate(savedAssessmentDate)}` : ""}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-quiet">
                {activeAssessment
                  ? "Rescan in progress. Your previously saved audience context and questions remain available until new results are ready."
                  : failedAssessment
                    ? "Last rescan failed. Previously saved audience context and questions are unchanged."
                    : profileApproved
                      ? "Status: audience context approved. Scan again only when the website or positioning has materially changed."
                      : inferred
                        ? "Status: audience context awaiting approval."
                        : "Status: scan completed; no audience context was saved."}
              </p>
            </div>
          </div>
          {!activeAssessment && (
            <span className="shrink-0 rounded-full bg-mist px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-quiet">
              {failedAssessment ? "Previous results retained" : profileApproved ? "Approved" : inferred ? "Review needed" : "Completed"}
            </span>
          )}
        </section>
      )}

      {inferred && !activeAssessment && (
        <section className="overflow-hidden rounded-[24px] border border-border bg-paper shadow-sm" data-testid="panel-inferred-profile">
          <div className={`border-b p-6 sm:px-8 sm:py-7 ${profileApproved ? "border-border/50 bg-fog/30" : "border-border bg-white"}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="font-serif text-[20px] font-normal tracking-tight text-ink">
                    {profileApproved ? "Approved Audience Context" : "Confirm Audience Context"}
                  </h2>
                  {profileApproved && (
                    <span className="flex items-center gap-1.5 rounded-full bg-positive/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-positive">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approved
                    </span>
                  )}
                </div>
                <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-slate-quiet">
                  {profileApproved
                    ? "This contextual foundation guides which questions are recommended. It is currently locked."
                    : "Edit any misunderstandings before approving. Recommendations use this context to discover exactly what your audience is asking."}
                </p>
              </div>
              {!profileApproved && (
                <button onClick={handleApprove} disabled={approveProfile.isPending} className="inline-flex h-10 items-center justify-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white transition-all hover:bg-ink/90 disabled:opacity-50" data-testid="button-approve-profile">
                  {approveProfile.isPending ? "Saving..." : "Approve context"}
                </button>
              )}
            </div>
          </div>

          <div className="p-6 sm:p-8">
            {profileApproved ? (
              <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2" data-testid="summary-approved-profile">
                {profileFields.map((field) =>
                  profile[field.key] ? (
                    <div key={field.key} className={field.key === "targetAudience" || field.key === "positioning" ? "sm:col-span-2" : ""}>
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-slate-quiet/80">{field.label}</span>
                      <p className="text-[14.5px] leading-relaxed text-ink">{profile[field.key]}</p>
                    </div>
                  ) : null,
                )}
              </div>
            ) : (
              <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
                {profileFields.map((field) => (
                  <label key={field.key} className={field.key === "targetAudience" || field.key === "positioning" ? "sm:col-span-2 flex flex-col" : "flex flex-col"}>
                    <span className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-quiet">{field.label}</span>
                    <textarea
                      value={profile[field.key]}
                      onChange={(event) => setProfile((current) => ({ ...current, [field.key]: event.target.value }))}
                      placeholder={field.placeholder}
                      rows={field.key === "targetAudience" || field.key === "positioning" ? 3 : 2}
                      className="w-full resize-y rounded-[14px] border border-border bg-fog px-4 py-3 text-[14px] leading-relaxed outline-none transition-colors focus:border-sienna focus:bg-white focus:ring-1 focus:ring-sienna"
                      data-testid={`input-inferred-${field.key}`}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="font-serif text-[22px] font-normal tracking-tight text-ink">Suggested Questions</h2>
            <p className="mt-1.5 text-[14px] text-slate-quiet" data-testid="text-recommendation-count">
              {pendingVisible.length} available{trackedCount > 0 ? ` · ${trackedCount} already tracked` : ""}
            </p>
          </div>
          {recommendations.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1 sm:flex-none">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-quiet" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search questions & research..." className="h-10 w-full rounded-full border border-border bg-white pl-10 pr-4 text-[13px] outline-none transition-colors focus:border-sienna focus:ring-1 focus:ring-sienna" data-testid="input-search-recommendations" />
            </div>
            <FilterSelect value={topicFilter} onChange={setTopicFilter} label="All money topics" values={topics} testId="select-topic-filter" />
            <FilterSelect value={intentFilter} onChange={setIntentFilter} label="All intents" values={intents} testId="select-intent-filter" />
            <button onClick={() => setGroupByTopic((value) => !value)} className={`flex h-10 items-center justify-center rounded-full border px-4 text-[13px] font-semibold transition-colors ${groupByTopic ? "border-sienna bg-blush/30 text-sienna" : "border-border bg-white text-ink hover:bg-mist"}`} data-testid="button-group-by-topic">
              {groupByTopic ? "Grouped by topic" : "Group by topic"}
            </button>
            </div>
          )}
        </div>

        {selected.size > 0 && (
          <div className="sticky top-4 z-20 flex items-center justify-between gap-4 rounded-[16px] border border-sienna/20 bg-sienna px-5 py-4 text-white shadow-xl shadow-sienna/10" data-testid="toolbar-bulk-selection">
            <span className="text-[14px] font-semibold">{selected.size} question{selected.size === 1 ? "" : "s"} selected</span>
            <div className="flex items-center gap-4">
              <button onClick={() => setSelected(new Set())} className="text-[13px] font-medium text-blush hover:text-white transition-colors" data-testid="button-clear-selection">Clear selection</button>
              <button onClick={handleBulkAdd} disabled={bulkAdd.isPending} className="rounded-full bg-white px-5 py-2 text-[13px] font-bold text-sienna transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100" data-testid="button-bulk-add-prompts">
                {bulkAdd.isPending ? "Adding..." : "Track selected"}
              </button>
            </div>
          </div>
        )}

        {recommendationsQuery.isLoading ? (
          <div className="grid gap-5 md:grid-cols-2">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-64 animate-pulse rounded-[24px] bg-mist" />)}
          </div>
        ) : recommendationsQuery.isError ? (
          <EmptyState icon={AlertCircle} title="Questions couldn't load" body="Your saved suggestions are safe. Refresh the list or try regenerating." action="Retry" onAction={() => recommendationsQuery.refetch()} />
        ) : visible.length === 0 ? (
          recommendations.length ? (
            <EmptyState
              icon={Lightbulb}
              title="No questions match these filters"
              body="Clear a filter or search term to see more questions."
              action="Clear filters"
              onAction={() => {
                setSearch("");
                setTopicFilter("all");
                setIntentFilter("all");
              }}
            />
          ) : (
            <DiscoveryEmptyState
              hasFailed={failedAssessment}
              isIdle={isIdle}
              isRunning={isRunning}
              isFailed={isFailed}
              phase={isStarting ? undefined : assessmentPhase}
              progress={displayProgress}
              error={assessmentError}
              onStart={handleRescan}
              disabled={startAssessment.isPending || activeAssessment}
            />
          )
        ) : (
          <RecommendationGrid
            items={visible}
            selected={selected}
            setSelected={setSelected}
            onDismiss={handleDismiss}
            dismissing={dismissRecommendation.isPending}
            groupByTopic={groupByTopic}
          />
        )}
      </section>
    </div>
  );
}

function formatAssessmentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function FilterSelect({ value, onChange, label, values, testId }: { value: string; onChange: (value: string) => void; label: string; values: string[]; testId: string }) {
  return (
    <div className="relative">
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 appearance-none rounded-full border border-border bg-white pl-4 pr-9 text-[13px] font-semibold text-ink outline-none transition-colors focus:border-sienna focus:ring-1 focus:ring-sienna" data-testid={testId}>
        <option value="all">{label}</option>
        {values.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-3.5 h-3.5 w-3.5 text-slate-quiet" />
    </div>
  );
}

function RecommendationGrid({ items, selected, setSelected, onDismiss, dismissing, groupByTopic }: { items: AudienceRecommendation[]; selected: Set<number>; setSelected: (value: Set<number>) => void; onDismiss: (id: number) => void; dismissing: boolean; groupByTopic: boolean }) {
  const groups = groupByTopic
    ? Array.from(new Set(items.map((item) => item.moneyTopic))).map((topic) => ({ topic, items: items.filter((item) => item.moneyTopic === topic) }))
    : [{ topic: "", items }];
  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <div key={group.topic || "all"} className="space-y-4">
          {group.topic && <h3 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-sienna"><CircleDollarSign className="h-4 w-4" />Money topic: {group.topic} <span className="ml-1 rounded-full bg-sienna/10 px-2 py-0.5 text-[10px] text-sienna">{group.items.length}</span></h3>}
          <div className="grid gap-5 md:grid-cols-2">
            {group.items.map((item) => {
              const tracked = ["added", "tracked"].includes(item.status);
              const checked = selected.has(item.id);
              return (
                <article key={item.id} className={`flex flex-col overflow-hidden rounded-[24px] border bg-white transition-all duration-300 hover:shadow-md ${checked ? "border-sienna ring-1 ring-sienna" : "border-border hover:border-sienna/40"}`} data-testid={`card-recommendation-${item.id}`}>

                  <div className="flex flex-1 flex-col p-6 sm:p-7 gap-5">
                    <div className="space-y-2">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-sienna">
                        <Sparkles className="h-3 w-3" />
                        What the audience asks an LLM
                      </span>
                      <h3 className="text-[17px] font-semibold leading-snug text-ink" data-testid={`text-recommendation-question-${item.id}`}>{item.question}</h3>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge icon={CircleDollarSign}>Money topic: {item.moneyTopic}</Badge>
                      <Badge icon={UserRound}>Target audience: {item.persona}</Badge>
                      <Badge icon={Target}>{item.intent}</Badge>
                    </div>

                    {item.researchEvidence && item.researchEvidence.length > 0 && (
                      <div className="rounded-[12px] border border-border/60 bg-fog/50 p-4">
                        <h4 className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-quiet">
                          <Search className="h-3 w-3" />
                          Community Research
                        </h4>
                        <ul className="space-y-2.5">
                          {item.researchEvidence.map((ev, i) => (
                            <li key={i} className="text-[13px] leading-tight">
                              <a href={ev.url} target="_blank" rel="noopener noreferrer" className="group inline-flex items-baseline gap-1 text-ink transition-colors hover:text-sienna">
                                <span className="font-medium underline decoration-border underline-offset-4 group-hover:decoration-sienna">{ev.title}</span>
                                <ExternalLink className="h-3 w-3 shrink-0 text-slate-quiet group-hover:text-sienna" />
                              </a>
                              <span className="ml-1.5 whitespace-nowrap text-slate-quiet">— {ev.platform}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <p className="mt-auto pt-2 text-[13.5px] leading-relaxed text-slate-quiet" data-testid={`text-recommendation-rationale-${item.id}`}>{item.rationale}</p>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-border bg-fog/40 p-4 sm:px-7">
                    <label className={`group flex cursor-pointer items-center gap-3 rounded-full py-1 pr-3 transition-colors ${tracked ? "cursor-default" : "hover:bg-sienna/5"}`}>
                      <input type="checkbox" className="sr-only" checked={checked} onChange={() => {
                        if (tracked) return;
                        const next = new Set(selected);
                        checked ? next.delete(item.id) : next.add(item.id);
                        setSelected(next);
                      }} disabled={tracked} />
                      <div className={`flex h-6 w-6 items-center justify-center rounded-[6px] border transition-all ${checked ? "border-sienna bg-sienna text-white" : tracked ? "border-positive bg-positive text-white" : "border-smoke bg-white group-hover:border-sienna/50"}`}>
                        {(checked || tracked) && <Check className="h-4 w-4" />}
                      </div>
                      <span className={`text-[13.5px] font-bold ${tracked ? "text-positive" : checked ? "text-sienna" : "text-ink group-hover:text-sienna"}`}>
                        {tracked ? "Tracked" : "Track"}
                      </span>
                    </label>

                    {!tracked && (
                      <button onClick={() => onDismiss(item.id)} disabled={dismissing} className="rounded-full px-4 py-1.5 text-[13px] font-semibold text-slate-quiet transition-colors hover:bg-negative-surface hover:text-negative disabled:opacity-50" data-testid={`button-dismiss-recommendation-${item.id}`}>
                        Dismiss
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Badge({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-quiet shadow-sm"><Icon className="h-3 w-3" />{children}</span>;
}

function EmptyState({ icon: Icon, title, body, action, onAction }: { icon: LucideIcon; title: string; body: string; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-border py-20 text-center" data-testid="status-recommendations-empty">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-mist text-slate-quiet">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="font-serif text-[20px] font-normal text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-slate-quiet">{body}</p>
      <button onClick={onAction} className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-ink px-6 text-[13.5px] font-semibold text-white transition-transform hover:scale-105 active:scale-95" data-testid="button-empty-state-action">{action}</button>
    </div>
  );
}
