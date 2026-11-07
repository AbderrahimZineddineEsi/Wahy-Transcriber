// Tafrigh on the server (phase 18): the preview, the estimate, a run as a job, and the saved runs with their review.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, data } from "../../api/client";
import type { components } from "../../api/schema";
import type { Job } from "../lectures/api";
import type { RunRequest, SourceRequest } from "./settings";
import type { Segment } from "./labels";

type Schemas = components["schemas"];
export type Preview = Schemas["TafrighPreview"];
export type Estimate = Schemas["TafrighEstimate"];
export type RunSummary = Schemas["TafrighRunSummary"];
export type RunDetail = Schemas["TafrighRunDetail"];
export type ReviewItem = Schemas["ReviewItem"];
/** One decision on one sentence; the reviewer is always this web app. */
export type ReviewRequest = Omit<Schemas["TafrighReviewIn"], "reviewer_id">;
export type CompareResult = Schemas["TafrighCompareOut"];
export type OutlineEntry = Schemas["TafrighOutlineEntry"];

export const TAFRIGH_KIND = "tafrigh";

/** The sentences of a run, typed (the server sends them as free-form JSON). */
export const segmentsOf = (run: RunDetail): Segment[] => ((run.structured_json as { segments?: Segment[] }).segments ?? []) as Segment[];

/** F-106: the sentences a run would classify, asked again (after a short pause) whenever a cutting setting changes.
 *  No model is called. */
export function usePreview(lectureId: number, source: SourceRequest) {
  return useQuery({
    queryKey: ["tafrigh-preview", lectureId, source],
    placeholderData: keepPreviousData,
    retry: false,
    meta: { silent: true }, // the preview pane shows the error itself
    queryFn: async ({ signal }) => {
      await new Promise((resolve) => setTimeout(resolve, 300)); // typing a number must not send a request per key
      if (signal.aborted) throw new Error("superseded");
      return data(api.POST("/api/lectures/{lecture_id}/tafrigh/preview", { params: { path: { lecture_id: lectureId } }, body: source }));
    },
  });
}

/** F-114: requests and tokens for each mode, from the real prompts. */
export function useEstimate(lectureId: number, request: RunRequest) {
  return useQuery({
    queryKey: ["tafrigh-estimate", lectureId, request],
    placeholderData: keepPreviousData,
    retry: false,
    meta: { silent: true },
    queryFn: async ({ signal }) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (signal.aborted) throw new Error("superseded");
      return data(api.POST("/api/lectures/{lecture_id}/tafrigh/estimate", { params: { path: { lecture_id: lectureId } }, body: request }));
    },
  });
}

export function useStartRun(lectureId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: RunRequest): Promise<Job> =>
      (await data(api.POST("/api/lectures/{lecture_id}/tafrigh/runs", { params: { path: { lecture_id: lectureId } }, body: request }))).job,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

/** Stop now and keep the sentences that are finished (cancel, from the job bar, keeps nothing). */
export function useStopRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => data(api.POST("/api/tafrigh/jobs/{job_id}/stop", { params: { path: { job_id: jobId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

/** F-121: the lecture's saved runs, newest first. */
export function useRuns(lectureId: number) {
  return useQuery({
    queryKey: ["tafrigh-runs", lectureId],
    queryFn: () => data(api.GET("/api/tafrigh/runs", { params: { query: { lecture_id: lectureId } } })),
  });
}

export function useRun(runId: string | null) {
  return useQuery({
    queryKey: ["tafrigh-run", runId],
    enabled: runId !== null,
    retry: false,
    queryFn: () => data(api.GET("/api/tafrigh/runs/{run_id}", { params: { path: { run_id: runId! } } })),
  });
}

function useRunsRefresh(lectureId: number) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["tafrigh-runs", lectureId] });
}

export function useRenameRun(lectureId: number) {
  const refresh = useRunsRefresh(lectureId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, name }: { runId: string; name: string }) =>
      data(api.PATCH("/api/tafrigh/runs/{run_id}", { params: { path: { run_id: runId } }, body: { name } })),
    onSuccess: (_saved, { runId }) => {
      void queryClient.invalidateQueries({ queryKey: ["tafrigh-run", runId] });
      return refresh();
    },
  });
}

export function useDeleteRun(lectureId: number) {
  const refresh = useRunsRefresh(lectureId);
  return useMutation({
    mutationFn: (runId: string) => data(api.DELETE("/api/tafrigh/runs/{run_id}", { params: { path: { run_id: runId } } })),
    onSuccess: refresh,
  });
}

/** "Save as new" (F-121): a copy that review edits can change while the first run stays as it is. */
export function useCloneRun(lectureId: number) {
  const refresh = useRunsRefresh(lectureId);
  return useMutation({
    mutationFn: ({ runId, name }: { runId: string; name?: string }) =>
      data(api.POST("/api/tafrigh/runs/{run_id}/clone", { params: { path: { run_id: runId } }, body: { name: name ?? null } })),
    onSuccess: refresh,
  });
}

/** F-119: one decision on one sentence, saved on the server at once. The answer is the run, drawn again. */
export function useReview(lectureId: number, runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReviewRequest) => data(api.POST("/api/tafrigh/runs/{run_id}/review", { params: { path: { run_id: runId } }, body: { ...body, reviewer_id: "web_editor" } })),
    onSuccess: (detail) => {
      queryClient.setQueryData(["tafrigh-run", runId], detail);
      void queryClient.invalidateQueries({ queryKey: ["tafrigh-runs", lectureId] });
    },
  });
}

/** F-122: saved runs side by side. */
export function useCompare(runIds: string[]) {
  return useQuery({
    queryKey: ["tafrigh-compare", runIds],
    enabled: runIds.length >= 2,
    retry: false,
    meta: { silent: true }, // the comparison shows the error itself
    queryFn: () => data(api.POST("/api/tafrigh/compare", { body: { run_ids: runIds } })),
  });
}

/** The Gemini models the saved key can call; asked only when the user presses the button. */
export function useTafrighModels() {
  return useMutation({ mutationFn: () => data(api.GET("/api/tafrigh/models")) });
}

export type ExportFormat = "md" | "html" | "json";

/** F-117: the run as a file; the browser saves it. */
export async function downloadRun(runId: string, format: ExportFormat): Promise<void> {
  const file = await data(api.GET("/api/tafrigh/runs/{run_id}/export", { params: { path: { run_id: runId }, query: { format } } }));
  const url = URL.createObjectURL(new Blob([file.content], { type: `${file.mime};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** F-109: detect the quotes again with a chosen engine before a run (the ordinary detection job). */
export function useRedetect(lectureId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (engine: string): Promise<Job> =>
      (await data(api.POST("/api/lectures/{lecture_id}/detect", { params: { path: { lecture_id: lectureId } }, body: { engine } }))).job,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}
