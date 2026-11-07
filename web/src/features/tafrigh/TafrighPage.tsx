import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { isUnfinished, useJobs, type Job, type LectureDetail } from "../lectures/api";
import { useEstimate, usePreview, useRun, useRuns, useStartRun } from "./api";
import { Compare } from "./Compare";
import { EstimateBox } from "./EstimateBox";
import { Lesson } from "./Lesson";
import { PreviewPane } from "./PreviewPane";
import { Redetect } from "./Redetect";
import { ReviewQueue } from "./ReviewQueue";
import { RunBar } from "./RunBar";
import { RunProgress } from "./RunProgress";
import { SettingsPanel } from "./SettingsPanel";
import { loadSettings, runRequest, saveSettings, sourceRequest, type RunSettings } from "./settings";

type View = "sentences" | "lesson" | "review" | "compare";

/** The lecture's "Tafrigh" tab (phase 19): the sentences a run would classify, the settings and their estimate, a run
 *  as a job with its progress, and the saved runs — the written lesson with its outline, the review queue, and the
 *  comparison of runs. Everything is on the server; a run keeps going if the page is closed, and this tab picks it up
 *  again. */
export function TafrighPage({ lecture }: { lecture: LectureDetail }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<RunSettings>(loadSettings);
  const change = useCallback((patch: Partial<RunSettings>) => {
    setSettings((old) => {
      const next = { ...old, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const [params, setParams] = useSearchParams();
  const runs = useRuns(lecture.id);
  const list = useMemo(() => runs.data ?? [], [runs.data]);
  const wanted = params.get("run");
  const runId = list.some((r) => r.run_id === wanted) ? wanted : (list[0]?.run_id ?? null);
  const pickRun = useCallback(
    (id: string) => setParams((p) => { const next = new URLSearchParams(p); next.set("run", id); return next; }, { replace: true }),
    [setParams],
  );
  const run = useRun(runId);

  const [chosen, setView] = useState<View | null>(null);
  const view: View = chosen === "sentences" || !runId ? "sentences" : (chosen ?? "lesson");

  const source = useMemo(() => sourceRequest(settings), [settings]);
  const request = useMemo(() => runRequest(settings), [settings]);
  const preview = usePreview(lecture.id, source);
  const estimate = useEstimate(lecture.id, request);

  // the run this tab follows: the one just started, else one of this lecture that is still going
  const start = useStartRun(lecture.id);
  const jobs = useJobs();
  const going = jobs.data?.find((j) => j.kind === "tafrigh" && j.lecture_id === lecture.id && isUnfinished(j));
  const [watching, setWatching] = useState<Job | null>(null);
  useEffect(() => {
    if (!watching && going) setWatching(going);
  }, [going, watching]);
  const [live, setLive] = useState<Job | null>(null);
  const onJob = useCallback((job: Job) => setLive(job), []);
  const [detecting, setDetecting] = useState(false);
  const running = start.isPending || (!!live && isUnfinished(live)) || (!live && !!going);
  const busy = running || detecting;

  const onSaved = useCallback(
    (id: string) => {
      void queryClient.invalidateQueries({ queryKey: ["tafrigh-runs", lecture.id] });
      pickRun(id);
      setView("lesson");
    },
    [queryClient, lecture.id, pickRun],
  );
  const onRetry = useCallback(() => {
    setWatching(null);
    setLive(null);
    setView("sentences");
  }, []);

  const needsReview = run.data?.run.needs_review ?? list.find((r) => r.run_id === runId)?.needs_review ?? 0;
  const views: [View, MessageKey, string?][] = [
    ["sentences", "tfg.view.sentences", preview.data ? String(preview.data.stats.sentences) : undefined],
    ...(runId ? ([["lesson", "tfg.view.lesson"], ["review", "tfg.view.review", String(needsReview)]] as [View, MessageKey, string?][]) : []),
    ...(list.length > 1 ? ([["compare", "tfg.view.compare"]] as [View, MessageKey][]) : []),
  ];
  const detail = run.data;

  return (
    <div className="vgrid">
      <section className="panel min-w-0" aria-label={t("tab.tafrigh")}>
        <div className="panel-h flex-wrap">
          {list.length > 0 && <RunBar lectureId={lecture.id} runs={list} runId={runId} onPick={pickRun} onDeleted={() => setView("sentences")} />}
          <span className="flex-1" />
          <div className="seg" role="group" aria-label={t("tfg.view.label")}>
            {views.map(([v, key, badge]) => (
              <button key={v} type="button" aria-pressed={view === v} data-testid={`tfg-view-${v}`} onClick={() => setView(v)}>
                {t(key)}
                {badge !== undefined && <span className="badge ms-1">{badge}</span>}
              </button>
            ))}
          </div>
        </div>
        {view === "sentences" && <PreviewPane query={preview} />}
        {view === "lesson" && (detail ? <Lesson key={detail.run.run_id} lectureId={lecture.id} run={detail} /> : <p className="panel-b m-0 text-ink-2">{t("tfg.preview.loading")}</p>)}
        {view === "review" && (detail ? <ReviewQueue key={detail.run.run_id} lectureId={lecture.id} run={detail} /> : <p className="panel-b m-0 text-ink-2">{t("tfg.preview.loading")}</p>)}
        {view === "compare" && <Compare runs={list} />}
      </section>

      <aside className="panel tall" aria-labelledby="tfg-title">
        <div className="panel-h">
          <h3 id="tfg-title" className="text-l font-semibold">{t("tfg.run.title")}</h3>
        </div>
        <div className="panel-b flex flex-col gap-3">
          {watching && <RunProgress key={watching.id} initial={watching} onSaved={onSaved} onRetry={onRetry} onJob={onJob} />}
          <EstimateBox query={estimate} settings={settings} />
          <div className="row">
            <button
              className="btn primary"
              data-testid="tfg-start"
              disabled={busy || estimate.isError || !preview.data}
              onClick={() => {
                setWatching(null);
                setLive(null);
                start.mutate(request, { onSuccess: setWatching });
              }}
            >
              {t("tfg.run.start")}
            </button>
            {list.length > 0 && view !== "review" && needsReview > 0 && (
              <button className="btn ghost" onClick={() => setView("review")}>
                {t("tfg.run.reviewQueue", { n: needsReview })}
              </button>
            )}
          </div>
          <SettingsPanel settings={settings} onChange={change} disabled={running} sentences={preview.data?.stats.sentences ?? null} />
          <Redetect lectureId={lecture.id} disabled={running} onBusy={setDetecting} />
        </div>
      </aside>
    </div>
  );
}
