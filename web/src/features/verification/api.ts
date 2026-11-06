import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, data } from "../../api/client";
import type { components } from "../../api/schema";
import type { Findings, Job } from "../lectures/api";

export type PassOptions = components["schemas"]["PassOptions"];
export type OptionsPatch = components["schemas"]["OptionsPatch"];
export type PromptConfig = components["schemas"]["PromptConfig"];
export type PromptRules = components["schemas"]["PromptRules"];
export type PassRequest = components["schemas"]["PassRequest"];
export type Estimate = components["schemas"]["Estimate"];
export type Preview = components["schemas"]["Preview"];
export type PassMetrics = components["schemas"]["PassMetrics"];
export type PromptCatalog = components["schemas"]["PromptCatalog"];
export type OpenRouterModel = components["schemas"]["OpenRouterModel"];
export type LayaStatus = components["schemas"]["LayaStatusOut"];
export type Provider = PassOptions["provider"];
/** The generated type marks every field with a default as optional; the server always sends them all. */
export type Settings = Omit<PassOptions, "prompt"> & {
  prompt: Required<Omit<PromptConfig, "rules">> & { rules: Required<PromptRules> };
};
export type Verdict = "CORRECT" | "FALSE" | "NOT_SURE";

export const VERIFY_KIND = "verify";

/** The saved verifier settings (F-080, F-085, F-086): what a pass uses unless it sends its own. */
export function useVerifierSettings() {
  return useQuery({ queryKey: ["verifier-settings"], queryFn: async () => (await data(api.GET("/api/verification/settings"))) as Settings });
}

/** Change some settings. The screen shows the change at once (an optimistic update) and puts the old value
 *  back if the server refuses. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: OptionsPatch) => data(api.PATCH("/api/verification/settings", { body: patch })),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ["verifier-settings"] });
      const before = queryClient.getQueryData<Settings>(["verifier-settings"]);
      if (before) queryClient.setQueryData<Settings>(["verifier-settings"], { ...before, ...definedOnly(patch) } as Settings);
      return { before };
    },
    onError: (_error, _patch, context) => {
      if (context?.before) queryClient.setQueryData(["verifier-settings"], context.before);
    },
    onSuccess: (saved) => queryClient.setQueryData(["verifier-settings"], saved),
  });
}

/** A patch only changes the fields it names; the optimistic copy must do the same. */
export function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function usePromptCatalog() {
  return useQuery({ queryKey: ["prompt-catalog"], queryFn: () => data(api.GET("/api/verification/prompts")), staleTime: Infinity });
}

/** F-087: the estimate of a pass, asked again (after a short pause) whenever the findings or settings change. */
export function useEstimate(lectureId: number, findingIds: number[], settings: Settings | undefined) {
  return useQuery({
    queryKey: ["estimate", lectureId, findingIds, settings],
    enabled: findingIds.length > 0 && !!settings,
    placeholderData: keepPreviousData,
    meta: { silent: true },
    retry: false,
    queryFn: async ({ signal }) => {
      await new Promise((resolve) => setTimeout(resolve, 250)); // typing in a field must not send a request per key
      if (signal.aborted) throw new Error("superseded");
      return data(
        api.POST("/api/lectures/{lecture_id}/verification/estimate", {
          params: { path: { lecture_id: lectureId } },
          body: { scope: "ALL", finding_ids: findingIds }, // the ids win; the scope is not read
        }),
      );
    },
  });
}

export function usePreview(lectureId: number) {
  return useMutation({
    mutationFn: (findingId: number) =>
      data(
        api.POST("/api/lectures/{lecture_id}/verification/preview", {
          params: { path: { lecture_id: lectureId } },
          body: { finding_id: findingId },
        }),
      ),
  });
}

/** F-088: start a pass over exactly these findings with the saved settings. */
export function useStartPass(lectureId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (findingIds: number[]): Promise<Job> => {
      const started = await data(
        api.POST("/api/lectures/{lecture_id}/verification", {
          params: { path: { lecture_id: lectureId } },
          body: { scope: "ALL", finding_ids: findingIds }, // the ids win; the scope is not read
        }),
      );
      return started.job;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

/** A pass's numbers (F-089); asked again while it runs. */
export function usePassMetrics(jobId: string | null, running: boolean) {
  return useQuery({
    queryKey: ["pass-metrics", jobId],
    enabled: jobId !== null,
    refetchInterval: running ? 2_000 : false,
    meta: { silent: true },
    queryFn: () => data(api.GET("/api/verification/passes/{job_id}", { params: { path: { job_id: jobId! } } })),
  });
}

export function useApproveAll(lectureId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => data(api.POST("/api/lectures/{lecture_id}/verification/approve", { params: { path: { lecture_id: lectureId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["findings", lectureId] }),
  });
}

/** F-065 / the human override: the user's verdict on one finding. The chip changes at once, before the server
 *  answers (an optimistic update); if the server refuses, the old verdict comes back. */
export function useSetVerdict(lectureId: number) {
  const queryClient = useQueryClient();
  const key = ["findings", lectureId];
  return useMutation({
    mutationFn: ({ findingId, verdict, boundary }: { findingId: number; verdict: Verdict; boundary?: string }) =>
      data(
        api.PUT("/api/findings/{finding_id}/verdict", {
          params: { path: { finding_id: findingId } },
          body: { verdict, boundary: (boundary ?? null) as never },
        }),
      ),
    onMutate: async ({ findingId, verdict, boundary }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<Findings>(key);
      queryClient.setQueryData<Findings>(key, (old) =>
        old ? { ...old, findings: old.findings.map((f) => (f.id === findingId ? withHumanVerdict(f, verdict, boundary) : f)) } : old,
      );
      return { before };
    },
    onError: (_error, _vars, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

type FindingRow = Findings["findings"][number];

/** The finding as it will look once the server has saved the user's verdict. */
export function withHumanVerdict(f: FindingRow, verdict: Verdict, boundary?: string): FindingRow {
  return { ...f, verdict: { verdict, boundary: boundary ?? f.verdict?.boundary ?? null, verifier: "human", model: null } };
}

/** Grow a finding over the words its start or end is missing. */
export function useExpand(lectureId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (findingId: number) => data(api.POST("/api/findings/{finding_id}/expand", { params: { path: { finding_id: findingId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["findings", lectureId] }),
  });
}

export function useLayaStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["laya-status"],
    enabled,
    meta: { silent: true },
    queryFn: () => data(api.GET("/api/settings/laya")),
  });
}

/** F-081: the Gemini models the saved key can call; asked only when the user presses the button. */
export function useGeminiModels() {
  return useMutation({ mutationFn: () => data(api.GET("/api/settings/ai/gemini/models")) });
}

/** F-083: OpenRouter's catalog, searched on the server with live prices. */
export function useOpenRouterModels(q: string, category: string, enabled: boolean) {
  return useQuery({
    queryKey: ["openrouter-models", q, category],
    enabled,
    placeholderData: keepPreviousData,
    meta: { silent: true },
    queryFn: () => data(api.GET("/api/settings/ai/openrouter/models", { params: { query: { q, category, limit: 40 } } })),
  });
}
