import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, data } from "../../../api/client";
import { useI18n } from "../../../shell/i18n";
import { useDetectionSettings } from "../../corpora/api";
import { isUnfinished, useJobStream, type Job } from "../api";

/** F-044: run the engine again on the lecture's current words, with the engine chosen in Settings (F-011; the
 *  lecture has no second engine picker). The server first keeps the current quotes as a lecture version (F-028), so
 *  it asks for a second click instead of a dialog. When the job ends the versions are read again. */
export function DetectAgain({ lectureId }: { lectureId: number }) {
  const { t } = useI18n();
  const settings = useDetectionSettings();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const start = useMutation({
    mutationFn: async () => (await data(api.POST("/api/lectures/{lecture_id}/detect", { params: { path: { lecture_id: lectureId } } }))).job,
    onSuccess: (started) => {
      setJob(started);
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const engine = settings.data?.engine ?? "v5";
  return (
    <span className="row gap-2">
      <button
        className={`btn small${confirm ? " danger" : " ghost"}`}
        data-testid="detect-again"
        disabled={start.isPending || busy}
        onBlur={() => setConfirm(false)}
        onClick={() => {
          if (!confirm) return setConfirm(true);
          setConfirm(false);
          start.mutate();
        }}
      >
        {confirm ? t("lecture.detectConfirm") : t("lecture.detectAgain", { engine })}
      </button>
      {job && <DetectStatus key={job.id} initial={job} lectureId={lectureId} onBusy={setBusy} />}
    </span>
  );
}

function DetectStatus({ initial, lectureId, onBusy }: { initial: Job; lectureId: number; onBusy: (busy: boolean) => void }) {
  const { t } = useI18n();
  const job = useJobStream(initial);
  const queryClient = useQueryClient();
  const running = isUnfinished(job);
  useEffect(() => {
    onBusy(running);
    if (!running) void queryClient.invalidateQueries({ queryKey: ["versions", lectureId] });
    return () => onBusy(false);
  }, [running, lectureId, onBusy, queryClient]);
  const result = (job.result ?? {}) as Record<string, unknown>;
  return (
    <span role="status" className={`text-s ${job.status === "failed" ? "text-bad" : "text-ink-2"}`} data-testid="detect-again-status" data-status={job.status}>
      {job.status === "done"
        ? t("lecture.detectDone", { n: Number(result.count ?? result.findings ?? 0) })
        : job.status === "failed"
          ? (job.error ?? t("job.status.failed"))
          : t("lecture.detectRunning")}
    </span>
  );
}
