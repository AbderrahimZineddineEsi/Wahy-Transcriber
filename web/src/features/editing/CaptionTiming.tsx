import { memo, useMemo, useState } from "react";
import { useI18n } from "../../shell/i18n";
import { useStoredState } from "../../shell/storage";
import { useToasts } from "../../shell/toasts";
import type { LectureDetail } from "../lectures/api";
import { useClock } from "../lectures/view/clock";
import type { PlayerControls } from "../lectures/view/player";
import { captionAt, startTimes } from "../lectures/view/sync";
import { useCaptionEdit, useCaptions, useReplaceWords, useUndo, type CaptionEdit, type CaptionOut } from "./api";

type Props = { lecture: LectureDetail; controls: PlayerControls };

/** F-068: every caption with its times and text, as the caption files will write them. Speech captions can be
 *  re-worded, split at a word and merged with the next; any caption can be re-timed (typed, nudged, or set to the
 *  playhead). A quote is a locked unit: it is never split or merged with speech. */
export function CaptionTiming({ lecture, controls }: Props) {
  const { t } = useI18n();
  const toasts = useToasts();
  const [script, setScript] = useStoredState<"spoken" | "standard">("wahy.view.script", "spoken", ["spoken", "standard"]);
  const data = useCaptions(lecture.id, { script }).data;
  const caps = useMemo(() => data ?? [], [data]);
  const starts = useMemo(() => startTimes(caps), [caps]);
  const now = useClock(controls.clock, (s) => captionAt(caps, starts, s.t));
  const capEdit = useCaptionEdit(lecture.id);
  const replace = useReplaceWords(lecture.id);
  const undo = useUndo(lecture.id);
  const done = (message: string) => () => toasts.success(message, { label: t("undo.action"), run: () => undo.mutate() });
  const act = (body: CaptionEdit, message: string) => capEdit.mutate(body, { onSuccess: done(message) });
  const playhead = () => Math.round(controls.clock.get().t * 100) / 100;

  return (
    <section className="panel" data-testid="caption-timing">
      <div className="panel-h">
        <h3 className="font-semibold">{t("cap.title")}</h3>
        <span className="text-s text-ink-2">{t("cap.count", { n: caps.length })}</span>
        <span className="flex-1" />
        <label className="switch">
          <input type="checkbox" checked={script === "standard"} onChange={(e) => setScript(e.target.checked ? "standard" : "spoken")} />
          {t("view.script")}
        </label>
      </div>
      <div className="caplist" role="list">
        {caps.map((c, k) => (
          <CaptionRow
            key={`${c.wordStartIdx}-${c.wordEndIdx}`}
            c={c}
            next={caps[k + 1] ?? null}
            now={k === now}
            words={lecture.words}
            hasMedia={lecture.has_media}
            busy={capEdit.isPending || replace.isPending}
            onTime={(start, end) => act({ op: "time", word: c.wordStartIdx, start, end }, t("cap.timed"))}
            onSplit={(word) => act({ op: "split", word }, t("cap.split"))}
            onMerge={() => act({ op: "merge", word: caps[k + 1].wordStartIdx }, t("cap.merged"))}
            onText={(text) => replace.mutate({ start: c.wordStartIdx, end: c.wordEndIdx, text }, { onSuccess: done(t("words.saved")) })}
            onPlay={() => controls.playRange(c.start, c.end)}
            playhead={playhead}
          />
        ))}
      </div>
    </section>
  );
}

type RowProps = {
  c: CaptionOut;
  next: CaptionOut | null;
  now: boolean;
  words: LectureDetail["words"];
  hasMedia: boolean;
  busy: boolean;
  onTime: (start: number | null, end: number | null) => void;
  onSplit: (word: number) => void;
  onMerge: () => void;
  onText: (text: string) => void;
  onPlay: () => void;
  playhead: () => number;
};

const round = (x: number) => Math.max(0, Math.round(x * 100) / 100);

const CaptionRow = memo(function CaptionRow({ c, next, now, words, hasMedia, busy, onTime, onSplit, onMerge, onText, onPlay, playhead }: RowProps) {
  const { t } = useI18n();
  const speech = c.type === "normal";
  const [splitting, setSplitting] = useState(false);
  const spoken = words.slice(c.wordStartIdx, c.wordEndIdx + 1).map((w) => w.text).join(" ");
  return (
    <div className={`caprow${now ? " now" : ""}`} role="listitem" data-testid="caprow" data-word={c.wordStartIdx}>
      <span className="mono text-s text-ink-3" dir="ltr">{c.index}</span>
      <TimeField label={t("cap.start")} value={c.start} disabled={busy} onCommit={(v) => onTime(v, null)} onNudge={(d) => onTime(round(c.start + d), null)} onPlayhead={() => onTime(playhead(), null)} />
      <TimeField label={t("cap.end")} value={c.end} disabled={busy} onCommit={(v) => onTime(null, v)} onNudge={(d) => onTime(null, round(c.end + d))} onPlayhead={() => onTime(null, playhead())} />
      <div className="flex min-w-0 flex-col gap-1">
        {speech ? (
          <TextField value={spoken} disabled={busy} onCommit={onText} />
        ) : (
          <span className="ar" title={t("cap.locked")}>
            <span className="me-1" aria-hidden="true">
              🔒
            </span>
            {c.displayText}
          </span>
        )}
        {splitting && (
          <div className="tokens" role="group" aria-label={t("cap.splitAt")}>
            {words.slice(c.wordStartIdx + 1, c.wordEndIdx + 1).map((w, k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setSplitting(false);
                  onSplit(c.wordStartIdx + 1 + k);
                }}
              >
                {w.text}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="row gap-1 whitespace-nowrap">
        {hasMedia && (
          <button className="btn small ghost" onClick={onPlay}>
            {t("cap.play")}
          </button>
        )}
        {speech && c.wordEndIdx > c.wordStartIdx && (
          <button className="btn small ghost" aria-pressed={splitting} disabled={busy} onClick={() => setSplitting(!splitting)}>
            {t("cap.splitBtn")}
          </button>
        )}
        {speech && next?.type === "normal" && (
          <button className="btn small ghost" disabled={busy} onClick={onMerge}>
            {t("cap.mergeBtn")}
          </button>
        )}
      </div>
    </div>
  );
});

function TimeField({
  label,
  value,
  disabled,
  onCommit,
  onNudge,
  onPlayhead,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (v: number) => void;
  onNudge: (delta: number) => void;
  onPlayhead: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v) && v >= 0 && Math.abs(v - value) >= 0.005) onCommit(round(v));
  };
  return (
    <div className="flex flex-col gap-0.5">
      <input
        className="input time-in"
        inputMode="decimal"
        aria-label={label}
        value={draft ?? value.toFixed(2)}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
      />
      <div className="row gap-0.5">
        <button className="iconbtn h-6 px-1 text-xs" disabled={disabled} title={t("cap.nudgeBack")} aria-label={`${label} ${t("cap.nudgeBack")}`} onClick={() => onNudge(-0.1)}>
          −0.1
        </button>
        <button className="iconbtn h-6 px-1 text-xs" disabled={disabled} title={t("cap.nudgeOn")} aria-label={`${label} ${t("cap.nudgeOn")}`} onClick={() => onNudge(0.1)}>
          +0.1
        </button>
        <button className="iconbtn h-6 px-1 text-xs" disabled={disabled} title={t("cap.toPlayhead")} aria-label={`${label} ${t("cap.toPlayhead")}`} onClick={onPlayhead}>
          ⏱
        </button>
      </div>
    </div>
  );
}

function TextField({ value, disabled, onCommit }: { value: string; disabled: boolean; onCommit: (text: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text && text !== value) onCommit(text);
  };
  return (
    <input
      className="input ar h-8"
      aria-label={t("cap.text")}
      value={draft ?? value}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}
