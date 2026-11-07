// The training data on the server (phase 20): counters and rows with their lineage, the JSONL files, the old app's
// bank import, clearing, and a Tafrigh run's sentences saved for Laya.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, data } from "../../api/client";
import type { components } from "../../api/schema";

type Schemas = components["schemas"];
export type TrainingPage = Schemas["TrainingPage"];
export type TrainingRow = Schemas["TrainingRow"];
export type TrainingCounts = Schemas["TrainingCounts"];
export type TafrighSaved = Schemas["TafrighSaved"];
export type Imported = Schemas["Imported"];

export type Origin = "all" | "gold" | "user" | "approval" | "legacy" | "tafrigh" | "ai";
export type TaskFilter = "all" | "verification" | "tafrigh";
export type LabelFilter = "ALL" | "CORRECT" | "FALSE" | "NOT_SURE" | "CLIPPED";
export type TrainingFilter = { origin: Origin; task: TaskFilter; label: LabelFilter; q: string; limit: number };

export function useTraining(filter: TrainingFilter) {
  return useQuery({
    queryKey: ["training", filter],
    placeholderData: keepPreviousData,
    queryFn: () =>
      data(
        api.GET("/api/training", {
          params: { query: { origin: filter.origin, task: filter.task, label: filter.label, q: filter.q.trim() || undefined, limit: filter.limit } },
        }),
      ),
  });
}

/** The JSONL line one row writes (the inspector). */
export function useTrainingRow(id: string | null) {
  return useQuery({
    queryKey: ["training-row", id],
    enabled: id !== null,
    queryFn: () => data(api.GET("/api/training/rows/{row_id}", { params: { path: { row_id: id! } } })),
  });
}

/** F-101: the file comes straight from the server, so it is the bytes the server's tests compare. */
export function exportUrl(task: "verification" | "tafrigh", goldOnly: boolean): string {
  return `/api/training/export?${new URLSearchParams({ task, gold_only: String(goldOnly) })}`;
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["training"] });
  void queryClient.invalidateQueries({ queryKey: ["training-row"] });
}

/** Import the old app's exported bank (or a Tafrigh save file). */
export function useImportFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return data(api.POST("/api/training/import", { body: {} as never, bodySerializer: () => form }));
    },
    onSuccess: () => invalidate(queryClient),
  });
}

/** Import every file in data/legacy/. */
export function useImportLegacy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => data(api.POST("/api/training/import/legacy")),
    onSuccess: () => invalidate(queryClient),
  });
}

/** F-103 */
export function useClearTraining() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => data(api.DELETE("/api/training")),
    onSuccess: () => invalidate(queryClient),
  });
}

/** F-120: what a Tafrigh run has saved for Laya (null: nothing yet). */
export function useTafrighSaved(runId: string) {
  return useQuery({
    queryKey: ["training-tafrigh", runId],
    meta: { silent: true },
    queryFn: () => data(api.GET("/api/training/tafrigh/{run_id}", { params: { path: { run_id: runId } } })),
  });
}

export function useSaveTafrigh(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { segment_ids: string[]; note: string | null }) =>
      data(api.POST("/api/training/tafrigh/{run_id}", { params: { path: { run_id: runId } }, body })),
    onSuccess: (saved) => {
      queryClient.setQueryData(["training-tafrigh", runId], saved);
      invalidate(queryClient);
    },
  });
}
