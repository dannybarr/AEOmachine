export interface ModelCitationSourceInput {
  runId: number;
  model: string;
  brandMentioned: boolean;
  domain: string;
  domainType: string;
  url: string | null;
  position: number;
}

export interface ModelCitationSource {
  domain: string;
  domainType: string;
  topUrl: string | null;
  retrievals: number;
  sharePct: number;
  avgPosition: number;
  associatedAnswers: number;
  businessMentionedAnswers: number;
  businessMentionRatePct: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function aggregateModelCitationSources(
  rows: ModelCitationSourceInput[],
): Map<string, ModelCitationSource[]> {
  const totals = new Map<string, number>();
  const groups = new Map<
    string,
    Map<
      string,
      {
        domainType: string;
        positions: number[];
        runMentions: Map<number, boolean>;
        urlCounts: Map<string, number>;
      }
    >
  >();

  for (const row of rows) {
    totals.set(row.model, (totals.get(row.model) ?? 0) + 1);
    let modelGroups = groups.get(row.model);
    if (!modelGroups) {
      modelGroups = new Map();
      groups.set(row.model, modelGroups);
    }
    let source = modelGroups.get(row.domain);
    if (!source) {
      source = {
        domainType: row.domainType,
        positions: [],
        runMentions: new Map(),
        urlCounts: new Map(),
      };
      modelGroups.set(row.domain, source);
    }
    source.positions.push(row.position);
    source.runMentions.set(row.runId, row.brandMentioned);
    if (row.url) {
      source.urlCounts.set(row.url, (source.urlCounts.get(row.url) ?? 0) + 1);
    }
  }

  const result = new Map<string, ModelCitationSource[]>();
  for (const [model, modelGroups] of groups) {
    const total = totals.get(model) ?? 0;
    result.set(
      model,
      [...modelGroups.entries()]
        .map(([domain, source]) => {
          const retrievals = source.positions.length;
          const associatedAnswers = source.runMentions.size;
          const businessMentionedAnswers = [...source.runMentions.values()].filter(Boolean).length;
          const topUrl =
            [...source.urlCounts.entries()].sort(
              (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
            )[0]?.[0] ?? null;
          return {
            domain,
            domainType: source.domainType,
            topUrl,
            retrievals,
            sharePct: total > 0 ? round1((100 * retrievals) / total) : 0,
            avgPosition: round1(
              source.positions.reduce((sum, position) => sum + position, 0) / retrievals,
            ),
            associatedAnswers,
            businessMentionedAnswers,
            businessMentionRatePct:
              associatedAnswers > 0
                ? round1((100 * businessMentionedAnswers) / associatedAnswers)
                : 0,
          };
        })
        .sort(
          (a, b) =>
            b.retrievals - a.retrievals ||
            a.avgPosition - b.avgPosition ||
            a.domain.localeCompare(b.domain),
        ),
    );
  }
  return result;
}