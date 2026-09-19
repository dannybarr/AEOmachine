import { useId, useState } from "react";
import type { ActionEvidence } from "@workspace/api-client-react";
import { ChevronDown, ExternalLink, Radar } from "lucide-react";
import { cn } from "@/lib/utils";

const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  editorial: "Editorial coverage",
  ugc: "Community / UGC",
  original_statistics: "Original statistics",
  faq_structure: "FAQ structure",
  documentation: "Vendor documentation",
  review_listicle: "Review & listicle",
  competitor_owned: "Competitor-owned page",
  reference: "Reference site",
  brand_owned: "Brand-owned page",
  other: "Other channel",
};

const CONFIDENCE_META: Record<string, { label: string; className: string }> = {
  observed: {
    label: "Observed in tracked runs",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  curated: {
    label: "Curated example",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  hypothesis: {
    label: "Hypothesis",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
};

function freshnessLabel(observedAt: string | null | undefined): string | null {
  if (!observedAt) return null;
  const then = new Date(observedAt).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "Observed today";
  if (days < 30) return `Observed ${days}d ago`;
  if (days < 365) return `Observed ${Math.floor(days / 30)}mo ago`;
  return `Observed ${new Date(observedAt).toLocaleDateString(undefined, { year: "numeric", month: "short" })}`;
}

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

/**
 * Collapsed-by-default "Signal" disclosure attached to an action: who is
 * surfacing well with AI agents, via which mechanism, and the source.
 * Renders nothing when no evidence exists — original ideas stay clean.
 */
export function EvidenceSignal({
  evidence,
  className,
  grouped = false,
}: {
  evidence: ActionEvidence | null | undefined;
  className?: string;
  grouped?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!evidence) return null;

  const confidence = CONFIDENCE_META[evidence.confidence] ?? CONFIDENCE_META["curated"]!;
  const typeLabel = EVIDENCE_TYPE_LABELS[evidence.evidenceType] ?? "Other channel";
  const freshness = freshnessLabel(evidence.observedAt);
  const href = safeHttpUrl(evidence.sourceUrl);

  return (
    <div className={cn(grouped ? "contents" : className || "mt-3")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md border transition-colors",
          open
            ? "bg-foreground text-background border-foreground"
            : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/40",
        )}
      >
        <Radar className="w-3 h-3" />
        Signal · {evidence.company}
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          id={panelId}
          className={cn(
            "mt-2 rounded-md border border-border bg-muted/30 p-3 space-y-2.5",
            grouped && "order-last basis-full",
          )}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-semibold text-foreground">{evidence.company}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground">
              {typeLabel}
            </span>
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-sm border",
                confidence.className,
              )}
            >
              {confidence.label}
            </span>
            {freshness && (
              <span className="text-[11px] text-muted-foreground">{freshness}</span>
            )}
          </div>
          <p className="text-[12px] text-foreground leading-relaxed">{evidence.observation}</p>
          {evidence.rationale && (
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              <span className="font-semibold">Read on this:</span> {evidence.rationale}
            </p>
          )}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground underline underline-offset-2 hover:opacity-70 break-all"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              {evidence.sourceTitle ?? href}
            </a>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              Source link unavailable for this observation.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
