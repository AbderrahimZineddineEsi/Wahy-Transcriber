import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { useStoredState } from "../../shell/storage";
import type { LectureDetail } from "../lectures/api";
import { useClock } from "../lectures/view/clock";
import type { ViewFinding } from "../lectures/view/model";
import { usePlayer, type PlayerControls } from "../lectures/view/player";
import { clockText } from "../lectures/view/sync";
import { boardChunks, boardReducer, editable, EMPTY, findingAtWord } from "./board";
import { CaptionTiming } from "./CaptionTiming";
import { MissedQuoteStudio } from "./MissedQuoteStudio";
import { QuoteInspector } from "./QuoteInspector";
import { TextEditor } from "./TextEditor";
import { SelectionBar, WordBoard } from "./WordBoard";

const MODES = ["findings", "text", "timing"] as const;
type Mode = (typeof MODES)[number];

type Props = { lecture: LectureDetail; findings: readonly ViewFinding[] };

/** The lecture's "edit" tab (F-047): three modes over the same lecture (quotes on a word board with an inspector,
 *  the full text, caption timing), a mini player (F-048), and the switches that change how the editor behaves.
 *  Every change is one operation in the lecture's edit log; the header's undo button takes back the newest. */
export function EditPage({ lecture, findings }: Props) {
  const { t } = useI18n();
  const words = lecture.words;
  const [mode, setMode] = useStoredState<Mode>("wahy.edit.mode", "findings", MODES);
  const [followSetting, setFollow] = useStoredState("wahy.edit.follow", "on", ["on", "off"]);
  const [fullSetting, setFull] = useStoredState("wahy.edit.full", "off", ["on", "off"]);
  const follow = followSetting === "on";
  const fullMatn = fullSetting === "on";
  const duration = lecture.duration_s || (words.length ? words[words.length - 1].end : 0);
  const controls = usePlayer(duration);

  // the finding asked for by the view's "edit" button (?finding=ID) opens in the inspector
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get("finding"));
  const [state, dispatch] = useReducer(boardReducer, EMPTY, (s) => (Number.isInteger(asked) && asked > 0 ? { ...s, finding: asked } : s));
  useEffect(() => {
    if (params.has("finding")) setParams({}, { replace: true });
  }, [params, setParams]);

  const list = useMemo(() => editable(findings), [findings]);
  const at = useMemo(() => findingAtWord(words.length, list), [words.length, list]);
  const chunks = useMemo(() => boardChunks(words, at), [words, at]);
  const selected = list.find((f) => f.id === state.finding) ?? null;

  // Escape drops the selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.("[role=dialog], input, textarea")) dispatch({ type: "clear" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // F-049: selecting a word moves the media there, unless the switch is off
  const onWord = useCallback(
    (i: number) => {
      if (follow && words[i]) controls.seek(words[i].start + 0.001);
    },
    [follow, words, controls],
  );
  const playWords = useCallback(
    (a: number, b: number) => {
      if (words[a] && words[b]) controls.playRange(words[a].start, words[b].end);
    },
    [words, controls],
  );

  return (
    <>
      <div className="row">
        <div className="seg" role="group" aria-label={t("edit.modes")}>
          {MODES.map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t(`edit.mode.${m}` as MessageKey)}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <MiniPlayer controls={controls} hasMedia={lecture.has_media} lectureId={lecture.id} />
        <label className="switch">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked ? "on" : "off")} />
          {t("edit.follow")}
        </label>
        {mode === "findings" && (
          <label className="switch">
            <input type="checkbox" checked={fullMatn} onChange={(e) => setFull(e.target.checked ? "on" : "off")} />
            {t("edit.fullMatn")}
          </label>
        )}
      </div>

      {mode === "findings" && (
        <div className="edgrid">
          <section className="panel" aria-label={t("edit.board")}>
            <div className="panel-h">
              <h3 className="font-semibold">{t("edit.board")}</h3>
              <span className="text-s text-ink-2">{t("edit.boardHint")}</span>
            </div>
            <div className="panel-b">
              <SelectionBar words={words} state={state} dispatch={dispatch} lectureId={lecture.id} onPlay={playWords} hasMedia={lecture.has_media} />
              {words.length === 0 ? (
                <p className="text-ink-2">{t("lecture.empty")}</p>
              ) : (
                <WordBoard words={words} list={list} at={at} chunks={chunks} state={state} dispatch={dispatch} onWord={onWord} />
              )}
            </div>
          </section>
          <aside className="inspector" aria-label={t("edit.inspector")}>
            {state.range ? (
              <MissedQuoteStudio
                key={`${state.range[0]}-${state.range[1]}-${state.kind ?? ""}`}
                lectureId={lecture.id}
                words={words}
                range={state.range}
                kind={state.kind}
                dispatch={dispatch}
              />
            ) : selected ? (
              <QuoteInspector
                key={selected.id}
                lecture={lecture}
                list={list}
                f={selected}
                fullMatn={fullMatn}
                dispatch={dispatch}
                onPlay={playWords}
              />
            ) : (
              <section className="panel">
                <p className="panel-b m-0 text-s text-ink-2">{state.anchor !== null ? t("edit.pickLast") : t("edit.nothing")}</p>
              </section>
            )}
          </aside>
        </div>
      )}
      {mode === "text" && <TextEditor key={lecture.updated_at} lecture={lecture} />}
      {mode === "timing" && <CaptionTiming lecture={lecture} controls={controls} />}
    </>
  );
}

/** F-048: play / pause, back and forward 2 seconds and the time, without scrolling to the video. The media element
 *  is hidden: the editor only needs its sound. */
function MiniPlayer({ controls, hasMedia, lectureId }: { controls: PlayerControls; hasMedia: boolean; lectureId: number }) {
  const { t } = useI18n();
  const playing = useClock(controls.clock, (s) => s.playing);
  const second = useClock(controls.clock, (s) => Math.floor(s.t));
  const duration = useClock(controls.clock, (s) => s.duration);
  const [ready, setReady] = useState(false);
  return (
    <div className="miniplayer" data-testid="miniplayer">
      {hasMedia && (
        <video ref={controls.mediaRef} src={`/api/lectures/${lectureId}/media`} preload="metadata" className="hidden" data-testid="media" onLoadedMetadata={() => setReady(true)} />
      )}
      <button className="iconbtn h-7" title={t("edit.back2")} aria-label={t("edit.back2")} onClick={() => controls.step(-2)}>
        <span className="mono">2−</span>
      </button>
      <button className="btn small primary min-w-16" disabled={!hasMedia} onClick={controls.toggle} title={hasMedia ? undefined : t("player.noMedia")}>
        {playing ? t("player.pause") : t("player.play")}
      </button>
      <button className="iconbtn h-7" title={t("edit.forward2")} aria-label={t("edit.forward2")} onClick={() => controls.step(2)}>
        <span className="mono">2+</span>
      </button>
      <span className="time" data-testid="edit-time" data-ready={ready || undefined}>
        {clockText(second)} / {clockText(duration)}
      </span>
    </div>
  );
}
