/**
 * Shared provider/model presentation: stable colors and labels used by every
 * page so a given provider always looks the same across the product.
 * Canonical labels come from the /models registry; these helpers cover
 * provider grouping, stable colors, and legacy/unknown ids.
 */

export interface ModelMetaSource {
  id: string;
  label: string;
  provider?: string | null;
  supportsSearch?: boolean | null;
  available?: boolean;
  unavailableReason?: string | null;
}

/** Stable provider colors (used for chips, chart series, and legends). */
export const PROVIDER_COLORS: Record<string, string> = {
  OpenAI: "#0d9488",
  Anthropic: "#d97706",
  Google: "#2563eb",
  Perplexity: "#7c3aed",
  xAI: "#0f172a",
  Moonshot: "#db2777",
  Meta: "#0284c7",
};

export function providerColor(provider: string | null | undefined): string {
  return (provider && PROVIDER_COLORS[provider]) || "#64748b";
}

const LEGACY_ALIASES: Record<string, string> = {
  "gpt-5": "openai/gpt-5",
  "gpt-5-mini": "openai/gpt-5-mini",
};

/** Canonical display label for a stored model id (handles legacy ids). */
export function modelLabel(models: ModelMetaSource[], id: string): string {
  const canonical = LEGACY_ALIASES[id] ?? id;
  return models.find((m) => m.id === canonical)?.label ?? id;
}

export function modelProvider(models: ModelMetaSource[], id: string): string | null {
  const canonical = LEGACY_ALIASES[id] ?? id;
  return models.find((m) => m.id === canonical)?.provider ?? null;
}

/** Human copy for the distinct run states. */
export function searchStatusLabel(
  searchStatus: string | null | undefined,
  citationEligible: boolean | null | undefined,
): { label: string; tone: "ok" | "muted" | "warn" } {
  if (searchStatus === "provider_cited") {
    return { label: "Provider-cited", tone: "ok" };
  }
  if (searchStatus === "search_no_citations") {
    return { label: "Searched · no citations", tone: "muted" };
  }
  if (searchStatus === "extraction_failed") {
    return { label: "Citation extraction failed", tone: "warn" };
  }
  if (searchStatus === "provider_search") {
    // Legacy label (pre-outcome-model): search performed, granularity unknown.
    return { label: "Verified search", tone: "ok" };
  }
  if (searchStatus === "unsupported") {
    return { label: "Search unsupported", tone: "muted" };
  }
  if (searchStatus === "tool_rejected") {
    return { label: "Search rejected", tone: "warn" };
  }
  if (citationEligible == null && searchStatus == null) {
    return { label: "Legacy run", tone: "muted" };
  }
  return { label: "Unknown", tone: "muted" };
}

/** Human copy for the visibility ladder. */
export function visibilityRungLabel(
  visibilityRung: string | null | undefined,
): { label: string; tone: "ok" | "muted" | "warn" } | null {
  if (visibilityRung === "recommended") return { label: "Recommended", tone: "ok" };
  if (visibilityRung === "cited") return { label: "Cited", tone: "ok" };
  if (visibilityRung === "mentioned") return { label: "Mentioned", tone: "muted" };
  if (visibilityRung === "absent") return { label: "Absent", tone: "warn" };
  return null;
}
