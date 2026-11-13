import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useI18n } from "../../shell/i18n";
import { isUnfinished, useJobs, type Job, type LectureDetail } from "../lectures/api";
import type { ViewFinding } from "../lectures/view/model";
import { useEstimate, useStartPass, useVerifierSettings } from "./api";
import { FindingPicker, type RowStatus } from "./FindingPicker";
import { EstimateStats, PassProgress, PreviewButton } from "./PassRunner";
import { idsInScope } from "./selection";
import { useStudio } from "../../shell/edition";
import { VerifierPanel } from "./VerifierPanel";

type Props = { lecture: LectureDetail; findings: readonly ViewFinding[] };

/** The lecture's "verify" tab (phase 15): which quotes to send, which verifier and options, the estimate, and the
 *  pass with its progress. The settings are saved on the server; the pass is a job that keeps running if the
 *  page is closed, and this tab picks it up again. */
export function VerifyPage({ lecture, findings }: Props) {
  const { t } = useI18n();
  const studio = useStudio();
  const [params] = useSearchParams();
  const settings = useVerifierSettings().data;
  const jobs = useJobs();
  const start = useStartPass(lecture.id);

  const wanted = Number(params.get("finding"));
  const [picked, setPicked] = useState<ReadonlySet<number>>(
    () => new Set(findings.some((f) => f.id === wanted) ? [wanted] : idsInScope(findings, "HADITH_AND_CANDIDATES")),
  );
  // ids that are no longer in the lecture (it was detected again) are not sent
  const ids = useMemo(() => findings.filter((f) => f.id !== null && picked.has(f.id)).map((f) => f.id!), [findings, picked]);
  const estimate = useEstimate(lecture.id, ids, settings);

  // the pass this tab follows: the one just started, else one of this lecture that is still running
  const [started, setStarted] = useState<Job | null>(null);
  const running = jobs.data?.find((j) => j.kind === "verify" && j.lecture_id === lecture.id && isUnfinished(j));
  const initial = started ?? running ?? null;
  const [live, setLive] = useState<Job | null>(null);
  const onJob = useCallback((job: Job) => setLive(job), []);

  const pending = useMemo(() => {
    const set = new Set<number>();
    if (live && isUnfinished(live)) for (const id of (live.params.finding_ids as number[] | undefined) ?? []) set.add(id);
    return set;
  }, [live]);
  const errors = useMemo(() => {
    const map = new Map<number, string>();
    const result = live?.status === "done" ? (live.result as { failed?: { finding_id: number; error: string }[] } | null) : null;
    for (const f of result?.failed ?? []) map.set(f.finding_id, f.error);
    return map;
  }, [live]);
  const status = useCallback(
    (f: ViewFinding): RowStatus => (errors.has(f.id!) ? "error" : pending.has(f.id!) && f.verdict === "none" ? "queued" : null),
    [errors, pending],
  );

  const busy = !!live && isUnfinished(live);
  const canStart = ids.length > 0 && !!settings && !busy && !start.isPending;
  const firstPicked = ids[0] ?? null;

  if (findings.length === 0) {
    return (
      <section className="panel">
        <p className="panel-b m-0 text-ink-2">{t("verify.noFindings")}</p>
      </section>
    );
  }
  return (
    <div className="vgrid">
      <FindingPicker findings={findings} words={lecture.words} picked={picked} onPick={setPicked} status={status} errors={errors} />
      <aside className="panel" aria-labelledby="pass-title">
        <div className="panel-h">
          <h3 id="pass-title" className="text-l font-semibold">{t("verify.pass")}</h3>
        </div>
        <div className="panel-b">
          {settings ? <VerifierPanel settings={settings} /> : <p className="m-0 text-ink-3">{t("verify.loading")}</p>}
          <EstimateStats estimate={ids.length ? estimate.data : undefined} picked={ids.length} error={ids.length && estimate.isError ? (estimate.error as Error) : null} />
          {initial && <PassProgress key={initial.id} initial={initial} lectureId={lecture.id} onJob={onJob} />}
          <div className="row">
            <button
              className="btn primary"
              disabled={!canStart}
              onClick={() => start.mutate(ids, { onSuccess: setStarted })}
            >
              {t("verify.start")}
            </button>
            <PreviewButton lectureId={lecture.id} findingId={firstPicked} />
            {studio && (
              <Link className="btn ghost" to={`/requests?lecture=${lecture.id}`}>
                {t("verify.requestLog")}
              </Link>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
