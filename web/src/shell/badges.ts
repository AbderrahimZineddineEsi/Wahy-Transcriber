import { useQuery } from "@tanstack/react-query";
import { api, data } from "../api/client";
import type { LogFilter } from "../features/telemetry/api";
import type { TrainingFilter } from "../features/training/api";

export type RailBadges = { lecture?: number; corpora?: number; training?: number; requests?: number };

const TRAINING: TrainingFilter = { origin: "all", task: "all", label: "ALL", q: "", limit: 1 };
const REQUESTS: LogFilter = { lecture: null, job: null, provider: "", ok: "all", limit: 1 };

/** F-001: the rail's live counts, as in the approved mockup: the open lecture's quotes, the adhkar list, the training
 *  rows and the logged requests. Each uses its screen's query key, so whatever refreshes a screen after a change (an
 *  edit, a dhikr added, a label, a pass) refreshes its badge too. The badges are silent: a server that does not
 *  answer is shown by the header, not by four more error toasts. */
export function useRailBadges(lectureId: number | null): RailBadges {
  const findings = useQuery({
    queryKey: ["findings", lectureId],
    enabled: lectureId !== null,
    retry: false,
    meta: { silent: true },
    queryFn: () => data(api.GET("/api/lectures/{lecture_id}/findings", { params: { path: { lecture_id: lectureId! } } })),
  });
  const adhkar = useQuery({
    queryKey: ["adhkar"],
    retry: false,
    meta: { silent: true },
    queryFn: () => data(api.GET("/api/corpora/adhkar")),
  });
  const training = useQuery({
    queryKey: ["training", TRAINING],
    retry: false,
    meta: { silent: true },
    queryFn: () => data(api.GET("/api/training", { params: { query: { origin: "all", task: "all", label: "ALL", limit: 1 } } })),
  });
  const requests = useQuery({
    queryKey: ["requests", REQUESTS],
    retry: false,
    refetchInterval: 5_000, // the log grows while a pass runs, as on its screen
    meta: { silent: true },
    queryFn: () => data(api.GET("/api/telemetry/requests", { params: { query: { limit: 1 } } })),
  });
  return {
    lecture: lectureId !== null ? findings.data?.findings.length : undefined,
    corpora: adhkar.data?.length,
    training: training.data?.counts.total,
    requests: requests.data?.total,
  };
}
