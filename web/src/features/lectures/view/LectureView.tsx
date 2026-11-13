import { tokenWordMap } from "@wahy/engine/captions";
import { lectureCaptions } from "@wahy/engine/export";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n, type MessageKey } from "../../../shell/i18n";
import { useStoredState } from "../../../shell/storage";
import { useToasts } from "../../../shell/toasts";
import { useAttachMedia, useEditWord, type LectureDetail } from "../api";
import { useCaptionEdits } from "../../editing/api";
import { bracketsOf, DEFAULT_STYLE, useExportStyle } from "../../export/api";
import { useClock, type Clock } from "./clock";
import { FindingCard, placeUnder, WordEditor } from "./FindingCard";
import {
  buildParagraphs,
  counts,
  DEFAULT_FILTER,
  isShown,
  normalizeArabic,
  PRESETS,
  presetOf,
  searchHits,
  type Filter,
  type Kind,
  type PresetKey,
  type Script,
  type VerdictKey,
  type ViewFinding,
} from "./model";
import { Player } from "./Player";
import { usePlayer } from "./player";
import { clockText, progress, startTimes } from "./sync";
import { Transcript, useTranscriptMarks } from "./Transcript";

const LAYOUTS = ["beside", "text", "video"] as const;
type Layout = (typeof LAYOUTS)[number];
const KINDS: ("all" | Kind)[] = ["all", "quran", "hadith", "dhikr"];
const VERDICTS: VerdictKey[] = ["ok", "unsure", "bad", "none"];

type Props = { lecture: LectureDetail; findings: readonly ViewFinding[]; readOnly: boolean };

/** The lecture screen's "view" tab: the transcript beside the video, word by word in sync (milestone B). */
export function LectureView({ lecture, findings, readOnly }: Props) {
  const { t, dir } = useI18n();
  const toasts = useToasts();
  const words = lecture.words;
  const [layout, setLayout] = useStoredState<Layout>("wahy.view.layout", "beside", LAYOUTS);
  const [script, setScript] = useStoredState<Script>("wahy.view.script", "spoken", ["spoken", "standard"]);
  const [followSetting, setFollow] = useStoredState("wahy.view.follow", "on", ["on", "off"]);
  const follow = followSetting === "on";
  const [filter, setFilter] = useState<Filter>(DEFAULT_FILTER);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [card, setCard] = useState<{ key: string; style: CSSProperties } | null>(null);
  const [editing, setEditing] = useState<{ i: number; style: CSSProperties } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const attach = useAttachMedia(lecture.id);
  const editWord = useEditWord(lecture.id);

  // ---- derived data: each is recomputed only when its own inputs change ----
  const style = useExportStyle().data ?? DEFAULT_STYLE;
  const captionEdits = useCaptionEdits(lecture.id).data;
  const brackets = useMemo(() => bracketsOf(style), [style]);
  const showRef = useMemo(
    () => ({ quran: style.showQuranSource, hadith: style.showHadithSource, dhikr: style.showAdhkarTag }),
    [style.showQuranSource, style.showHadithSource, style.showAdhkarTag],
  );
  const starts = useMemo(() => startTimes(words), [words]);
  const captionWords = useMemo(() => words.map((w) => ({ word: w.text, start: w.start, end: w.end })), [words]);
  const tokWord = useMemo(() => tokenWordMap(captionWords), [captionWords]);
  const shown = useMemo(() => findings.filter((f) => isShown(f, filter)), [findings, filter]);
  const paragraphs = useMemo(() => buildParagraphs(words, shown, script, tokWord), [words, shown, script, tokWord]);
  // a filter change re-renders the whole transcript; deferring it keeps the toolbar answering at once while
  // React renders the new transcript in the background (it shows the old one until the new one is ready)
  const shownParagraphs = useDeferredValue(paragraphs);
  // the captions as the caption files write them: the saved style and the timing editor's edits included (a
  // saved version is read only, and its old caption edits may not fit it, so it has none)
  const captions = useMemo(
    () =>
      lectureCaptions({
        words: captionWords,
        findings: shown.map((f) => ({ ...f.data, id: f.key })),
        prefs: style,
        standardScript: script === "standard",
        captionEdits: readOnly ? [] : (captionEdits ?? []),
      }),
    [captionWords, shown, script, style, captionEdits, readOnly],
  );
  const captionStarts = useMemo(() => startTimes(captions), [captions]);
  const findingAtWord = useMemo(() => {
    const at = new Int32Array(words.length).fill(-1);
    shown.forEach((f, k) => {
      for (let i = Math.max(0, f.start); i <= Math.min(words.length - 1, f.end); i++) if (at[i] < 0) at[i] = k;
    });
    return at;
  }, [words, shown]);
  const normWords = useMemo(() => words.map((w) => normalizeArabic(w.text)), [words]);
  const hits = useMemo(() => searchHits(normWords, deferredQuery), [normWords, deferredQuery]);
  const total = counts(words, findings);
  const duration = lecture.duration_s || (words.length ? words[words.length - 1].end : 0);

  const controls = usePlayer(duration);
  useTranscriptMarks({ root, scroller, clock: controls.clock, starts, paragraphs: shownParagraphs, follow, hits, selectedKey: card?.key ?? null });

  // ---- what a click does ----
  const rtl = dir === "rtl";
  const openCard = useCallback(
    (key: string, anchor: HTMLElement) => {
      if (scroller.current) setCard({ key, style: placeUnder(anchor, scroller.current, rtl) });
    },
    [rtl],
  );
  const onWord = useCallback(
    (i: number, el: HTMLElement, quoteKey: string | null) => {
      controls.seek(words[i].start + 0.001);
      if (quoteKey) openCard(quoteKey, el);
      else setCard(null);
    },
    [controls, words, openCard],
  );
  const onWordDoubleClick = useCallback(
    (i: number, el: HTMLElement) => {
      if (scroller.current) setEditing({ i, style: placeUnder(el, scroller.current, rtl, 260) });
    },
    [rtl],
  );
  const closeCard = useCallback(() => setCard(null), []);
  const cardFinding = card ? findings.find((f) => f.key === card.key) : undefined;

  // ?finding=ID (the editor's "show in the view"): scroll to that quote and open its card, once
  const [params, setParams] = useSearchParams();
  const wanted = params.get("finding");
  useEffect(() => {
    if (!wanted) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-f="f${wanted}"] .ref`);
    if (!el) return;
    el.scrollIntoView?.({ block: "center" });
    openCard(`f${wanted}`, el);
    const f = findings.find((x) => x.key === `f${wanted}`);
    if (f && words[f.start]) controls.seek(words[f.start].start + 0.001);
    setParams({}, { replace: true });
  }, [wanted, shownParagraphs, openCard, findings, words, controls, setParams]);

  const hitIndex = useRef(-1);
  const nextHit = () => {
    if (!hits.length) return;
    hitIndex.current = (hitIndex.current + 1) % hits.length;
    root.current?.querySelector(`[data-i="${hits[hitIndex.current]}"]`)?.scrollIntoView?.({ block: "center" });
  };

  const setVerdict = (v: VerdictKey) => setFilter({ ...filter, show: { ...filter.show, [v]: !filter.show[v] } });
  const preset = presetOf(filter.show);

  return (
    <>
      <div className="kpis" data-testid="kpis">
        <span>
          <b>{total.words}</b>
          {t("kpi.words")}
        </span>
        <span>
          <b data-testid="count-quran">{total.quran}</b>
          {t("kpi.quran")}
        </span>
        <span>
          <b data-testid="count-hadith">{total.hadith}</b>
          {t("kpi.hadith")}
        </span>
        <span>
          <b data-testid="count-dhikr">{total.dhikr}</b>
          {t("kpi.dhikr")}
        </span>
        <span>
          <b data-testid="count-captions">{captions.length}</b>
          {t("kpi.captions")}
        </span>
        <span>
          <b>{clockText(duration)}</b>
          {t("kpi.duration")}
        </span>
      </div>

      <div className="viewbar">
        <div className="viewbar-row">
          <div className="row gap-1">
            <input
              className="input w-64 max-[720px]:w-full"
              type="search"
              placeholder={t("view.search")}
              aria-label={t("view.search")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                hitIndex.current = -1;
              }}
              onKeyDown={(e) => e.key === "Enter" && nextHit()}
            />
            {deferredQuery.trim() && (
              <button className="btn small ghost" title={t("view.nextHit")} onClick={nextHit} data-testid="hits">
                {t("view.hits", { n: hits.length })}
              </button>
            )}
          </div>
          <div className="seg" role="group" aria-label={t("kind.label")}>
            {KINDS.map((k) => (
              <button
                key={k}
                aria-pressed={filter.kind === k}
                onClick={() => {
                  setFilter({ ...filter, kind: k });
                  setCard(null);
                }}
              >
                {t(`kind.${k}` as MessageKey)}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <div className="seg" role="group" aria-label={t("layout.label")}>
            {LAYOUTS.map((l) => (
              <button key={l} aria-pressed={layout === l} onClick={() => setLayout(l)}>
                {t(`layout.${l}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="viewbar-row quiet">
          <div className="row gap-1.5" role="group" aria-label={t("verdict.label")}>
            {VERDICTS.map((v) => (
              <button key={v} className="chip" aria-pressed={filter.show[v]} style={{ color: `var(--wahy-${v})` }} onClick={() => setVerdict(v)}>
                <span className="dot" />
                <span className="text-ink-2">{t(`verdict.${v}` as MessageKey)}</span>
              </button>
            ))}
            <select
              className="input h-7 w-auto text-s"
              aria-label={t("preset.label")}
              value={preset ?? ""}
              onChange={(e) => e.target.value && setFilter({ ...filter, show: PRESETS[e.target.value as PresetKey] })}
            >
              {preset === null && <option value="">{t("preset.label")}</option>}
              {(Object.keys(PRESETS) as PresetKey[]).map((p) => (
                <option key={p} value={p}>
                  {t(`preset.${p}` as MessageKey)}
                </option>
              ))}
            </select>
            <button className={`chip${filter.clipped ? " on" : ""}`} aria-pressed={filter.clipped ? "true" : undefined} onClick={() => setFilter({ ...filter, clipped: !filter.clipped })}>
              {t("filter.clipped")} <span className="mono">{total.clipped}</span>
            </button>
          </div>
          <span className="flex-1" />
          <label className="switch">
            <input type="checkbox" checked={script === "standard"} onChange={(e) => setScript(e.target.checked ? "standard" : "spoken")} />
            {t("view.script")}
          </label>
          <label className="switch">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked ? "on" : "off")} />
            {t("view.follow")}
          </label>
        </div>
      </div>

      <div className="stage" data-layout={layout}>
        <section className="panel reader" aria-label={t("view.reader")}>
          <ReadingProgress clock={controls.clock} />
          <div className="reader-body" ref={scroller}>
            {words.length === 0 ? (
              <p className="text-ink-2">{t("lecture.empty")}</p>
            ) : (
              <div ref={root}>
                <Transcript
                  paragraphs={shownParagraphs}
                  words={words}
                  onWord={onWord}
                  onRef={openCard}
                  onWordDoubleClick={onWordDoubleClick}
                  brackets={brackets}
                  split={style.splitCommentary}
                  showRef={showRef}
                />
              </div>
            )}
            {card && cardFinding && (
              <FindingCard
                f={cardFinding}
                words={words}
                lectureId={lecture.id}
                style={card.style}
                hasMedia={lecture.has_media}
                standard={script === "standard"}
                readOnly={readOnly}
                onClose={closeCard}
                onPlay={() => controls.playRange(words[cardFinding.start].start, words[Math.min(words.length - 1, cardFinding.end)].end)}
              />
            )}
            {editing && words[editing.i] && (
              <WordEditor
                key={editing.i}
                word={words[editing.i]}
                style={editing.style}
                busy={editWord.isPending}
                onCancel={() => setEditing(null)}
                onSave={(text) => {
                  const old = words[editing.i].text;
                  editWord.mutate({ idx: editing.i, text }, { onSuccess: () => toasts.success(t("word.saved", { old, new: text })) });
                  setEditing(null);
                }}
              />
            )}
          </div>
        </section>
        <Player
          controls={controls}
          lectureId={lecture.id}
          hasMedia={lecture.has_media}
          captions={captions}
          captionStarts={captionStarts}
          starts={starts}
          words={words}
          findingAtWord={findingAtWord}
          shown={shown}
          standard={script === "standard"}
          attach={(file) => attach.mutate(file, { onSuccess: () => toasts.success(t("lecture.attached")) })}
        />
      </div>
    </>
  );
}

/** F-032's reading progress bar; re-renders at most 1,000 times over the whole lecture. */
function ReadingProgress({ clock }: { clock: Clock }) {
  const permille = useClock(clock, (s) => Math.round(progress(s.t, s.duration) * 1000));
  return (
    <div className="progressline" aria-hidden="true">
      <i style={{ transform: `scaleX(${permille / 1000})` }} data-testid="progress" />
    </div>
  );
}
