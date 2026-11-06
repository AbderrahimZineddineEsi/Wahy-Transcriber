import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, data } from "../../api/client";
import type { components } from "../../api/schema";

export type RequestRow = components["schemas"]["RequestRow"];
export type RequestDetail = components["schemas"]["RequestDetail"];
export type RequestFinding = components["schemas"]["RequestFinding"];

export type LogFilter = { lecture: number | null; job: string | null; provider: string; ok: "all" | "ok" | "failed"; limit: number };

/** F-095: the request log, newest first. The log changes while a pass runs, so it is asked again every few
 *  seconds. */
export function useRequests(filter: LogFilter) {
  return useQuery({
    queryKey: ["requests", filter],
    placeholderData: keepPreviousData,
    refetchInterval: 5_000,
    meta: { silent: true },
    queryFn: () =>
      data(
        api.GET("/api/telemetry/requests", {
          params: {
            query: {
              lecture_id: filter.lecture ?? undefined,
              job_id: filter.job ?? undefined,
              provider: filter.provider || undefined,
              ok: filter.ok === "all" ? undefined : filter.ok === "ok",
              limit: filter.limit,
            },
          },
        }),
      ),
  });
}

/** F-096: one request with the payload sent and the payload received. */
export function useRequest(id: number | null) {
  return useQuery({
    queryKey: ["request", id],
    enabled: id !== null,
    queryFn: () => data(api.GET("/api/telemetry/requests/{request_id}", { params: { path: { request_id: id! } } })),
  });
}

export function useClearRequests() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lecture: number | null) =>
      data(api.DELETE("/api/telemetry/requests", { params: { query: { lecture_id: lecture ?? undefined } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["requests"] }),
  });
}
