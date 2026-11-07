import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { isUnfinished, useJobAction, useJobStream, useJobs, useLectures, type Job } from "./api";
import { clockText } from "./view/sync";

type TranscriptWarning = { kind: string; start_s: number; sample: string; repeats?: number | null };

const STAGES: Record<string, string[]> = {
  transcribe: ["download", "audio", "transcribe", "save"],
  detect: ["load", "detect", "save"],
};
const SHOWN = ["transcribe", "detect"];

/** F-023: the jobs that run now, and the ones that ended during this visit, with their stages. */
export function JobsPanel({ extra }: { extra: Job | null }) {
  const { t } = useI18n();
  const jobs = useJobs();
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const all = useMemo(() => [...(extra ? [extra] : []), ...(jobs.data ?? [])], [extra, jobs.data]);
  const unique = useMemo(
    () => all.filter((j, i) => all.findIndex((x) => x.id === j.id) === i && SHOWN.includes(j.kind)),
    [all],
  );
  // a finished job is shown only if it was seen running during this visit (old finished jobs stay out)
  useEffect(() => {
    const fresh = unique.filter((j) => isUnfinished(j) && !seen.has(j.id)).map((j) => j.id);
    if (fresh.length) setSeen((old) => new Set([...old, ...fresh]));
  }, [unique, seen]);
  const visible = unique.filter((j) => !hidden.has(j.id) && (isUnfinished(j) || seen.has(j.id))).slice(0, 6);
  if (visible.length === 0) return null;

  return (
    <section className="panel" aria-labelledby="running-title">
      <div className="panel-h">
        <h3 id="running-title" className="text-l font-semibold">{t("lectures.running")}</h3>
      </div>
      <div className="panel-b">
        {visible.map((job) => (
          <JobCard key={job.id} initial={job} onDismiss={() => setHidden(new Set([...hidden, job.id]))} />
        ))}
      </div>
    </section>
  );
}

function JobCard({ initial, onDismiss }: { initial: Job; onDismiss: () => void }) {
  const { t } = useI18n();
  const job = useJobStream(initial);
  const lectures = useLectures();
  const pause = useJobAction("pause");
  const resume = useJobAction("resume");
  const cancel = useJobAction("cancel");

  const title = lectures.data?.find((l) => l.id === job.lecture_id)?.title ?? `#${job.lecture_id ?? "?"}`;
  const stages = (job.progress.stages as string[] | undefined) ?? STAGES[job.kind] ?? [];
  const current = stages.indexOf(String(job.progress.stage ?? ""));
  const percent = typeof job.progress.percent === "number" ? Math.round(job.progress.percent) : null;
  const running = isUnfinished(job);
  const done = job.status === "done";

  return (
    <div className="flex flex-col gap-2" data-testid={`job-${job.kind}`} data-status={job.status}>
      <div className="row">
        <b>{title}</b>
        <span className="text-ink-3">· {t(`job.kind.${job.kind}` as MessageKey)}</span>
        <span className={`vchip ${done ? "ok" : job.status === "failed" ? "bad" : running ? "none" : "unsure"}`}>
          {t(`job.status.${job.status}` as MessageKey)}
        </span>
        <span className="flex-1" />
        {job.status === "running" && <button className="btn small" onClick={() => pause.mutate(job.id)}>{t("job.pause")}</button>}
        {(job.status === "paused" || job.status === "interrupted") && <button className="btn small" onClick={() => resume.mutate(job.id)}>{t("job.resume")}</button>}
        {running && <button className="btn small danger" onClick={() => cancel.mutate(job.id)}>{t("job.cancel")}</button>}
        {!running && <button className="btn small ghost" onClick={onDismiss}>{t("lectures.dismiss")}</button>}
      </div>
      <div className="stages" role="list">
        {stages.map((stage, i) => {
          const state = done || i < current ? "done" : i === current && running ? "on" : "";
          return (
            <div key={stage} role="listitem" className={state} data-stage={stage} data-state={state || "todo"} style={state === "on" && percent !== null ? ({ "--pct": `${percent}%` } as React.CSSProperties) : undefined}>
              <i />
              {t(`job.stage.${stage}` as MessageKey)}
              {state === "on" && percent !== null ? ` ${percent}%` : ""}
            </div>
          );
        })}
      </div>
      {job.status === "failed" && <span className="text-s text-bad">{job.error}</span>}
      {done && <Result job={job} />}
    </div>
  );
}

function Result({ job }: { job: Job }) {
  const { t } = useI18n();
  const result = (job.result ?? {}) as Record<string, unknown>;
  const fallback = result.fallback as { reason?: string } | null | undefined;
  const warnings = Array.isArray(result.warnings) ? (result.warnings as TranscriptWarning[]) : [];
  const text =
    job.kind === "transcribe"
      ? t("job.resultTranscribe", { model: String(result.model_used ?? ""), words: Number(result.word_count ?? 0) })
      : t("job.resultDetect", { count: Number(result.count ?? result.findings ?? 0) });
  return (
    <div className="flex flex-col gap-1 text-s text-ink-2">
      <span className="row">
        <span>{text}</span>
        {job.lecture_id !== null && <Link className="font-semibold text-accent underline" to={`/lectures/${job.lecture_id}`}>{t("job.openLecture")}</Link>}
      </span>
      {fallback && <span className="text-unsure">{t("job.fallback", { reason: fallback.reason ?? "" })}</span>}
      {warnings.length > 0 && <Warnings warnings={warnings} />}
    </div>
  );
}

/** N-009: stretches of the transcript that look like ASR trouble (Latin script, a repetition loop). */
function Warnings({ warnings }: { warnings: TranscriptWarning[] }) {
  const { t } = useI18n();
  return (
    <details className="text-unsure" data-testid="asr-warnings">
      <summary>{t("job.warnings", { n: warnings.length })}</summary>
      <ul className="m-0 ps-5">
        {warnings.slice(0, 20).map((w, i) => (
          <li key={i}>
            {t(w.kind === "repetition" ? "job.warning.repetition" : "job.warning.latin_run", {
              time: clockText(w.start_s),
              sample: w.sample,
              n: w.repeats ?? 0,
            })}
          </li>
        ))}
      </ul>
    </details>
  );
}
