import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../shell/i18n";
import { Modal } from "../../shell/Modal";
import { CopyButton } from "../../shell/fields";
import { useToasts } from "../../shell/toasts";
import { isUnfinished, useJobAction, useJobStream, type Job } from "../lectures/api";
import { useApproveAll, usePassMetrics, usePreview, type Estimate, type PassMetrics } from "./api";
import { duration, millis, readableJson, tokens, usd } from "./format";

/** F-087: what the pass would send and cost, before it runs. */
export function EstimateStats({ estimate, picked, error }: { estimate: Estimate | undefined; picked: number; error: Error | null }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      <div className="stats" data-testid="estimate">
        <div className="stat">
          <span className="label">{t("verify.stat.quotes")}</span>
          <b data-testid="est-findings">{picked}</b>
        </div>
        <div className="stat">
          <span className="label">{t("verify.stat.requests")}</span>
          <b data-testid="est-requests">{estimate ? estimate.requests : "—"}</b>
        </div>
        <div className="stat">
          <span className="label">{t("verify.stat.tokens")}</span>
          <b data-testid="est-tokens">{estimate ? tokens(estimate.approx_input_tokens + estimate.approx_output_tokens) : "—"}</b>
        </div>
        <div className="stat">
          <span className="label">{t("verify.stat.cost")}</span>
          <b data-testid="est-cost">{estimate ? usd(estimate.est_cost_usd) : "—"}</b>
        </div>
        <div className="stat">
          <span className="label">{t("verify.stat.time")}</span>
          <b data-testid="est-time">{estimate ? duration(estimate.est_seconds) : "—"}</b>
        </div>
        <div className="stat">
          <span className="label">{t("verify.stat.model")}</span>
          <span className="font-mono text-s break-all" dir="ltr">{estimate ? `${estimate.model} · v${estimate.envelope_version}` : "—"}</span>
        </div>
      </div>
      {error && <p role="alert" className="m-0 text-s text-bad">{error.message}</p>}
    </div>
  );
}

type Props = { initial: Job; lectureId: number; onJob: (job: Job) => void };

/** F-088: a running pass, with its two progress counts, pause, resume and cancel; when it ends, its numbers
 *  (F-089) and "approve all" (F-091). Verdicts are saved as they arrive, so the lecture is refreshed after each
 *  request and the list fills in while the pass runs. */
export function PassProgress({ initial, lectureId, onJob }: Props) {
  const { t } = useI18n();
  const job = useJobStream(initial);
  const queryClient = useQueryClient();
  const pause = useJobAction("pause");
  const resume = useJobAction("resume");
  const cancel = useJobAction("cancel");
  const running = isUnfinished(job);
  const p = job.progress as Record<string, unknown>;
  const num = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);
  const requestsDone = num("requests_done");

  useEffect(() => onJob(job), [job, onJob]);
  const lastDone = useRef(requestsDone);
  useEffect(() => {
    if (requestsDone !== lastDone.current) {
      lastDone.current = requestsDone;
      void queryClient.invalidateQueries({ queryKey: ["findings", lectureId] });
    }
  }, [requestsDone, lectureId, queryClient]);

  const total = num("findings_total");
  const percent = job.status === "done" ? 100 : typeof p.percent === "number" ? (p.percent as number) : 0;
  const waiting = p.waiting as { seconds?: number } | null | undefined;
  const failed = job.status === "done" ? ((job.result as { failed?: unknown[] } | null)?.failed?.length ?? 0) : num("failed");

  return (
    <div className="flex flex-col gap-2" data-testid="pass" data-status={job.status}>
      <div className="row">
        <span className="label">{t("verify.progress.findings", { done: num("findings_done"), total })}</span>
        <span className="flex-1" />
        <span className="label font-mono">{t("verify.progress.requests", { done: requestsDone, total: num("requests_total") })}</span>
      </div>
      <div className="bar" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${percent}%` }} />
      </div>
      {waiting && typeof waiting.seconds === "number" && <span className="text-s text-unsure">{t("verify.progress.waiting", { s: Math.ceil(waiting.seconds) })}</span>}
      <div className="row">
        <span className={`vchip ${job.status === "done" ? "ok" : job.status === "failed" ? "bad" : "none"}`}>{t(`job.status.${job.status}` as never)}</span>
        {failed > 0 && <span className="vchip bad">{t("verify.progress.failed", { n: failed })}</span>}
        <span className="flex-1" />
        {job.status === "running" && <button className="btn small" onClick={() => pause.mutate(job.id)}>{t("job.pause")}</button>}
        {(job.status === "paused" || job.status === "interrupted") && <button className="btn small" onClick={() => resume.mutate(job.id)}>{t("job.resume")}</button>}
        {running && <button className="btn small danger" onClick={() => cancel.mutate(job.id)}>{t("job.cancel")}</button>}
      </div>
      {job.status === "failed" && <span className="text-s text-bad">{job.error}</span>}
      {job.status === "cancelled" && <span className="text-s text-ink-2">{t("verify.progress.cancelled")}</span>}
      {!running && <Metrics job={job} lectureId={lectureId} />}
    </div>
  );
}

function Metrics({ job, lectureId }: { job: Job; lectureId: number }) {
  const { t } = useI18n();
  const metrics = usePassMetrics(job.id, false).data;
  const toasts = useToasts();
  const approve = useApproveAll(lectureId);
  const [confirm, setConfirm] = useState(false);
  if (!metrics) return null;
  const v = metrics.verdict_counts;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2" data-testid="metrics">
      <MetricGrid m={metrics} />
      <div className="row">
        <span className="vchip ok">{t("verdict.ok")} {v.CORRECT ?? 0}</span>
        <span className="vchip unsure">{t("verdict.unsure")} {v.NOT_SURE ?? 0}</span>
        <span className="vchip bad">{t("verdict.bad")} {v.FALSE ?? 0}</span>
        {metrics.clipped > 0 && <span className="vchip unsure">✂ {metrics.clipped}</span>}
      </div>
      <div className="row">
        <button
          className={`btn small${confirm ? " danger" : ""}`}
          disabled={approve.isPending || metrics.findings_verified === 0}
          onBlur={() => setConfirm(false)}
          onClick={() => {
            if (!confirm) return setConfirm(true);
            setConfirm(false);
            approve.mutate(undefined, { onSuccess: (r) => toasts.success(t("verify.approved", { n: r.approved })) });
          }}
        >
          {confirm ? t("verify.approveConfirm") : t("verify.approveAll")}
        </button>
        <Link className="btn small ghost" to={`/requests?job=${job.id}`}>
          {t("verify.requestLog")}
        </Link>
      </div>
    </div>
  );
}

function MetricGrid({ m }: { m: PassMetrics }) {
  const { t } = useI18n();
  const rows: [string, string][] = [
    [t("verify.m.envelope"), millis(m.envelope_ms)],
    [t("verify.m.requests"), `${m.requests_ok}/${m.requests}${m.requests_failed ? ` (${m.requests_failed} ✕)` : ""}`],
    [t("verify.m.total"), millis(m.total_latency_ms)],
    [t("verify.m.average"), millis(m.avg_latency_ms)],
    [t("verify.m.tokens"), `${tokens(m.input_tokens)} → ${tokens(m.output_tokens)}`],
    [t("verify.m.context"), tokens(m.avg_input_tokens)],
    [t("verify.m.cost"), usd(m.cost_usd)],
    [t("verify.m.elapsed"), duration(m.elapsed_s)],
  ];
  return (
    <dl className="stats m-0 text-s">
      {rows.map(([label, value]) => (
        <div key={label} className="stat">
          <dt className="label">{label}</dt>
          <dd className="m-0 font-mono" data-testid={`m-${label}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** F-086: the exact request one finding would get, not sent. */
export function PreviewButton({ lectureId, findingId }: { lectureId: number; findingId: number | null }) {
  const { t } = useI18n();
  const preview = usePreview(lectureId);
  const [open, setOpen] = useState(false);
  const data = preview.data;
  return (
    <>
      <button
        className="btn small ghost"
        disabled={findingId === null || preview.isPending}
        onClick={() => {
          setOpen(true);
          preview.mutate(findingId!);
        }}
      >
        {t("verify.preview")}
      </button>
      {open && (
        <Modal
          wide
          title={t("verify.preview")}
          onClose={() => setOpen(false)}
          actions={data && <CopyButton label={t("verify.copyRequest")} text={() => readableJson(data.body)} />}
        >
          {preview.isPending && <p className="m-0 text-ink-2">{t("verify.loading")}</p>}
          {data && (
            <div className="flex flex-col gap-3" data-testid="preview">
              <p className="m-0 font-mono text-s text-ink-2" dir="ltr">
                {data.provider} · {data.model} · v{data.envelope_version} · ~{tokens(data.approx_tokens)} tokens · {data.endpoint}
              </p>
              <section>
                <span className="label">{t("verify.systemPrompt")}</span>
                <pre className="code wrap" data-testid="preview-system">{data.system_prompt || t("verify.noSystem")}</pre>
              </section>
              <section>
                <span className="label">{t("verify.previewState")}</span>
                <pre className="code" data-testid="preview-state">{readableJson(data.state)}</pre>
              </section>
              <section>
                <span className="label">{t("verify.previewQuestions")}</span>
                <pre className="code" data-testid="preview-questions">{readableJson(data.questions)}</pre>
              </section>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
