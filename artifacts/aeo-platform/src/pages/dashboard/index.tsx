import { useSearch } from "wouter";
import { useGetDashboard, useGetCitationQuality } from "@workspace/api-client-react";
import { useModels } from "@/hooks/use-models";
import { modelLabel } from "@/lib/model-meta";
import { MethodologyPanel } from "@/components/MethodologyPanel";
import {
  Building2,
  MessageSquare,
  Zap,
  Globe,
  BarChart,
  Layers,
  Link2,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

function formatNumber(num: number | undefined | null) {
  if (num == null) return "0";
  return num.toLocaleString();
}

function formatPercent(num: number | undefined | null) {
  if (num == null) return "\u2014";
  return Math.round(num) + "%";
}

const TYPE_COLORS: Record<string, string> = {
  corporate: "var(--chart-corporate)",
  competitor: "var(--chart-competitor)",
  editorial: "var(--chart-editorial)",
  ugc: "var(--chart-ugc)",
  reference: "var(--chart-reference)",
  institutional: "var(--chart-institutional)",
  other: "var(--chart-other)",
};

function typeColor(t: string) {
  return TYPE_COLORS[t] ?? "var(--chart-other)";
}

export default function Dashboard() {
  const models = useModels();
  // Filters come from the topbar via URL search params. Read them from
  // location directly (wouter's useSearch triggers re-render on navigation
  // but can return an empty string under a based router).
  useSearch();
  const params = new URLSearchParams(window.location.search);
  const period = params.get("days") ?? "30";
  const model = params.get("model") || undefined;
  const topic = params.get("topic") || undefined;
  const days = period === "90" ? 90 : period === "180" ? 180 : 30;
  const all = period === "all";
  const { data, isLoading } = useGetDashboard({ days, all, model, topic });
  const { data: citationQuality } = useGetCitationQuality({ days: all ? 365 : days });

  if (isLoading && !data) {
    return <div className="p-4 sm:p-8 text-slate-quiet">Loading citation intelligence...</div>;
  }

  if (!data) return null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-8 sm:space-y-12">
        <header className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div>
            <h1 className="steep-heading text-2xl sm:text-3xl tracking-tight mb-2">
              Citation Intelligence
            </h1>
            <p className="text-[15px] text-slate-quiet max-w-[640px] leading-relaxed">
              Which sources do LLMs reference the most — and how do they behave when citing?
              Every figure below is computed from real simulation runs
              {data.days === 0 ? " across all recorded history" : ` over the last ${data.days} days (UTC)`}
              {model ? `, filtered to ${modelLabel(models, model)}` : ""}
              {topic ? ` across ${topic === "__uncategorized__" ? "uncategorized" : topic} companies` : ""}.
            </p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <MethodologyPanel days={days} />
          </div>
        </header>

        <section className="space-y-4">
          <SectionHeading title="Outcome Quality" subtitle="Aggregate performance across all tracked companies in this window." />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
            <StatCard
              label="Visibility"
              value={formatPercent(data.totals.overallVisibilityPct)}
              icon={BarChart}
              hint="Share of all simulations mentioning a brand"
              testId="stat-visibility"
            />
            <StatCard
              label="Avg Brand Position"
              value={data.quality?.avgBrandPosition != null ? data.quality.avgBrandPosition.toFixed(1) : "\u2014"}
              icon={Layers}
              hint={`${formatNumber(data.quality?.positionedBrandRuns)} positioned runs`}
              testId="stat-brand-position"
            />
            <StatCard
              label="Top-3 Citation Share"
              value={formatPercent(data.quality?.top3CitationSharePct)}
              icon={BarChart}
              hint={`${formatNumber(data.quality?.positionedCitations)} positioned citations`}
              testId="stat-top3-share"
            />
            <StatCard
              label="Search Coverage"
              value={formatPercent(data.quality?.searchCoveragePct)}
              icon={Globe}
              hint="Share of runs confirmed citation-eligible"
              testId="stat-search-coverage"
            />
            <StatCard
              label="Avg Citations/Run"
              value={data.concentration?.avgCitationsPerRun != null ? data.concentration.avgCitationsPerRun.toFixed(1) : "\u2014"}
              icon={Link2}
              hint="Across citation-eligible runs"
              testId="stat-avg-citations"
            />
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeading title="Execution Volume" subtitle="Underlying simulation scale and extraction metrics." />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <StatCard label="Companies" value={formatNumber(data.totals.companies)} icon={Building2} testId="stat-companies" />
            <StatCard label="Prompts" value={formatNumber(data.totals.prompts)} icon={MessageSquare} testId="stat-prompts" />
            <StatCard
              label="Simulations"
              value={formatNumber(data.totals.runs)}
              icon={Zap}
              hint={`${formatNumber(data.totals.citationEligibleRuns)} eligible · ${formatNumber(data.totals.searchIneligibleRuns)} no-search${data.totals.legacyRuns ? ` · ${formatNumber(data.totals.legacyRuns)} legacy` : ""}`}
              testId="stat-runs"
            />
            <StatCard
              label="Verified Retrievals"
              value={formatNumber(data.totals.verifiedRetrievals)}
              icon={Globe}
              hint={`${formatNumber(data.totals.retrievals)} raw stored`}
              testId="stat-verified-retrievals"
            />
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeading
            title="Most Referenced Sources"
            subtitle="Domains ranked by verified provider citations from citation-eligible runs."
          />
          <div className="bg-paper border border-border rounded-2xl overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="bg-fog border-b border-border">
                  <th className="font-medium text-slate-quiet text-left py-2.5 px-4 w-10">#</th>
                  <th className="font-medium text-slate-quiet text-left py-2.5 px-4">Domain</th>
                  <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Verified Citations</th>
                  <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Avg Position</th>
                  <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Model Consensus</th>
                  <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Companies</th>
                  <th className="font-medium text-slate-quiet text-left py-2.5 px-4">Categories</th>
                </tr>
              </thead>
              <tbody>
                {data.topDomains.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-quiet">
                      No citations recorded in this window yet. Run simulations to populate.
                    </td>
                  </tr>
                )}
                {data.topDomains.map((d, i) => (
                  <tr key={d.domain} className="border-b border-border last:border-0 hover:bg-fog">
                    <td className="py-3 px-4 text-slate-quiet font-mono text-xs">{i + 1}</td>
                    <td className="py-3 px-4 font-medium">{d.domain}</td>
                    <td className="py-3 px-4 text-right">{formatNumber(d.retrievals)}</td>
                    <td className="py-3 px-4 text-right text-slate-quiet">
                      {d.avgPosition != null ? d.avgPosition.toFixed(1) : "\u2014"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-medium">{d.modelCount}</span>
                        <span className="text-slate-quiet text-xs">
                          {d.modelCount === 1 ? "model" : "models"}
                        </span>
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-slate-quiet">{d.companiesCitedFor}</td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {d.domainTypes.map(t => (
                          <span key={t} className="px-2 py-0.5 bg-mist text-[11px] rounded-full font-medium text-ash">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <ConcentrationCard
            label="Unique Domains Cited"
            value={formatNumber(data.concentration.uniqueDomains)}
            hint="Distinct domains across verified citations"
            icon={Globe}
          />
          <ConcentrationCard
            label="Avg Citations / Run"
            value={data.concentration.avgCitationsPerRun != null ? data.concentration.avgCitationsPerRun.toFixed(1) : "\u2014"}
            hint="Verified citations per citation-eligible run"
            icon={Layers}
          />
          <ConcentrationCard
            label="Top-5 Domain Share"
            value={formatPercent(data.concentration.top5SharePct)}
            hint="Share of verified citations held by the 5 biggest domains"
            icon={BarChart}
          />
        </div>

        <section className="space-y-4">
          <SectionHeading
            title="Model Source Mix"
            subtitle="Per model, the share of verified provider citations by source category."
          />
            <div className="bg-paper border border-border rounded-2xl p-4 sm:p-5 space-y-6">
            {data.modelSourceMix.length === 0 ? (
              <div className="py-8 text-center text-slate-quiet">
                No citation data by model yet.
              </div>
            ) : (
              <>
                {data.modelSourceMix.map(m => (
                  <div key={m.model} className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <span className="font-medium text-sm">{modelLabel(models, m.model)}</span>
                      <span className="text-xs text-slate-quiet">
                        {formatNumber(m.totalRetrievals)} verified citations
                      </span>
                    </div>
                    <div className="h-3 w-full rounded-full overflow-hidden flex bg-mist">
                      {m.mix.map(entry => (
                        <div
                          key={entry.domainType}
                          title={`${entry.domainType}: ${entry.sharePct}%`}
                          style={{
                            width: `${entry.sharePct}%`,
                            backgroundColor: typeColor(entry.domainType),
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {m.mix.map(entry => (
                        <span key={entry.domainType} className="inline-flex items-center gap-1.5 text-[11px] text-slate-quiet">
                          <span
                            className="w-2 h-2 rounded-full inline-block"
                            style={{ backgroundColor: typeColor(entry.domainType) }}
                          />
                          {entry.domainType} {Math.round(entry.sharePct)}%
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="space-y-4">
            <SectionHeading
              title="Top Cited Pages"
              subtitle="Page-level URLs from verified provider citations."
            />
            <div className="bg-paper border border-border rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="bg-fog border-b border-border">
                    <th className="font-medium text-slate-quiet text-left py-2.5 px-4">URL</th>
                    <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Verified Citations</th>
                    <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Avg Position</th>
                    <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Models</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topUrls.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-slate-quiet">
                        No page-level URL data recorded yet.
                      </td>
                    </tr>
                  )}
                  {data.topUrls.map(u => (
                    <tr key={u.url} className="border-b border-border last:border-0 hover:bg-fog">
                      <td className="py-3 px-4 max-w-[280px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <Link2 className="w-3.5 h-3.5 text-slate-quiet shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium truncate" title={u.url}>
                              {u.url.replace(/^https?:\/\//, "")}
                            </div>
                            <div className="text-[11px] text-slate-quiet">{u.domain}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">{formatNumber(u.retrievals)}</td>
                      <td className="py-3 px-4 text-right text-slate-quiet">
                        {u.avgPosition != null ? u.avgPosition.toFixed(1) : "\u2014"}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-quiet">{u.modelCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeading
              title="Performance Trend"
              subtitle="Daily visibility and verified citation depth, with run denominators shown on hover."
            />
            <div className="bg-paper border border-border rounded-2xl p-3 sm:p-5">
              {data.trend.length === 0 ? (
                <div className="py-16 text-center text-slate-quiet">
                  No activity recorded in this window.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={data.trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trendCitationDepth" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-editorial)" stopOpacity={0.16} />
                        <stop offset="100%" stopColor="var(--chart-editorial)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "var(--slate-quiet)" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(d: string) => d.slice(5)}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11, fill: "var(--slate-quiet)" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => Number(v).toFixed(1)}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11, fill: "var(--slate-quiet)" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${v}%`}
                      domain={[0, 100]}
                    />
                    <YAxis yAxisId="sample" hide domain={[0, "dataMax"]} />
                    <Tooltip
                      content={<PerformanceTooltip data={data.trend} />}
                      contentStyle={{ fontSize: 12, borderRadius: 16, border: "1px solid var(--border)", padding: "8px 12px" }}
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="citationsPerEligibleRun"
                      name="Citations / eligible run"
                      stroke="var(--chart-editorial)"
                      strokeWidth={1.5}
                      fill="url(#trendCitationDepth)"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="visibilityPct"
                      name="Visibility"
                      stroke="var(--chart-institutional)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                    <Line
                      yAxisId="sample"
                      dataKey="runs"
                      name="Simulations"
                      stroke="transparent"
                      dot={false}
                      activeDot={false}
                      legendType="none"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
              {data.trend.length > 0 && (
                <p className="px-2 pt-2 text-[11px] text-slate-quiet">
                  Hover a day for mentions / simulations and verified citations / eligible runs.
                  Days without eligible runs have no citation-depth value.
                </p>
              )}
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="space-y-4">
            <SectionHeading title="Portfolio Visibility" />
            <div className="bg-paper border border-border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-fog border-b border-border">
                    <th className="font-medium text-slate-quiet text-left py-2.5 px-4">Company</th>
                    <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Visibility</th>
                    <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Verified Citations</th>
                  </tr>
                </thead>
                <tbody>
                  {data.companies.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-slate-quiet">
                        No company data available. Run simulations to populate.
                      </td>
                    </tr>
                  )}
                  {data.companies.map(c => (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-fog">
                      <td className="py-3 px-4 font-medium">{c.name}</td>
                      <td className="py-3 px-4 text-right">{formatPercent(c.visibilityPct)}</td>
                      <td className="py-3 px-4 text-right text-slate-quiet">{formatNumber(c.retrievals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeading title="Model Behavior" />
            <div className="bg-paper border border-border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-fog border-b border-border">
                    <th className="font-medium text-slate-quiet text-left py-2.5 px-4">Model</th>
                    <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Mention Rate</th>
                    <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Avg Citations</th>
                  </tr>
                </thead>
                <tbody>
                  {data.models.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-slate-quiet">
                        No model data available.
                      </td>
                    </tr>
                  )}
                  {data.models.map(m => (
                    <tr key={m.model} className="border-b border-border last:border-0 hover:bg-fog">
                      <td className="py-3 px-4 font-medium">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "var(--chart-other)" }} />
                          {m.label}
                          {m.supportsSearch === false && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-mist text-ash uppercase tracking-wide">No search</span>
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">{formatPercent(m.mentionRatePct)}</td>
                      <td className="py-3 px-4 text-right text-slate-quiet">
                        {m.avgCitations != null ? m.avgCitations.toFixed(1) : "\u2014"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="space-y-4" data-testid="citation-reliability">
          <SectionHeading
            title="Citation reliability by model"
            subtitle="Distinguishes honest zeros (searched, no citation metadata) from extraction failures, tool rejections, and answer-only models. Verified citations are never scraped from answer text."
          />
          <div className="bg-paper border border-border rounded-2xl overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="bg-fog border-b border-border">
                  <th className="font-medium text-slate-quiet text-left py-2.5 px-4">Model</th>
                  <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Cited</th>
                  <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Honest zeros</th>
                  <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Extraction failed</th>
                  <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Tool rejected</th>
                  <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Answer-only</th>
                  <th className="font-medium text-slate-quiet text-right py-2.5 px-4">Verified citations</th>
                </tr>
              </thead>
              <tbody>
                {(citationQuality?.models ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-quiet">
                      No citation-quality data in this window yet.
                    </td>
                  </tr>
                )}
                {(citationQuality?.models ?? []).map((m) => (
                  <tr key={m.model} className="border-b border-border last:border-0 hover:bg-fog">
                    <td className="py-3 px-4 font-medium">
                      <span className="inline-flex items-center gap-2">
                        {m.label}
                        {m.supportsSearch === false && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-mist text-ash uppercase tracking-wide">No search</span>
                        )}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums">{formatNumber(m.outcomes.providerCited)}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{formatNumber(m.outcomes.searchNoCitations)}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{formatNumber(m.outcomes.extractionFailed)}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{formatNumber(m.outcomes.toolRejected)}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{formatNumber(m.outcomes.answerOnly)}</td>
                    <td className="py-3 px-4 text-right tabular-nums text-slate-quiet">{formatNumber(m.verifiedCitations)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="steep-heading text-sm">
        {title}
      </h2>
      {subtitle && (
        <p className="text-[13px] text-slate-quiet">{subtitle}</p>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, hint, testId }: { label: string; value: string | number; icon: any; hint?: string; testId?: string }) {
  return (
    <div className="bg-paper border border-border rounded-2xl p-3 sm:p-4 flex flex-col gap-2 sm:gap-3" data-testid={testId}>
      <div className="flex items-center gap-2 text-slate-quiet">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl sm:text-3xl font-medium tracking-tight" data-testid={testId ? `${testId}-value` : undefined}>{value}</div>
      {hint && <div className="text-[11px] text-slate-quiet -mt-1">{hint}</div>}
    </div>
  );
}

function ConcentrationCard({ label, value, hint, icon: Icon, testId }: { label: string; value: string; hint: string; icon: any; testId?: string }) {
  return (
    <div className="bg-paper border border-border rounded-2xl p-5 flex flex-col gap-2" data-testid={testId}>
      <div className="flex items-center gap-2 text-slate-quiet">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-medium tracking-tight" data-testid={testId ? `${testId}-value` : undefined}>{value}</div>
      <p className="text-[12px] text-slate-quiet">{hint}</p>
    </div>
  );
}

type PerformanceTrendDatum = {
  date: string;
  runs: number;
  mentions: number;
  eligibleRuns: number;
  retrievals: number;
  visibilityPct?: number | null;
  citationsPerEligibleRun?: number | null;
};

function PerformanceTooltip({
  active,
  payload,
  label,
  data,
}: {
  active?: boolean;
  payload?: Array<{ payload: PerformanceTrendDatum }>;
  label?: string;
  data: PerformanceTrendDatum[];
}) {
  const point = payload?.[0]?.payload ?? data.find((item) => item.date === label);
  if (!active || !point) return null;

  return (
    <div className="rounded-xl border border-border bg-paper px-3 py-2 text-xs shadow-sm">
      <div className="mb-2 font-medium">{point.date}</div>
      <div className="space-y-1 text-slate-quiet">
        <div className="flex min-w-52 justify-between gap-5">
          <span>Visibility</span>
          <span className="font-medium text-ash">
            {point.visibilityPct != null ? `${Math.round(point.visibilityPct)}%` : "\u2014"}
          </span>
        </div>
        <div className="flex justify-between gap-5">
          <span>Verified citations / eligible run</span>
          <span className="font-medium text-ash">
            {point.citationsPerEligibleRun != null ? point.citationsPerEligibleRun.toFixed(1) : "\u2014"}
          </span>
        </div>
        <div className="mt-2 border-t border-border pt-2">
          {formatNumber(point.mentions)} mentions / {formatNumber(point.runs)} simulations
        </div>
        <div>
          {formatNumber(point.retrievals)} verified citations / {formatNumber(point.eligibleRuns)} eligible runs
        </div>
        {point.eligibleRuns === 0 && (
          <div className="pt-1 text-[11px]">No verified citation denominator for this day.</div>
        )}
      </div>
    </div>
  );
}
