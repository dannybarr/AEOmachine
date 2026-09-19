import {
  useListStrategyItems,
  useUpdateStrategyItem,
  useDeleteStrategyItem,
  getListStrategyItemsQueryKey,
  getGetCompanyPlaybookQueryKey,
  type StrategyItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Trash,
  CalendarDays,
  Coins,
  AlertTriangle,
  ExternalLink,
  FileCheck2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { AuditImpactCard } from "./AuditImpactCard";

const STATUSES = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "live", label: "Live" },
] as const;

const STATUS_STYLES: Record<string, string> = {
  not_started: "bg-mist text-slate-quiet border-border",
  in_progress: "bg-[var(--warning-surface)] text-warning border-border",
  live: "bg-[var(--positive-surface)] text-positive border-border",
};

interface StrategyItemsListProps {
  companyId: number;
  category?: "on_page" | "off_page";
  emptyHint?: string;
}

export function StrategyItemsList({
  companyId,
  category,
  emptyHint = "No plays deployed yet. Pick one from the Ideas library to get started.",
}: StrategyItemsListProps) {
  const { data: items, isLoading, isError, refetch } = useListStrategyItems({
    companyId,
    ...(category ? { category } : {}),
  });

  if (isLoading) {
    return (
      <div className="p-6 text-center text-[13px] text-slate-quiet">
        Loading deployed plays...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 text-center text-[13px] text-slate-quiet flex flex-col items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-warning" />
        Couldn't load deployed plays.
        <button onClick={() => refetch()} className="m1-btn m1-btn--outline">
          Retry
        </button>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="p-6 text-center text-[13px] text-slate-quiet">
        {emptyHint}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {items.map((item) => (
        <StrategyItemRow key={item.id} item={item} companyId={companyId} />
      ))}
    </div>
  );
}

function StrategyItemRow({
  item,
  companyId,
}: {
  item: StrategyItem;
  companyId: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListStrategyItemsQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getGetCompanyPlaybookQueryKey(companyId),
    });
  };

  const update = useUpdateStrategyItem({
    mutation: {
      onSuccess: invalidate,
      onError: () =>
        toast({ title: "Could not update item", variant: "destructive" }),
    },
  });
  const del = useDeleteStrategyItem({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Strategy item removed" });
      },
    },
  });

  return (
    <div className="p-4 flex flex-col gap-2 hover:bg-mist transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-[13px] font-medium text-foreground">
              {item.ideaTitle}
            </h4>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-mist text-ash uppercase tracking-wide">
              {item.ideaPlayType}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide",
                item.evidence || item.auditImpact
                  ? "bg-[var(--positive-surface)] text-positive"
                  : "bg-mist text-slate-quiet",
              )}
            >
              {item.evidence
                ? "Evidence-backed"
                : item.auditImpact
                  ? "Audit-backed · measuring"
                  : "Manually selected · not measured"}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[12px] text-slate-quiet flex-wrap">
            {(item.moneyTopicName ?? item.moneyTopic) && (
              <span className="flex items-center gap-1">
                <Coins className="w-3 h-3" /> {item.moneyTopicName ?? item.moneyTopic}
              </span>
            )}
            {item.targetDate && (
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3" /> {item.targetDate}
              </span>
            )}
          </div>
          {item.brief && (
            <div className="mt-3 rounded-md border border-border bg-muted/30 p-3.5 text-[13px]">
              <div className="mb-2.5 text-foreground">
                <span className="mr-1.5 font-semibold">Action angle:</span>
                {item.brief.actionAngle}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-slate-quiet">
                {item.brief.targetAudience && (
                  <div>
                    <span className="mr-1 font-medium text-foreground/70">Audience:</span>
                    {item.brief.targetAudience}
                  </div>
                )}
                {item.brief.proofPoint && (
                  <div>
                    <span className="mr-1 font-medium text-foreground/70">Proof:</span>
                    {item.brief.proofPoint}
                  </div>
                )}
                {item.brief.successMetric && (
                  <div>
                    <span className="mr-1 font-medium text-foreground/70">Metric:</span>
                    {item.brief.successMetric}
                  </div>
                )}
                {item.brief.owner && (
                  <div>
                    <span className="mr-1 font-medium text-foreground/70">Owner:</span>
                    {item.brief.owner}
                  </div>
                )}
              </div>
            </div>
          )}
          {item.notes && (
            <p className="text-[12px] text-slate-quiet mt-1 leading-relaxed">
              {item.notes}
            </p>
          )}
          {item.auditImpact && (
            <div className="mt-3">
              <AuditImpactCard impact={item.auditImpact} compact />
            </div>
          )}
          {item.evidence && (
            <details className="mt-2 rounded-lg border border-border bg-background p-2.5">
              <summary className="cursor-pointer list-none flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                <FileCheck2 className="w-3.5 h-3.5 text-positive" />
                Evidence from Gap Analysis
                <span className="font-normal text-slate-quiet">
                  · {item.evidence.evidenceUrls.length} source
                  {item.evidence.evidenceUrls.length === 1 ? "" : "s"} ·{" "}
                  {item.evidence.runIds.length} tracked run
                  {item.evidence.runIds.length === 1 ? "" : "s"}
                </span>
              </summary>
              <div className="mt-2 pl-5 space-y-2">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-ash">
                    Customer question
                  </div>
                  <p className="text-[12px] text-foreground mt-0.5">
                    “{item.evidence.promptText}”
                  </p>
                </div>
                {item.evidence.rationale && (
                  <p className="text-[12px] leading-relaxed text-slate-quiet">
                    {item.evidence.rationale}
                  </p>
                )}
                {item.evidence.evidenceUrls.length > 0 ? (
                  <div className="space-y-1">
                    {item.evidence.evidenceUrls.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 text-[11px] text-slate-quiet hover:text-foreground"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        <span className="truncate">{url}</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-warning">
                    No source URLs were captured for this finding.
                  </p>
                )}
                <p className="text-[10px] text-ash">
                  Snapshot from research job #{item.evidence.jobId}; run IDs{" "}
                  {item.evidence.runIds.length
                    ? item.evidence.runIds.join(", ")
                    : "not captured"}
                </p>
              </div>
            </details>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={item.status}
            disabled={update.isPending}
            onChange={(e) =>
              update.mutate({
                id: item.id,
                data: { status: e.target.value as StrategyItem["status"] },
              })
            }
            className={cn(
              "text-[11px] font-medium px-2 py-1 rounded-lg border cursor-pointer",
              STATUS_STYLES[item.status],
            )}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {!item.auditImpact && (
            <button
              onClick={() => {
                if (confirm("Remove this deployed play?"))
                  del.mutate({ id: item.id });
              }}
              className="p-1.5 rounded-full hover:bg-[var(--negative-surface)] text-slate-quiet hover:text-negative transition-colors"
            >
              <Trash className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
