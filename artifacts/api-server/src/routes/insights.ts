import { Router, type IRouter } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  db,
  citationsTable,
  domainRegistryTable,
  promptRunsTable,
  promptsTable,
} from "@workspace/db";
import { getCompany } from "../lib/companyLookup";

const router: IRouter = Router();

interface Insight {
  id: string;
  kind: string;
  severity: "good" | "info" | "warning";
  title: string;
  detail: string;
  observation: string;
  action?: string | null;
  whyItMayWork?: string | null;
  caveat: string;
  confidence: "insufficient" | "weak" | "moderate" | "strong";
  sampleSize: number;
  evidenceLabel: string;
  metricLabel?: string | null;
  metricValue?: string | null;
  href?: string | null;
}

function runConfidence(n: number): Insight["confidence"] {
  if (n < 3) return "insufficient";
  if (n < 10) return "weak";
  if (n < 30) return "moderate";
  return "strong";
}

function patternConfidence(citations: number, prompts: number): Insight["confidence"] {
  if (citations < 2 || prompts < 1) return "insufficient";
  if (citations >= 10 && prompts >= 3) return "strong";
  if (citations >= 5 && prompts >= 2) return "moderate";
  return "weak";
}

/**
 * Every insight is a deterministic rule evaluated against real runs and
 * citations for the selected company — no AI, no estimates. If there is not
 * enough data for a rule, it is skipped rather than guessed.
 */
router.get("/insights", async (req, res): Promise<void> => {
  const company = await getCompany(Number(req.query["companyId"]));
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const days = Math.min(Math.max(Number(req.query["days"]) || 30, 1), 365);
  const cutoff = sql`now() - make_interval(days => ${days})`;
  const insights: Insight[] = [];
  const brandName = company.name;
  const scoped = and(
    eq(promptsTable.companyId, company.id),
    gt(promptRunsTable.createdAt, cutoff),
  );

  const [runAgg] = await db
    .select({
      runCount: sql<number>`count(*)::int`,
      mentionCount: sql<number>`count(*) filter (where ${promptRunsTable.brandMentioned})::int`,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(scoped);
  const runCount = runAgg?.runCount ?? 0;
  const mentionCount = runAgg?.mentionCount ?? 0;

  if (runCount === 0) {
    insights.push({
      id: "no-runs",
      kind: "coverage",
      severity: "info",
      title: "No simulations in this period",
      detail: `Run ${brandName}'s tracked prompts against the answer engines to start collecting real visibility data. Every insight on this page is computed from actual runs — nothing is estimated.`,
      observation: `No simulations were recorded in the selected ${days}-day window.`,
      action: `Run ${brandName}'s tracked prompts before choosing an optimization.`,
      whyItMayWork: "A baseline is required to identify which prompts, models, and sources actually present a gap.",
      caveat: "No recommendation about content or distribution is supportable without observed runs.",
      confidence: "insufficient",
      sampleSize: 0,
      evidenceLabel: "0 simulation runs",
      href: "/prompts",
    });
    res.json(insights);
    return;
  }

  // Overall visibility.
  const visibilityPct = Math.round((mentionCount / runCount) * 1000) / 10;
  insights.push({
    id: "visibility",
    kind: "visibility",
    severity: visibilityPct >= 30 ? "good" : visibilityPct > 0 ? "info" : "warning",
    title:
      visibilityPct === 0
        ? `${brandName} was not mentioned in any AI answer`
        : `${brandName} appears in ${visibilityPct}% of AI answers`,
    detail:
      visibilityPct === 0
        ? `Across ${runCount} simulation${runCount === 1 ? "" : "s"} in the last ${days} days, no answer mentioned ${brandName}. Inspect the affected prompts before selecting an intervention.`
        : `Mentioned in ${mentionCount} of ${runCount} simulations over the last ${days} days.`,
    observation: `${brandName} was mentioned in ${mentionCount} of ${runCount} simulations (${visibilityPct}%) in the selected window.`,
    action:
      visibilityPct === 0 && runCount >= 3
        ? "Open Gap Analysis and review the exact no-mention prompts and cited sources; choose a source-specific action only where repeated evidence exists."
        : null,
    whyItMayWork:
      visibilityPct === 0 && runCount >= 3
        ? "Prompt-level source evidence can reveal a repeatable content format or distribution channel to test, rather than assuming one universal fix."
        : null,
    caveat:
      "Simulation results measure observed association in this tracked sample; they do not prove that any content or source caused a mention.",
    confidence: runConfidence(runCount),
    sampleSize: runCount,
    evidenceLabel: `${mentionCount}/${runCount} answers mentioned the brand`,
    metricLabel: "Visibility",
    metricValue: `${visibilityPct}%`,
    href: visibilityPct === 0 ? "/gap-analysis" : "/perception",
  });

  // Per-model mention rates. Five runs per model is still a small sample, but
  // avoids turning one or two outputs into an optimization recommendation.
  const modelRows = await db
    .select({
      model: promptRunsTable.model,
      runCount: sql<number>`count(*)::int`,
      mentionCount: sql<number>`count(*) filter (where ${promptRunsTable.brandMentioned})::int`,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(scoped)
    .groupBy(promptRunsTable.model)
    .having(sql`count(*) >= 5`);
  if (modelRows.length >= 2) {
    const rated = modelRows
      .map((m) => ({ ...m, rate: m.mentionCount / m.runCount }))
      .sort((a, b) => b.rate - a.rate);
    const best = rated[0]!;
    const worst = rated[rated.length - 1]!;
    if (best.rate > worst.rate) {
      insights.push({
        id: "model-spread",
        kind: "models",
        severity: "info",
        title: `${best.model} mentions ${brandName} most; ${worst.model} least`,
        detail: `${best.model}: ${best.mentionCount}/${best.runCount} answers. ${worst.model}: ${worst.mentionCount}/${worst.runCount}. Review their exact outputs and source sets before deciding whether the difference is actionable.`,
        observation: `${best.model} mentioned ${brandName} in ${best.mentionCount}/${best.runCount} answers; ${worst.model} did so in ${worst.mentionCount}/${worst.runCount}.`,
        action: `Compare the answer transcripts and provider-returned sources for ${worst.model} with ${best.model}; record a test only if a repeated source or format difference appears.`,
        whyItMayWork: "A repeated engine-specific source pattern can support a targeted distribution or content test.",
        caveat: "This is a descriptive difference, not evidence that the model or its cited sources caused the mention-rate gap. Prompt mix and run timing may differ.",
        confidence: runConfidence(Math.min(best.runCount, worst.runCount)),
        sampleSize: best.runCount + worst.runCount,
        evidenceLabel: `${best.runCount + worst.runCount} runs across the compared engines`,
        metricLabel: "Best engine rate",
        metricValue: `${Math.round(best.rate * 1000) / 10}%`,
        href: "/perception",
      });
    }
  }

  // Top cited domain in the window.
  const [topDomain] = await db
    .select({
      domain: citationsTable.domain,
      retrievals: sql<number>`count(*)::int`,
      promptCount: sql<number>`count(distinct ${promptRunsTable.promptId})::int`,
    })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(
        scoped,
        eq(citationsTable.provenance, "provider"),
        eq(promptRunsTable.citationEligible, true),
      ),
    )
    .groupBy(citationsTable.domain)
    .orderBy(sql`count(*) desc`)
    .limit(1);
  if (topDomain && topDomain.retrievals >= 2) {
    const sourceConfidence = patternConfidence(topDomain.retrievals, topDomain.promptCount);
    insights.push({
      id: "top-domain",
      kind: "sources",
      severity: "info",
      title: `${topDomain.domain} is the most retrieved source`,
      detail: `Provider-returned citations included this domain ${topDomain.retrievals} times across ${topDomain.promptCount} tracked prompt${topDomain.promptCount === 1 ? "" : "s"} in the last ${days} days.`,
      observation: `${topDomain.domain} was the most retrieved domain: ${topDomain.retrievals} verified citations across ${topDomain.promptCount} prompt${topDomain.promptCount === 1 ? "" : "s"}.`,
      action:
        sourceConfidence === "insufficient"
          ? null
          : `Inspect the exact cited pages on ${topDomain.domain}. If they repeatedly cover your tracked topic and accept contributions or listings, test one relevant placement or pitch.`,
      whyItMayWork:
        sourceConfidence === "insufficient"
          ? null
          : "The domain already appears in this sample's retrieved source set, so a relevant placement there is a more evidence-specific test than untargeted outreach.",
      caveat: "Retrieval frequency is correlated with these answers; it does not prove that placement on this domain will cause a future citation or mention.",
      confidence: sourceConfidence,
      sampleSize: topDomain.retrievals,
      evidenceLabel: `${topDomain.retrievals} verified citations across ${topDomain.promptCount} prompts`,
      metricLabel: "Retrievals",
      metricValue: String(topDomain.retrievals),
      href: "/domains",
    });
  }

  // The company's own domains' citation count.
  const [ownAgg] = await db
    .select({ retrievals: sql<number>`count(${citationsTable.id})::int` })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(
      domainRegistryTable,
      and(
        eq(domainRegistryTable.domain, citationsTable.domain),
        eq(domainRegistryTable.companyId, company.id),
      ),
    )
    .where(and(
      scoped,
      eq(citationsTable.provenance, "provider"),
      eq(promptRunsTable.citationEligible, true),
      sql`(${domainRegistryTable.domainType} = 'you' or ${domainRegistryTable.isOwned})`,
    ));
  const ownRetrievals = ownAgg?.retrievals ?? 0;
  const [eligibleAgg] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(and(scoped, eq(promptRunsTable.citationEligible, true)));
  const eligibleRuns = eligibleAgg?.count ?? 0;
  insights.push({
    id: "owned-citations",
    kind: "sources",
    severity: ownRetrievals > 0 ? "good" : eligibleRuns > 0 ? "warning" : "info",
    title:
      ownRetrievals > 0
        ? `${brandName}'s own pages were cited ${ownRetrievals} time${ownRetrievals === 1 ? "" : "s"}`
        : eligibleRuns === 0
          ? "Owned-source citations cannot be evaluated"
        : `AI engines are not citing ${brandName}'s own pages`,
    detail:
      ownRetrievals > 0
        ? `Provider-returned citations included ${brandName}'s owned domains ${ownRetrievals} times in ${eligibleRuns} citation-eligible runs.`
        : `No verified citations of ${brandName}'s owned domains appeared in ${eligibleRuns} citation-eligible runs.`,
    observation: `${ownRetrievals} verified owned-domain citations appeared in ${eligibleRuns} citation-eligible runs.`,
    action:
      ownRetrievals === 0 && eligibleRuns >= 5
        ? "Audit the specific pages relevant to your no-mention prompts in Site Lab, then fix any confirmed crawlability, answer-structure, or schema failures and rerun the same prompts."
        : null,
    whyItMayWork:
      ownRetrievals === 0 && eligibleRuns >= 5
        ? "Removing a confirmed technical or structural barrier makes the page eligible for a fair before/after retrieval test."
        : null,
    caveat:
      eligibleRuns === 0
        ? "No citation-capable runs exist in this window, so owned-source performance cannot be evaluated."
        : "Absence of owned citations does not identify the cause. Passing a site audit does not guarantee retrieval.",
    confidence: eligibleRuns === 0 ? "insufficient" : runConfidence(eligibleRuns),
    sampleSize: eligibleRuns,
    evidenceLabel: `${ownRetrievals} owned citations / ${eligibleRuns} eligible runs`,
    metricLabel: "Owned citations",
    metricValue: String(ownRetrievals),
    href: ownRetrievals > 0 ? "/urls" : "/lab",
  });

  // Prompts with runs but zero mentions.
  const gapPrompts = await db
    .select({
      promptId: promptsTable.id,
      runCount: sql<number>`count(${promptRunsTable.id})::int`,
      mentionCount: sql<number>`count(${promptRunsTable.id}) filter (where ${promptRunsTable.brandMentioned})::int`,
    })
    .from(promptsTable)
    .innerJoin(
      promptRunsTable,
      sql`${promptRunsTable.promptId} = ${promptsTable.id} and ${promptRunsTable.createdAt} > ${cutoff}`,
    )
    .where(eq(promptsTable.companyId, company.id))
    .groupBy(promptsTable.id);
  const gapCount = gapPrompts.filter((p) => p.mentionCount === 0).length;
  if (gapCount > 0) {
    insights.push({
      id: "prompt-gaps",
      kind: "gaps",
      severity: "warning",
      title: `${gapCount} tested prompt${gapCount === 1 ? "" : "s"} never mention${gapCount === 1 ? "s" : ""} ${brandName}`,
      detail:
        "Gap Analysis lists the exact prompts, run counts, and provider-returned citations so each gap can be evaluated separately.",
      observation: `${gapCount} tracked prompt${gapCount === 1 ? "" : "s"} had runs but zero brand mentions in this window.`,
      action: "Prioritize only gap prompts with repeated, inspectable source evidence; use the cited page type and channel to define one concrete test.",
      whyItMayWork: "This narrows work to observed buyer questions and the sources already retrieved for them instead of applying generic AEO advice.",
      caveat: "A zero-mention prompt can reflect sparse runs or model variance. Gap Analysis reports sample size and withholds specific plays when citation evidence is insufficient.",
      confidence: runConfidence(runCount),
      sampleSize: runCount,
      evidenceLabel: `${gapCount} zero-mention prompts among ${gapPrompts.length} tested prompts`,
      metricLabel: "Gap prompts",
      metricValue: String(gapCount),
      href: "/gap-analysis",
    });
  }

  // Newly seen domains in the window.
  const [newDomains] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(domainRegistryTable)
    .where(
      and(
        eq(domainRegistryTable.companyId, company.id),
        gt(domainRegistryTable.firstSeenAt, cutoff),
      ),
    );
  if ((newDomains?.count ?? 0) > 0) {
    insights.push({
      id: "new-domains",
      kind: "sources",
      severity: "info",
      title: `${newDomains!.count} new source domain${newDomains!.count === 1 ? "" : "s"} appeared`,
      detail: `These domains were recorded for the first time by this tracker in the last ${days} days. Recency alone does not show that an engine newly trusts them.`,
      observation: `${newDomains!.count} domains have a first-seen timestamp inside the selected window.`,
      action: null,
      whyItMayWork: null,
      caveat: "“New” means new to this tracker, not necessarily newly trusted by an answer engine. No action is recommended from recency alone.",
      confidence: "weak",
      sampleSize: newDomains!.count,
      evidenceLabel: `${newDomains!.count} first-seen domain records`,
      metricLabel: "New domains",
      metricValue: String(newDomains!.count),
      href: "/domains",
    });
  }

  res.json(insights);
});

export default router;
