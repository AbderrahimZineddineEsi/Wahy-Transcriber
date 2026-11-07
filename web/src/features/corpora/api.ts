// The corpora screens' server calls (phase 21): the adhkar list, custom quotes, Quran and hadith browsing, the hadith
// sources, the detection settings (engine choice, Qira'ah, adhkar switch) and Laya's status.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, data } from "../../api/client";
import type { components } from "../../api/schema";

type Schemas = components["schemas"];
export type Dhikr = Schemas["DhikrOut"];
export type DhikrIn = Schemas["DhikrIn"];
export type Quote = Schemas["QuoteOut"];
export type Source = Schemas["SourceOut"];
export type CorpusInfo = Schemas["CorpusInfo"];
export type BrowsePage = Schemas["BrowsePage"];
export type DetectionSettings = Schemas["DetectionSettings"];
export type LayaStatus = Schemas["LayaStatusOut"];

const refresh = (queryClient: ReturnType<typeof useQueryClient>, ...keys: string[]) =>
  Promise.all(keys.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));

// ---- adhkar -------------------------------------------------------------------------------------------------

export const useAdhkar = () => useQuery({ queryKey: ["adhkar"], queryFn: () => data(api.GET("/api/corpora/adhkar")) });

export function useAdhkarActions() {
  const queryClient = useQueryClient();
  const done = () => refresh(queryClient, "adhkar", "corpus-info");
  return {
    add: useMutation({ mutationFn: (body: DhikrIn) => data(api.POST("/api/corpora/adhkar", { body })), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: DhikrIn }) =>
        data(api.PUT("/api/corpora/adhkar/{dhikr_id}", { params: { path: { dhikr_id: id } }, body })),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => data(api.DELETE("/api/corpora/adhkar/{dhikr_id}", { params: { path: { dhikr_id: id } } })),
      onSuccess: done,
    }),
    reset: useMutation({ mutationFn: () => data(api.POST("/api/corpora/adhkar/reset")), onSuccess: done }),
    import: useMutation({
      mutationFn: (items: Record<string, unknown>[]) => data(api.POST("/api/corpora/adhkar/import", { body: { items } })),
      onSuccess: done,
    }),
  };
}

// ---- custom quotes --------------------------------------------------------------------------------------------

export const useQuotes = () => useQuery({ queryKey: ["quotes"], queryFn: () => data(api.GET("/api/corpora/custom-quotes")) });

export function useQuoteActions() {
  const queryClient = useQueryClient();
  const done = () => refresh(queryClient, "quotes", "corpus-info");
  type Body = { t: string; ref: string };
  return {
    add: useMutation({ mutationFn: (body: Body) => data(api.POST("/api/corpora/custom-quotes", { body })), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Body }) =>
        data(api.PUT("/api/corpora/custom-quotes/{quote_id}", { params: { path: { quote_id: id } }, body })),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => data(api.DELETE("/api/corpora/custom-quotes/{quote_id}", { params: { path: { quote_id: id } } })),
      onSuccess: done,
    }),
  };
}

// ---- Quran and hadith ------------------------------------------------------------------------------------------

export type BrowseQuery = { kind: "QURAN" | "HADITH"; surah?: number; book?: string; q: string; page: number; size: number };

export function useBrowse(query: BrowseQuery) {
  return useQuery({
    queryKey: ["browse", query],
    placeholderData: keepPreviousData,
    queryFn: () =>
      data(
        api.GET("/api/corpora/browse", {
          params: { query: { kind: query.kind, surah: query.surah, book: query.book || undefined, q: query.q.trim(), offset: query.page * query.size, limit: query.size } },
        }),
      ),
  });
}

/** The indexed totals (the Quran and hadith counts come from the engine, so the first call takes seconds). */
export const useCorpusInfo = () => useQuery({ queryKey: ["corpus-info"], queryFn: () => data(api.GET("/api/corpora/info")), staleTime: 30_000 });

// ---- hadith sources ----------------------------------------------------------------------------------------------

/** The sources; while one is being prepared the list is read again every 1.5 s so its status moves on its own. */
export const useSources = () =>
  useQuery({
    queryKey: ["sources"],
    queryFn: () => data(api.GET("/api/corpora/sources")),
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === "preparing") ? 1500 : false),
  });

export function useSourceActions() {
  const queryClient = useQueryClient();
  const done = () => refresh(queryClient, "sources", "corpus-info", "browse", "health");
  const path = (source_id: string) => ({ params: { path: { source_id } } });
  return {
    prepare: useMutation({
      mutationFn: ({ id, redownload }: { id: string; redownload?: boolean }) =>
        data(api.POST("/api/corpora/sources/{source_id}/prepare", { ...path(id), body: { redownload: !!redownload } })),
      onSuccess: done,
    }),
    upload: useMutation({
      mutationFn: ({ id, file }: { id: string; file: File }) => {
        const form = new FormData();
        form.append("file", file);
        return data(api.POST("/api/corpora/sources/{source_id}/upload", { ...path(id), body: {} as never, bodySerializer: () => form }));
      },
      onSuccess: done,
    }),
    activate: useMutation({
      mutationFn: (source_id: string) => data(api.PUT("/api/corpora/active-hadith-source", { body: { source_id } })),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => data(api.DELETE("/api/corpora/sources/{source_id}", path(id))),
      onSuccess: done,
    }),
  };
}

// ---- detection settings ------------------------------------------------------------------------------------------

export const useDetectionSettings = () => useQuery({ queryKey: ["detection-settings"], queryFn: () => data(api.GET("/api/detection/settings")) });

export function useUpdateDetectionSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<DetectionSettings>) => data(api.PATCH("/api/detection/settings", { body })),
    onSuccess: (settings) => queryClient.setQueryData(["detection-settings"], settings),
  });
}

// ---- Laya --------------------------------------------------------------------------------------------------------

export const useLayaStatus = () => useQuery({ queryKey: ["laya-status"], queryFn: () => data(api.GET("/api/settings/laya")) });

export function useLayaActions() {
  const queryClient = useQueryClient();
  const done = (status: LayaStatus) => {
    queryClient.setQueryData(["laya-status"], status);
    void queryClient.invalidateQueries({ queryKey: ["health"] });
  };
  return {
    load: useMutation({
      mutationFn: (body: { checkpoint?: string; device?: string }) => data(api.POST("/api/settings/laya/load", { body })),
      onSuccess: done,
    }),
    unload: useMutation({ mutationFn: () => data(api.POST("/api/settings/laya/unload")), onSuccess: done }),
  };
}
