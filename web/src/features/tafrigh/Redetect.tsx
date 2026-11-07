import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useI18n } from "../../shell/i18n";
import { isUnfinished, useJobStream, type Job } from "../lectures/api";
import { useRedetect } from "./api";

const ENGINES = ["v5", "v5:loose", "v4", "v3"];

/** F-109: find the quotes again with a chosen engine before the run. It is the ordinary detection job, and it
 *  replaces the quotes the lecture has now (the edits made by hand in the editor go with them), so it asks twice. When
 *  it ends, the sentences and the estimate are read again. */
export function Redetect({ lectureId, disabled, onBusy }: { lectureId: number; disabled: boolean; onBusy: (busy: boolean) => void }) {
  const { t } = useI18n();
  const [engine, setEngine] = useState("v5");
  const [confirm, setConfirm] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const start = useRedetect(lectureId);
  return (
    <div className="flex flex-col gap-2" data-testid="tfg-redetect">
      <span className="label">{t("tfg.redetect.title")}</span>
      <div className="row">
        <select className="input h-8 w-auto font-mono" aria-label={t("tfg.redetect.engine")} value={engine} disabled={disabled} onChange={(e) => setEngine(e.target.value)}>
          {ENGINES.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
        <button
          type="button"
          className={`btn small${confirm ? " danger" : ""}`}
          data-testid="tfg-redetect-start"
          disabled={disabled || start.isPending}
          onBlur={() => setConfirm(false)}
          onClick={() => {
            if (!confirm) return setConfirm(true);
            setConfirm(false);
            start.mutate(engine, { onSuccess: setJob });
          }}
        >
          {confirm ? t("tfg.redetect.confirm") : t("tfg.redetect.start")}
        </button>
      </div>
      {job && <DetectStatus key={job.id} initial={job} onBusy={onBusy} />}
    </div>
  );
}

function DetectStatus({ initial, onBusy }: { initial: Job; onBusy: (busy: boolean) => void }) {
  const { t } = useI18n();
  const job = useJobStream(initial);
  const queryClient = useQueryClient();
  const running = isUnfinished(job);
  useEffect(() => {
    onBusy(running);
    if (!running) {
      void queryClient.invalidateQueries({ queryKey: ["tafrigh-preview"] });
      void queryClient.invalidateQueries({ queryKey: ["tafrigh-estimate"] });
    }
    return () => onBusy(false);
  }, [running, onBusy, queryClient]);
  return (
    <p role="status" className={`m-0 text-s ${job.status === "failed" ? "text-bad" : "text-ink-2"}`} data-testid="tfg-redetect-status" data-status={job.status}>
      {job.status === "done" ? t("tfg.redetect.done") : job.status === "failed" ? (job.error ?? t("job.status.failed")) : t("tfg.redetect.running")}
    </p>
  );
}
