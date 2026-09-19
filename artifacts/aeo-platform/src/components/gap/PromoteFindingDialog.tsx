import { useEffect, useMemo, useState } from "react";
import {
  useListStrategyIdeas,
  usePromoteGapFinding,
  getGetGapResearchReportQueryKey,
  getListStrategyItemsQueryKey,
  getGetCompanyPlaybookQueryKey,
  type GapResearchFinding,
  type StrategyIdea,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Rocket, LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * Review & edit a research finding's proposed action before adding it to the
 * matching Strategy Actions section (onsite/offsite). Evidence travels with
 * the action as auditable provenance on the server.
 */
export function PromoteFindingDialog({
  finding,
  companyId,
  open,
  onOpenChange,
}: {
  finding: GapResearchFinding;
  companyId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rec = finding.recommendation;
  const [category, setCategory] = useState<"on_page" | "off_page">(
    rec.category === "off_page" ? "off_page" : "on_page",
  );
  const [ideaId, setIdeaId] = useState<number | null>(null);
  const [moneyTopic, setMoneyTopic] = useState(finding.topic);
  const [targetDate, setTargetDate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: ideas } = useListStrategyIdeas({ category });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Suggest the library play matching the recommendation's play type.
  const suggestedIdea = useMemo(() => {
    if (!ideas) return null;
    return (
      ideas.find((i) => i.title === rec.suggestedIdeaTitle) ?? null
    );
  }, [ideas, rec.suggestedIdeaTitle]);

  // Prefill on open: idea, notes (rationale + evidence links).
  useEffect(() => {
    if (!open) return;
    setCategory(rec.category === "off_page" ? "off_page" : "on_page");
    setMoneyTopic(finding.topic);
    const urls = rec.evidenceUrls.slice(0, 5);
    setNotes(
      [
        rec.title ? `Proposed: ${rec.title}` : null,
        rec.rationale ?? null,
        `From Gap Analysis research — prompt: "${finding.promptText}"`,
        urls.length ? `Evidence:\n${urls.map((u) => `- ${u}`).join("\n")}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, finding.id]);

  useEffect(() => {
    setIdeaId(suggestedIdea?.id ?? null);
  }, [suggestedIdea, category]);

  const promote = usePromoteGapFinding({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetGapResearchReportQueryKey({ companyId }),
        });
        queryClient.invalidateQueries({ queryKey: getListStrategyItemsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetCompanyPlaybookQueryKey(companyId),
        });
        onOpenChange(false);
        toast({
          title: "Added to Strategy Actions",
          description: `Filed under ${category === "on_page" ? "Onsite" : "Offsite"} Build with evidence attached.`,
        });
      },
      onError: (err: unknown) => {
        const status = (err as { status?: number })?.status;
        toast({
          title:
            status === 409
              ? "Already promoted"
              : "Could not create the strategy action",
          description:
            status === 409
              ? "This finding is already linked to a strategy action."
              : undefined,
          variant: "destructive",
        });
      },
    },
  });

  const selected: StrategyIdea | undefined = ideas?.find((i) => i.id === ideaId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="steep-heading">Promote finding to Strategy Actions</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="p-3 rounded-lg bg-mist border border-border">
            <div className="text-[11px] font-medium text-ash uppercase tracking-wider mb-1">
              Research finding
            </div>
            <p className="text-[13px] text-foreground">“{finding.promptText}”</p>
            {rec.rationale && (
              <p className="text-[12px] text-slate-quiet mt-1.5 leading-relaxed">
                {rec.rationale}
              </p>
            )}
            {rec.evidenceUrls.length > 0 && (
              <div className="mt-2 space-y-1">
                {rec.evidenceUrls.slice(0, 4).map((u) => (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-[11px] text-slate-quiet hover:text-foreground truncate"
                  >
                    <LinkIcon className="w-3 h-3 shrink-0" />
                    <span className="truncate">{u}</span>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-[12px] font-medium text-ash uppercase tracking-wider mb-1.5 block">
              Section
            </label>
            <div className="flex gap-2">
              {(
                [
                  ["on_page", "Onsite Build"],
                  ["off_page", "Offsite Build"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setCategory(value)}
                  className={cn(
                    "flex-1 text-[13px] font-medium px-3 py-2 rounded-full border transition-colors",
                    category === value
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background text-slate-quiet border-border hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[12px] font-medium text-ash uppercase tracking-wider mb-1.5 block">
              Play (from Ideas library)
            </label>
            <select
              value={ideaId ?? ""}
              onChange={(e) => setIdeaId(e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-3 py-2 text-[13px]"
            >
              <option value="">Select a play…</option>
              {(ideas ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title} — {i.playType}
                  {suggestedIdea?.id === i.id ? " (suggested)" : ""}
                </option>
              ))}
            </select>
            {selected && (
              <p className="text-[12px] text-slate-quiet mt-1.5 leading-relaxed">
                {selected.description}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-ash uppercase tracking-wider mb-1.5 block">
                Money topic
              </label>
              <input
                value={moneyTopic}
                onChange={(e) => setMoneyTopic(e.target.value)}
                className="w-full rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-3 py-2 text-[13px]"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-ash uppercase tracking-wider mb-1.5 block">
                Target date
              </label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-3 py-2 text-[13px]"
              />
            </div>
          </div>

          <div>
            <label className="text-[12px] font-medium text-ash uppercase tracking-wider mb-1.5 block">
              Notes (editable — evidence links stay attached)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
              className="w-full rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-3 py-2 text-[12px] font-mono resize-y"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button className="m1-btn m1-btn--outline" onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button
              className="m1-btn"
              disabled={!ideaId || promote.isPending}
              onClick={() =>
                ideaId &&
                promote.mutate({
                  id: finding.id,
                  data: {
                    companyId,
                    ideaId,
                    category,
                    moneyTopic: moneyTopic.trim() || null,
                    notes: notes.trim() || null,
                    targetDate: targetDate || null,
                  },
                })
              }
            >
              <Rocket className="w-4 h-4 mr-1.5" />
              {promote.isPending ? "Adding…" : "Add to Strategy Actions"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
