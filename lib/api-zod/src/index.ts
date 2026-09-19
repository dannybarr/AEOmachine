export * from "./generated/api";
export * from "./generated/types";
// getPromptInsights has both path and query params, which makes the generated
// zod const (api) and query-params type (types) share a name. Re-export
// explicitly: the zod const wins; the query type is available under an alias.
export { GetPromptInsightsParams } from "./generated/api";
export type { GetPromptInsightsParams as GetPromptInsightsQueryType } from "./generated/types";
export {
  GetSiteTestParams,
  DeleteSiteTestParams,
  RunSiteAuditParams,
  AddDiscoverySuggestionParams,
  DismissDiscoverySuggestionParams,
  DismissAudienceRecommendationParams,
} from "./generated/api";
export type {
  GetSiteTestParams as GetSiteTestQueryType,
  DeleteSiteTestParams as DeleteSiteTestQueryType,
  RunSiteAuditParams as RunSiteAuditQueryType,
  AddDiscoverySuggestionParams as AddDiscoverySuggestionQueryType,
  DismissDiscoverySuggestionParams as DismissDiscoverySuggestionQueryType,
  DismissAudienceRecommendationParams as DismissAudienceRecommendationQueryType,
} from "./generated/types";
