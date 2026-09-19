import { useSearch } from "wouter";
import {
  useListSignals,
  useGetGapResearchReport,
  getGetGapResearchReportQueryKey,
  useListStrategyIdeas,
  useListStrategyItems,
  type Signal,
  type GapResearchFinding,
  type StrategyIdea,
  type StrategyItem,
  type ActionRecommendation,
} from "@workspace/api-client-react";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Info,
  Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompany } from "@/components/CompanyContext";
import { DeployIdeaDialog } from "@/components/strategy/DeployIdeaDialog";
import { StrategyItemsList } from "@/components/strategy/StrategyItemsList";
import { EvidenceSignal } from "@/components/actions/EvidenceSignal";
import { PromptEvidenceDropdown } from "@/components/actions/PromptEvidenceDropdown";
import { getSignalIdeaMapping } from "@/lib/actionResearchEvidence";

export default function Signals() {
  const search = useSearch();
  const categoryRaw = new URLSearchParams(search).get("category");
  const category =
    categoryRaw === "on_page" || categoryRaw === "off_page"
      ? categoryRaw
      : undefined;
  const { companyId } = useCompany();

  const { data: signals, isLoading, isError, refetch } = useListSignals({
    companyId,
    category,
  });

  const {
    data: reportData,
    isLoading: isResearchLoading,
    isError: isResearchError,
  } = useGetGapResearchReport(
    { companyId },
    { query: { queryKey: getGetGapResearchReportQueryKey({ companyId }) } },
  );

  const { data: strategyIdeas } = useListStrategyIdeas(
    category ? { category } : undefined,
  );

  const {
    data: strategyItems,
    isLoading: strategyItemsLoading,
    isError: strategyItemsError,
    isSuccess: strategyItemsReady,
    refetch: refetchStrategyItems,
  } = useListStrategyItems({
    companyId,
    ...(category ? { category } : {}),
  });

  const title =
    category === "on_page"
      ? "Owned · On-page Actions"
      : category === "off_page"
        ? "Earned · Off-page Actions"
        : "All Actions";
  const subtitle =
    category === "on_page"
      ? "Actions on your own site that make your content easier for AI agents to retrieve and cite."
      : category === "off_page"
        ? "Actions on third-party channels that earn your brand presence in AI answers."
        : "Prioritised actions combining established AEO practice with this company's profile, tracked prompts, and verified research.";

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 p-4 sm:p-8 m1-stagger visible">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl steep-heading tracking-tight">{title}</h1>
          <p className="text-[13px] text-slate-quiet mt-1">{subtitle}</p>
        </div>
        <DeployIdeaDialog companyId={companyId} category={category} />
      </div>

      <div className="m1-card overflow-hidden">
        <div className="p-4 border-b border-border bg-fog flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-slate-quiet" />
          <h2 className="text-[13px] steep-heading">Deployed Strategy Plays</h2>
          <span className="text-[11px] text-slate-quiet">from the Ideas library</span>
        </div>
        <StrategyItemsList companyId={companyId} category={category} />
      </div>

      <div className="m1-card overflow-hidden">
        <div className="p-4 border-b border-border bg-fog">
          <div className="hidden grid-cols-[1fr_auto_auto] gap-6 text-[11px] font-medium uppercase tracking-wider text-ash sm:grid">
            <div>Recommended action</div>
            <div className="w-24 text-center">Priority</div>
            <div className="w-32 text-right">Fit status</div>
          </div>
          <p className="text-[11px] text-slate-quiet mt-1.5 normal-case tracking-normal">
            Each card separates the general AEO principle from why it fits this
            company now. <span className="font-medium">Verified research</span>{" "}
            requires an exact Gap Analysis match;{" "}
            <span className="font-medium">Company fit</span> uses profile or
            tracked-prompt context and is not presented as outcome evidence.
          </p>
          {strategyItemsError && (
            <div
              className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--negative-border)] bg-[var(--negative-surface)] px-3 py-2"
              data-testid="status-strategy-items-unavailable"
            >
              <p className="text-[12px] text-negative">
                Strategy status is unavailable. Adding actions is paused to
                prevent duplicates.
              </p>
              <button
                type="button"
                className="m1-btn m1-btn--outline h-7 px-2.5 text-[11px]"
                onClick={() => refetchStrategyItems()}
                data-testid="button-retry-strategy-items"
              >
                Retry
              </button>
            </div>
          )}
        </div>
        
        <div className="divide-y divide-border">
          {isLoading ? (
            <div className="p-8 text-center text-slate-quiet text-[13px]">Loading actions...</div>
          ) : isError ? (
            <div className="p-12 text-center flex flex-col items-center">
              <AlertTriangle className="w-8 h-8 text-negative mb-3" />
              <p className="text-[14px] font-medium text-foreground">Couldn't load actions</p>
              <p className="text-[13px] text-slate-quiet mt-1">
                The request failed. Check the API server and try again.
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="m1-btn m1-btn--outline mt-4"
                data-testid="button-retry-actions"
              >
                Retry
              </button>
            </div>
          ) : signals?.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <Activity className="w-8 h-8 text-smoke mb-3" />
              <p className="text-[14px] font-medium text-foreground">No actions in this category yet</p>
              <p className="text-[13px] text-slate-quiet mt-1">
                {category === "on_page"
                  ? "No on-page actions are catalogued yet."
                  : category === "off_page"
                    ? "No off-page actions are catalogued yet."
                    : "No actions are catalogued yet."}
              </p>
            </div>
          ) : (
            signals?.map((signal) => (
              <SignalRow
                key={signal.id}
                signal={signal}
                findings={reportData?.snapshot?.findings ?? []}
                ideas={strategyIdeas ?? []}
                items={strategyItems ?? []}
                companyId={companyId}
                category={category as "on_page" | "off_page" | undefined}
                researchLoading={isResearchLoading}
                researchError={isResearchError}
                hasResearchSnapshot={Boolean(reportData?.snapshot)}
                strategyItemsLoading={strategyItemsLoading}
                strategyItemsError={strategyItemsError}
                strategyItemsReady={strategyItemsReady}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SignalRow({
  signal,
  findings,
  ideas,
  items,
  companyId,
  category,
  researchLoading,
  researchError,
  hasResearchSnapshot,
  strategyItemsLoading,
  strategyItemsError,
  strategyItemsReady,
}: {
  signal: Signal;
  findings: GapResearchFinding[];
  ideas: StrategyIdea[];
  items: StrategyItem[];
  companyId: number;
  category?: "on_page" | "off_page";
  researchLoading: boolean;
  researchError: boolean;
  hasResearchSnapshot: boolean;
  strategyItemsLoading: boolean;
  strategyItemsError: boolean;
  strategyItemsReady: boolean;
}) {
  const {
    finding,
    evidence,
    competitor,
    mappedTitle,
    initialIdeaTitle,
    initialFindingId,
    initialCustomIdea,
  } = getSignalIdeaMapping(
    signal,
    findings,
    ideas,
    signal.guidance ? signal.guidance.findingId : undefined,
  );
  const deploymentTitle = initialIdeaTitle ?? initialCustomIdea?.title;
  const isDeployed =
    Boolean(finding?.promotion) ||
    items.some(
      (item) => Boolean(deploymentTitle) && item.ideaTitle === deploymentTitle,
    );

  return (
    <div
      className="p-5 hover:bg-fog transition-colors"
      data-testid={`card-recommended-action-${signal.id}`}
    >
      <div className="mb-3 grid grid-cols-2 items-start gap-3 sm:grid-cols-[1fr_auto_auto] sm:gap-6">
        <div className="col-span-2 sm:col-span-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-medium text-foreground">
              {signal.name}
            </h3>
            {signal.guidance && (
              <RecommendationBasisBadge guidance={signal.guidance} />
            )}
          </div>
          <p className="text-[13px] leading-relaxed text-slate-quiet">
            {signal.guidance?.generalPrinciple ?? signal.description}
          </p>
        </div>

        <div className="flex justify-start sm:w-24 sm:justify-center">
          <div
            className="flex gap-0.5"
            title={`Company priority: ${signal.weight}/5`}
            aria-label={`Company priority ${signal.weight} out of 5`}
            role="img"
          >
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                aria-hidden="true"
                className={cn(
                  "w-3 h-3 rounded-full",
                  i <= signal.weight ? "bg-foreground" : "bg-border",
                )}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2.5 sm:w-32">
          <StatusBadge status={signal.status} />
        </div>
      </div>

      {signal.guidance ? (
        <div
          className="mt-4 rounded-lg border border-border bg-mist p-3.5"
          data-testid={`guidance-recommended-action-${signal.id}`}
        >
          <div className="flex items-start gap-2.5">
            <Info className="w-4 h-4 text-slate-quiet mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ash">
                Recommended next move
              </p>
              <p className="mt-1 text-[13px] font-medium leading-relaxed text-foreground">
                {signal.guidance.nextStep}
              </p>
            </div>
          </div>
          {signal.guidance.companyRationale && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ash">
                Why this company
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-quiet">
                {signal.guidance.companyRationale}
              </p>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ash">
              Based on
            </span>
            {signal.guidance.basedOn.map((source) => (
              <span
                key={source}
                className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-slate-quiet"
              >
                {source}
              </span>
            ))}
          </div>
        </div>
      ) : signal.recommendation ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-border bg-mist p-3">
          <Info className="w-4 h-4 text-slate-quiet mt-0.5 shrink-0" />
          <div className="text-[13px] text-foreground leading-relaxed font-medium">
            {signal.recommendation}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {signal.evidence && (
          <EvidenceSignal evidence={signal.evidence} grouped />
        )}
        <PromptEvidenceDropdown
          signalId={signal.id}
          finding={finding}
          evidence={evidence}
          competitor={competitor}
          mappedTitle={mappedTitle}
          researchLoading={researchLoading}
          researchError={researchError}
          hasResearchSnapshot={hasResearchSnapshot}
        />
        {strategyItemsLoading || !strategyItemsReady ? (
          <span
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-[11px] font-medium",
              strategyItemsError
                ? "border-[var(--negative-border)] text-negative"
                : "border-border text-slate-quiet",
            )}
            data-testid={
              strategyItemsError
                ? `status-strategy-unavailable-${signal.id}`
                : `status-checking-strategy-${signal.id}`
            }
          >
            {strategyItemsError ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <Activity className="h-3.5 w-3.5 animate-pulse" />
            )}
            {strategyItemsError
              ? "Strategy status unavailable"
              : "Checking strategy…"}
          </span>
        ) : isDeployed ? (
          <span
            className="inline-flex items-center justify-center gap-1.5 text-[11px] font-medium text-positive bg-[var(--positive-surface)] px-2.5 py-1 rounded-md"
            data-testid={`status-in-strategy-${signal.id}`}
          >
            <CheckCircle className="w-3.5 h-3.5" /> In strategy
          </span>
        ) : (
          <DeployIdeaDialog
            companyId={companyId}
            category={category}
            triggerLabel="Add to strategy"
            triggerClassName="m1-btn--outline py-1 px-2.5 text-[11px] h-[26px]"
            initialIdeaTitle={initialIdeaTitle}
            initialFindingId={initialFindingId}
            allowFindingFallback={false}
            initialCustomIdea={initialCustomIdea}
          />
        )}
      </div>
    </div>
  );
}

function RecommendationBasisBadge({
  guidance,
}: {
  guidance: ActionRecommendation;
}) {
  const label =
    guidance.basis === "verified_research"
      ? "Verified research"
      : guidance.basis === "research_refresh_needed"
        ? "Refresh research"
      : guidance.basis === "company_context"
        ? "Company fit"
        : "General foundation";
  const level =
    guidance.evidenceLevel === "experimental"
      ? "Experimental"
      : guidance.evidenceLevel === "conditional_practice"
        ? "Context-dependent"
        : null;
  return (
    <>
      <span
        className={cn(
          "rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]",
          guidance.basis === "verified_research"
            ? "border-[var(--positive-border)] bg-[var(--positive-surface)] text-positive"
            : guidance.basis === "research_refresh_needed"
              ? "border-[var(--warning-border)] bg-[var(--warning-surface)] text-warning"
            : guidance.basis === "company_context"
              ? "border-border bg-background text-foreground"
              : "border-border bg-fog text-slate-quiet",
        )}
      >
        {label}
      </span>
      {level && (
        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-quiet">
          {level}
        </span>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'passed' || status === 'good') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-[var(--positive-surface)] text-positive uppercase tracking-wide">
        <CheckCircle className="w-3.5 h-3.5" /> {status}
      </span>
    );
  }
  if (status === 'failed' || status === 'critical') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-[var(--negative-surface)] text-negative uppercase tracking-wide">
        <AlertTriangle className="w-3.5 h-3.5" /> {status}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-[var(--warning-surface)] text-warning uppercase tracking-wide">
      <Activity className="w-3.5 h-3.5" /> {status}
    </span>
  );
}
