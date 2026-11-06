import { useQuery } from "@tanstack/react-query";
import { api, data } from "./client";
import type { components } from "./schema";

export type Health = components["schemas"]["Health"];

/** The server's health, refreshed every 10 s. A failure is shown by the header badge, not as a toast. */
export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => data(api.GET("/api/health")),
    refetchInterval: 10_000,
    retry: false,
    meta: { silent: true },
  });
}
