import React, { useId, useState } from "react";
import type {
  GapEvidenceItem,
  GapCompetitorSurfaced,
  GapResearchFinding,
} from "@workspace/api-client-react";
import {
  Activity,
  ChevronDown,
  ExternalLink,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { calculateObservedShare } from "@/lib/actionResearchEvidence";

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

function freshnessLabel(observedAt: string | null | undefined): string | null {
  if (!observedAt) return null;
  const then = new Date(observedAt).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return new Date(observedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
  });
}

interface PromptEvidenceDropdownProps {
  signalId: number;
  finding: GapResearchFinding | null;
  evidence: GapEvidenceItem | null;
  competitor: GapCompetitorSurfaced | null;
  mappedTitle?: string;
  researchLoading: boolean;
  researchError: boolean;
  hasResearchSnapshot: boolean;
  defaultOpen?: boolean;
}

export function PromptEvidenceDropdown({
  signalId,
  finding,
  evidence,
  competitor,
  mappedTitle,
  researchLoading,
  researchError,
  hasResearchSnapshot,
  defaultOpen = false,
}: PromptEvidenceDropdownProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const eligibleRunCount = finding?.eligibleRunCount ?? 0;
  const observed = calculateObservedShare(
    evidence?.runCount ?? 0,
    eligibleRunCount,
  );
  const observedRunCount = observed?.observedRunCount ?? 0;
  const citationShare = observed?.sharePct ?? null;
  const sourceUrl = safeHttpUrl(evidence?.canonicalUrl);
  const sourceLabel = evidence?.page?.title || evidence?.domain || sourceUrl;

  return (
    <div className="contents">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        data-testid={`button-prompt-evidence-${signalId}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors",
          open
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground",
        )}
      >
        <Search className="h-3 w-3" />
        Evidence
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          id={panelId}
          data-testid={`panel-prompt-evidence-${signalId}`}
          className="order-last mt-2 basis-full space-y-3 rounded-lg border border-border bg-muted/30 p-3.5 text-left"
        >
          {researchLoading ? (
            <div className="flex items-center gap-2.5 text-[12px] text-slate-quiet">
              <Activity className="h-3.5 w-3.5 animate-pulse" />
              Checking the latest tracked prompt research…
            </div>
          ) : researchError ? (
            <>
              <p className="text-[12px] font-medium text-foreground">
                Prompt evidence is temporarily unavailable.
              </p>
              <p className="text-[12px] leading-relaxed text-slate-quiet">
                The action recommendation is still available, but its research
                context could not be loaded. Try again after refreshing the page.
              </p>
            </>
          ) : !hasResearchSnapshot ? (
            <>
              <p className="text-[12px] font-medium text-foreground">
                No tracked prompt research exists yet.
              </p>
              <p className="text-[12px] leading-relaxed text-slate-quiet">
                Run Gap Analysis to look for an exact competitor precedent. Until
                then, treat this as an original recommendation rather than an
                evidence-backed claim.
              </p>
            </>
          ) : !mappedTitle ? (
            <>
              <p className="text-[12px] font-medium leading-relaxed text-foreground">
                This action has no exact research mapping.
              </p>
              <p className="text-[12px] leading-relaxed text-slate-quiet">
                It remains a useful original play, but the current prompt research
                cannot be attached without making an unsupported comparison.
              </p>
            </>
          ) : !finding || !evidence ? (
            <>
              <p className="text-[12px] font-medium leading-relaxed text-foreground">
                No exact competitor precedent was observed for this action.
              </p>
              <p className="text-[12px] leading-relaxed text-slate-quiet">
                The latest completed research contains no eligible competitor
                source tied to the matching play. No evidence has been inferred.
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {competitor ? (
                  <>
                    <span
                      className="text-[13px] font-semibold text-foreground"
                      data-testid={`evidence-domain-${signalId}`}
                    >
                      {competitor.name || competitor.domain}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      surfaced company
                    </span>
                  </>
                ) : (
                  <span className="text-[12px] font-medium text-foreground">
                    Observed supporting source
                  </span>
                )}
                <span
                  className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  data-testid={`evidence-channel-${signalId}`}
                >
                  {evidence.channel.replace(/_/g, " ")}
                </span>
                {evidence.lastSeenAt && (
                  <span
                    className="text-[11px] text-muted-foreground"
                    data-testid={`evidence-recency-${signalId}`}
                  >
                    Last seen {freshnessLabel(evidence.lastSeenAt)}
                  </span>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:gap-x-5">
                <div className="rounded-md border border-border bg-background px-3 py-2">
                  <div
                    className="steep-heading text-lg text-foreground"
                    data-testid={`evidence-citation-share-${signalId}`}
                  >
                    {citationShare}%
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-quiet">
                    tracked answer share
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] leading-relaxed text-foreground">
                    Cited in{" "}
                    <span
                      className="font-semibold"
                      data-testid={`evidence-run-count-${signalId}`}
                    >
                      {observedRunCount}
                    </span>{" "}
                    of{" "}
                    <span data-testid={`evidence-eligible-count-${signalId}`}>
                      {eligibleRunCount}
                    </span>{" "}
                    eligible tracked answers.
                  </p>
                  <p
                    className="mt-1 text-[12px] leading-relaxed text-slate-quiet"
                    data-testid={`evidence-models-${signalId}`}
                  >
                    {evidence.models.length > 0
                      ? `Observed across ${evidence.models.join(", ")}.`
                      : "Model detail was not retained for this source."}{" "}
                    {evidence.citationCount === 1
                      ? "1 stored citation."
                      : `${evidence.citationCount} stored citations.`}
                  </p>
                </div>
              </div>

              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-quiet">
                  Supporting source
                </div>
                <p className="text-[12px] leading-relaxed text-foreground">
                  {sourceLabel}
                </p>
              </div>

              <div className="border-l-2 border-foreground/20 pl-3">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-quiet">
                  Tracked prompt
                </div>
                <p
                  className="text-[12px] leading-relaxed text-foreground"
                  data-testid={`evidence-prompt-text-${signalId}`}
                >
                  “{finding.promptText}”
                </p>
              </div>

              {evidence.answerContext && (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-quiet">
                    Answer excerpt
                  </div>
                  <p
                    className="text-[12px] leading-relaxed text-slate-quiet"
                    data-testid={`evidence-answer-context-${signalId}`}
                  >
                    “{evidence.answerContext}”
                  </p>
                </div>
              )}

              {finding.recommendation.rationale && (
                <div className="rounded border border-border bg-background p-2.5">
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      Qualified interpretation:
                    </span>{" "}
                    <span data-testid={`evidence-rationale-${signalId}`}>
                      {finding.recommendation.rationale}
                    </span>
                  </p>
                  <p className="mt-1.5 text-[11px] italic text-muted-foreground">
                    {competitor
                      ? "This observation is precedent, not proof that the source or format caused the competitor to surface."
                      : "This source observation supports the channel pattern; it does not identify a surfaced company or prove that the source caused the visibility gap."}
                  </p>
                </div>
              )}

              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`evidence-link-${signalId}`}
                  className="inline-flex items-center gap-1 break-all text-[12px] font-medium text-foreground underline underline-offset-2 hover:opacity-70"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  {sourceLabel}
                </a>
              ) : (
                <p className="text-[11px] italic text-muted-foreground">
                  Source link unavailable.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}