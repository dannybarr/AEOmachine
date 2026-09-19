import { logger } from "./logger";

/**
 * Canonical answer-engine model registry.
 *
 * Every model id is a Requesty router id, probe-verified before being added:
 * we streamed a real completion with `tools: [{ type: "web_search" }]` and
 * inspected the returned metadata. `supportsSearch: true` means the provider
 * actually attached grounded citation metadata (delta.annotations[].url_citation
 * and/or delta.web_search.content[]) on streamed chunks; `false` means the
 * model answers but performs no verifiable web retrieval through Requesty,
 * so its runs are citation-ineligible and never enter citation denominators.
 *
 * At boot the registry is re-validated against Requesty's live model list:
 * entries missing from the router are disabled with a visible reason rather
 * than silently falling back to another model.
 */

export interface RegistryModel {
  /** Requesty model id (canonical, stored on every run). */
  id: string;
  provider: string;
  family: string;
  label: string;
  version: string;
  /** Provider performs real web retrieval with verifiable citation metadata. */
  supportsSearch: boolean;
  /** How verified citations are extracted for this model family. */
  extraction: "streamed_metadata" | "none";
  /** Stable display order. */
  order: number;
  /** Static availability. Flipped off by live validation when missing. */
  enabled: boolean;
  /** Human-readable reason when disabled/unavailable. */
  unavailableReason: string | null;
}

const REGISTRY: RegistryModel[] = [
  {
    id: "openai/gpt-5",
    provider: "OpenAI",
    family: "GPT",
    label: "GPT-5",
    version: "gpt-5",
    supportsSearch: false,
    extraction: "none",
    order: 1,
    enabled: true,
    unavailableReason: null,
  },
  {
    id: "openai/gpt-5-mini",
    provider: "OpenAI",
    family: "GPT",
    label: "GPT-5 Mini",
    version: "gpt-5-mini",
    supportsSearch: false,
    extraction: "none",
    order: 2,
    enabled: true,
    unavailableReason: null,
  },
  {
    id: "anthropic/claude-sonnet-4-5",
    provider: "Anthropic",
    family: "Claude",
    label: "Claude Sonnet 4.5",
    version: "claude-sonnet-4-5",
    supportsSearch: true,
    extraction: "streamed_metadata",
    order: 3,
    enabled: true,
    unavailableReason: null,
  },
  {
    id: "google/gemini-2.5-flash",
    provider: "Google",
    family: "Gemini",
    label: "Gemini 2.5 Flash",
    version: "gemini-2.5-flash",
    supportsSearch: true,
    extraction: "streamed_metadata",
    order: 4,
    enabled: true,
    unavailableReason: null,
  },
  {
    id: "perplexity/sonar",
    provider: "Perplexity",
    family: "Sonar",
    label: "Perplexity Sonar",
    version: "sonar",
    supportsSearch: true,
    extraction: "streamed_metadata",
    order: 5,
    enabled: true,
    unavailableReason: null,
  },
  {
    id: "xai/grok-4-fast-non-reasoning",
    provider: "xAI",
    family: "Grok",
    label: "Grok 4 Fast",
    version: "grok-4-fast-non-reasoning",
    supportsSearch: true,
    extraction: "streamed_metadata",
    order: 6,
    enabled: true,
    unavailableReason: null,
  },
  {
    id: "moonshot/kimi-k3",
    provider: "Moonshot",
    family: "Kimi",
    label: "Kimi K3",
    version: "kimi-k3",
    supportsSearch: false,
    extraction: "none",
    order: 7,
    enabled: true,
    unavailableReason: null,
  },
  {
    id: "deepinfra/meta-llama/Llama-3.3-70B-Instruct",
    provider: "Meta",
    family: "Llama",
    label: "Llama 3.3 70B",
    version: "llama-3.3-70b-instruct",
    supportsSearch: false,
    extraction: "none",
    order: 8,
    enabled: true,
    unavailableReason: null,
  },
];

/** Legacy un-prefixed ids stored before multi-provider support. */
export const LEGACY_ALIASES: Record<string, string> = {
  "gpt-5": "openai/gpt-5",
  "gpt-5-mini": "openai/gpt-5-mini",
};

// Live-validation state, keyed by model id.
const validationFailures = new Map<string, string>();
let validatedAt: string | null = null;

export interface RegistryView extends RegistryModel {
  /** enabled AND passed the latest live Requesty validation. */
  available: boolean;
}

function toView(m: RegistryModel): RegistryView {
  const failure = validationFailures.get(m.id);
  const available = m.enabled && !failure;
  return {
    ...m,
    available,
    unavailableReason: failure ?? m.unavailableReason,
  };
}

/** Full registry, stable order, including unavailable entries with reasons. */
export function getRegistry(): RegistryView[] {
  return [...REGISTRY].sort((a, b) => a.order - b.order).map(toView);
}

export function getRegistryValidatedAt(): string | null {
  return validatedAt;
}

/** Models eligible for new runs. */
export function enabledModels(): RegistryView[] {
  return getRegistry().filter((m) => m.available);
}

export function enabledModelIds(): string[] {
  return enabledModels().map((m) => m.id);
}

export function getModel(id: string): RegistryView | undefined {
  const m = REGISTRY.find((x) => x.id === id);
  return m ? toView(m) : undefined;
}

export class UnknownModelError extends Error {
  constructor(id: string) {
    super(`Unknown model id "${id}" — not in the model registry`);
    this.name = "UnknownModelError";
  }
}

/**
 * Resolve a stored/user-supplied model id to a canonical registry id.
 * Legacy un-prefixed ids are normalized; anything else unknown is rejected
 * rather than silently substituted.
 */
export function resolveModelStrict(id: string): string {
  const normalized = LEGACY_ALIASES[id] ?? id;
  if (!REGISTRY.some((m) => m.id === normalized)) throw new UnknownModelError(id);
  return normalized;
}

/** Immutable model coverage captured when a tracking job starts. */
export function registrySnapshot(): {
  id: string;
  label: string;
  provider: string;
  supportsSearch: boolean;
}[] {
  return enabledModels().map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    supportsSearch: m.supportsSearch,
  }));
}

/**
 * Validate registry ids against Requesty's live model list. Missing ids are
 * marked unavailable with a reason (visible in /models); they are never
 * silently swapped for another model. Network failure leaves the last known
 * validation state untouched.
 */
export async function validateRegistry(): Promise<void> {
  const baseURL = process.env["OPENAI_BASE_URL"];
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!baseURL || !apiKey) return;
  try {
    const res = await fetch(`${baseURL.replace(/\/$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`model list returned ${res.status}`);
    const body = (await res.json()) as { data?: { id?: string }[] };
    const live = new Set((body.data ?? []).map((m) => m.id).filter(Boolean));
    if (live.size === 0) throw new Error("model list was empty");
    validationFailures.clear();
    for (const m of REGISTRY) {
      if (!live.has(m.id)) {
        validationFailures.set(
          m.id,
          "Model id not found on the Requesty router (failed live validation)",
        );
      }
    }
    validatedAt = new Date().toISOString();
    if (validationFailures.size > 0) {
      logger.warn(
        { missing: [...validationFailures.keys()] },
        "Model registry validation: some models unavailable",
      );
    } else {
      logger.info({ count: REGISTRY.length }, "Model registry validated against Requesty");
    }
  } catch (err) {
    logger.warn({ err }, "Model registry validation failed; keeping previous state");
  }
}
