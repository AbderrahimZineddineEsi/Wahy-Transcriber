import { useEffect, useRef } from "react";
import { useI18n } from "../../shell/i18n";
import { duration, usd } from "../verification/format";
import { isUnfinished, useJobAction, useJobStream, type Job } from "../lectures/api";
import { useStopRun } from "./api";
import { num } from "./format";
import { TAG_KEYS } from "./labels";

type Props = {
  initial: Job;
  /** a run was saved (also a stopped one): select it */
  onSaved: (runId: string) => void;
  /** "retry" after a failure: back to the preview */
  onRetry: () => void;
  /** the job as it changes (the settings are locked while it is unfinished) */
  onJob: (job: Job) => void;
};

/** F-115, F-116: a Tafrigh run as a job. A live bar with the finished sentences and the ones waited on, the requests,
 *  the tags so far, what the model is doing now; pause and resume, stop (keep what is finished), cancel (keep
 *  nothing). A failed run shows its error and a retry button. */
export function RunProgress({ initial, onSaved, onRetry, onJob }: Props) {
  const { t } = useI18n();
  const job = useJobStream(initial);
  const pause = useJobAction("pause");
  const resume = useJobAction("resume");
  const cancel = useJobAction("cancel");
  const stop = useStopRun();
  const running = isUnfinished(job);
  const p = job.progress as Record<string, unknown>;
  const total = num(p, "total");
  const done = num(p, "done");
  const inflight = p.inflight as { from: number; to: number } | null | undefined;
  const waiting = inflight ? Math.max(0, inflight.to - inflight.from) : 0;
  const percent = job.status === "done" ? 100 : Math.min(100, num(p, "percent"));
  const waitingPercent = total > 0 ? Math.min(100 - percent, (waiting / total) * 100) : 0;
  const current = (p.current ?? {}) as { purpose?: string };
  const tags = (p.tags ?? {}) as Record<string, number>;
  const result = job.status === "done" ? (job.result as { run_id?: string | null; stopped?: boolean; sentences?: number; cost_usd?: number } | null) : null;

  useEffect(() => onJob(job), [job, onJob]);
  const saved = useRef<string | null>(null);
  useEffect(() => {
    if (result?.run_id && saved.current !== result.run_id) {
      saved.current = result.run_id;
      onSaved(result.run_id);
    }
  }, [result, onSaved]);

  return (
    <div className="flex flex-col gap-2" data-testid="tafrigh-progress" data-status={job.status}>
      <div className="row">
        <span className="label" data-testid="tfg-done">{t("tfg.progress.sentences", { done, total })}</span>
        <span className="flex-1" />
        <span className="label font-mono">{t("tfg.progress.requests", { sent: num(p, "requests_sent"), planned: num(p, "requests_planned") })}</span>
      </div>
      <div className="bar relative" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${percent}%` }} />
        {waitingPercent > 0 && <i className="absolute top-0 opacity-40" style={{ insetInlineStart: `${percent}%`, width: `${waitingPercent}%` }} data-testid="tfg-waiting" />}
      </div>
      <div className="row text-s text-ink-2">
        {waiting > 0 && <span>{t("tfg.progress.waiting", { n: waiting })}</span>}
        {running && current.purpose && <span className="font-mono">{current.purpose}</span>}
        <span className="flex-1" />
        <span className="font-mono">{usd(num(p, "cost_usd"))}</span>
        {num(p, "eta_sec") > 0 && running && <span>{t("tfg.progress.eta", { time: duration(num(p, "eta_sec")) })}</span>}
      </div>
      {Object.keys(tags).length > 0 && (
        <div className="row" data-testid="tfg-tags">
          {Object.entries(tags).map(([tag, n]) => (
            <span key={tag} className="vchip none">{TAG_KEYS[tag] ? t(TAG_KEYS[tag]) : tag} {n}</span>
          ))}
        </div>
      )}
      <div className="row">
        <span className={`vchip ${job.status === "done" ? "ok" : job.status === "failed" || job.status === "interrupted" ? "bad" : "none"}`}>{t(`job.status.${job.status}` as never)}</span>
        {num(p, "errors") > 0 && <span className="vchip bad">{t("tfg.progress.errors", { n: num(p, "errors") })}</span>}
        {num(p, "splits") > 0 && <span className="vchip none">✂ {num(p, "splits")}</span>}
        <span className="flex-1" />
        {job.status === "running" && <button className="btn small" onClick={() => pause.mutate(job.id)}>{t("job.pause")}</button>}
        {job.status === "paused" && <button className="btn small" onClick={() => resume.mutate(job.id)}>{t("job.resume")}</button>}
        {running && <button className="btn small" data-testid="tfg-stop" disabled={stop.isPending} onClick={() => stop.mutate(job.id)}>{t("tfg.progress.stop")}</button>}
        {running && <button className="btn small danger" onClick={() => cancel.mutate(job.id)}>{t("job.cancel")}</button>}
      </div>
      {job.status === "done" && result && (
        <p role="status" className="m-0 text-s text-ink-2" data-testid="tfg-finished">
          {result.run_id
            ? t(result.stopped ? "tfg.progress.stopped" : "tfg.progress.finished", { n: result.sentences ?? 0 })
            : t("tfg.progress.nothing")}
        </p>
      )}
      {(job.status === "failed" || job.status === "interrupted") && (
        <div className="flex flex-col gap-2" data-testid="tfg-failed">
          <p role="alert" className="m-0 text-s text-bad">{job.status === "interrupted" ? t("tfg.progress.interrupted") : job.error}</p>
          <div className="row">
            <button className="btn small" onClick={onRetry}>{t("tfg.progress.retry")}</button>
          </div>
        </div>
      )}
      {job.status === "cancelled" && (
        <div className="row">
          <span className="text-s text-ink-2">{t("tfg.progress.cancelled")}</span>
          <button className="btn small" onClick={onRetry}>{t("tfg.progress.dismiss")}</button>
        </div>
      )}
      {job.status === "done" && (
        <div className="row">
          <button className="btn small ghost" onClick={onRetry}>{t("tfg.progress.dismiss")}</button>
        </div>
      )}
    </div>
  );
}
