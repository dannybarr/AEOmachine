import { useListModels, getListModelsQueryKey } from "@workspace/api-client-react";

export function useModels() {
  const { data } = useListModels({
    query: { queryKey: getListModelsQueryKey(), staleTime: Infinity },
  });
  return data ?? [];
}

// Canonical label/color helpers live in one shared module.
export { modelLabel, modelProvider, providerColor } from "@/lib/model-meta";
