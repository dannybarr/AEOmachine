import { ArrowRight, BarChart3, Info } from "lucide-react";
import type { AuditImpactOutcome, StrategyAuditImpact } from "@workspace/api-client-react";

type Impact = AuditImpactOutcome | StrategyAuditImpact;

function pct(value: number | null | undefined) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function delta(before: number | null | undefined, after: number | null | undefined) {
  if (before == null || after == null) return null;
  const value = Math.round((after - before) * 10) / 10;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;
}

function dateRange(start: string, end: string) {
  const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  return `${format.format(new Date(start))}–${format.format(new Date(end))}`;
}

export function AuditImpactCard({ impact, compact = false }: { impact: Impact; compact?: boolean }) {
  const after = impact.after;
  const legacyLiveWithoutDate = impact.status === "live" && !impact.liveAt;
  const citationDelta = delta(impact.citationRateBefore, impact.citationRateAfter);
  const visibilityDelta = delta(impact.visibilityBefore, impact.visibilityAfter);

  return (
    <div className="rounded-lg border border-border bg-background p-3.5" data-testid="audit-impact-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-foreground">
            <BarChart3 className="h-3.5 w-3.5 text-positive" />
            Observed impact
          </div>
          <p className="mt-1 text-[11px] text-slate-quiet">
            {after
              ? `Before ${dateRange(impact.baseline.windowStart, impact.baseline.windowEnd)} · After ${dateRange(after.windowStart, after.windowEnd)}`
              : legacyLiveWithoutDate
                ? "Live date was not captured for this legacy item · post-live comparison unavailable"
                : "Baseline saved · post-live measurement starts when this item is marked Live"}
          </p>
        </div>
        {after && (
          <span className="rounded-full bg-mist px-2 py-0.5 text-[10px] text-slate-quiet">
            {after.totalRuns} post-live run{after.totalRuns === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className={`mt-3 grid ${compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2"} gap-2`}>
        <Metric label="Owned citation rate" before={impact.citationRateBefore} after={impact.citationRateAfter} change={citationDelta} />
        <Metric label="Brand visibility" before={impact.visibilityBefore} after={impact.visibilityAfter} change={visibilityDelta} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ash">
        <span title={impact.baseline.models.join(", ")}>
          Before: {impact.baseline.totalRuns} runs · {impact.baseline.eligibleRuns} eligible · {impact.baseline.models.length} model{impact.baseline.models.length === 1 ? "" : "s"}
        </span>
        {after && (
          <span title={after.models.join(", ")}>
            After: {after.totalRuns} runs · {after.eligibleRuns} eligible · {after.models.length} model{after.models.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-quiet">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        This is an observed correlation after launch, not proof that this change caused the result.
      </p>
    </div>
  );
}

function Metric({ label, before, after, change }: {
  label: string;
  before: number | null | undefined;
  after: number | null | undefined;
  change: string | null;
}) {
  return (
    <div className="rounded-md bg-fog px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ash">{label}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[13px] font-medium tabular-nums">
        <span>{pct(before)}</span>
        <ArrowRight className="h-3 w-3 text-ash" />
        <span>{pct(after)}</span>
        {change && <span className="ml-auto text-[10px] text-slate-quiet">{change}</span>}
      </div>
    </div>
  );
}