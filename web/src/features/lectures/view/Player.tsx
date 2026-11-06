import type { Caption } from "@wahy/engine/captions";
import { useI18n, type MessageKey } from "../../../shell/i18n";
import { useClock } from "./clock";
import type { ViewFinding, Word } from "./model";
import type { PlayerControls } from "./player";
import { captionAt, clockText, wordAt } from "./sync";

type Props = {
  controls: PlayerControls;
  lectureId: number;
  hasMedia: boolean;
  captions: Caption[];
  captionStarts: Float64Array;
  starts: Float64Array;
  words: readonly Word[];
  /** for each word, the shown finding it belongs to (an index into `shown`), or -1 */
  findingAtWord: Int32Array;
  shown: readonly ViewFinding[];
  standard: boolean;
  attach: (file: File) => void;
};

/** F-039: the video (or audio) with the live caption over it, the controls, and a card for what is being said
 *  now. Each part subscribes to the one value it shows, so playing re-renders only what changes. */
export function Player(props: Props) {
  const { t } = useI18n();
  const { controls, lectureId, hasMedia, attach } = props;
  return (
    <aside className="player" aria-label={t("player.label")}>
      <div className="video">
        {hasMedia ? (
          <video ref={controls.mediaRef} src={`/api/lectures/${lectureId}/media`} preload="metadata" playsInline data-testid="media" />
        ) : (
          <div className="nomedia">{t("player.noMediaHint")}</div>
        )}
        <CaptionOverlay {...props} />
      </div>
      {hasMedia ? (
        <Controls controls={controls} />
      ) : (
        <div className="row text-s text-ink-2">
          <span className="flex-1">{t("player.noMedia")}</span>
          <label className="btn small cursor-pointer">
            {t("lecture.attach")}
            <input
              type="file"
              accept="audio/*,video/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) attach(file);
              }}
            />
          </label>
        </div>
      )}
      <NowCard {...props} />
    </aside>
  );
}

function CaptionOverlay({ controls, captions, captionStarts }: Props) {
  const at = useClock(controls.clock, (s) => captionAt(captions, captionStarts, s.t));
  return (
    <div className="cap" data-testid="caption" aria-live="off">
      {at >= 0 ? captions[at].displayText : ""}
    </div>
  );
}

function Controls({ controls }: { controls: PlayerControls }) {
  const { t } = useI18n();
  const { clock } = controls;
  const playing = useClock(clock, (s) => s.playing);
  const second = useClock(clock, (s) => Math.floor(s.t));
  const quarter = useClock(clock, (s) => Math.round(s.t * 4) / 4);
  const duration = useClock(clock, (s) => s.duration);
  return (
    <div className="controls">
      <button className="iconbtn" title={t("player.back")} aria-label={t("player.back")} onClick={() => controls.step(-5)}>
        <span className="mono">5−</span>
      </button>
      <button className="btn primary min-w-[84px]" onClick={controls.toggle} data-testid="play">
        {playing ? t("player.pause") : t("player.play")}
      </button>
      <button className="iconbtn" title={t("player.forward")} aria-label={t("player.forward")} onClick={() => controls.step(5)}>
        <span className="mono">5+</span>
      </button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.25}
        value={quarter}
        aria-label={t("player.timeline")}
        onChange={(e) => controls.seek(Number(e.target.value))}
      />
      <span className="time" data-testid="time">
        {clockText(second)} / {clockText(duration)}
      </span>
    </div>
  );
}

function NowCard({ controls, starts, findingAtWord, shown, words, standard }: Props) {
  const { t } = useI18n();
  // -2: nothing has started yet; -1: ordinary speech; k: inside shown[k]
  const at = useClock(controls.clock, (s) => {
    const w = wordAt(starts, s.t);
    return w < 0 ? -2 : findingAtWord[w];
  });
  const f = at >= 0 ? shown[at] : null;
  return (
    <div className="panel nowcard" data-testid="nowcard">
      {f ? (
        <>
          <div className="row">
            <span className={`kchip ${f.kind}`}>{t(`kindOne.${f.kind}` as MessageKey)}</span>
            <b>{f.ref}</b>
            <span className="flex-1" />
            <span className={`vchip ${f.verdict}`}>{t(`verdict.${f.verdict}` as MessageKey)}</span>
          </div>
          <div className="quote">{quoteText(words, f, standard)}</div>
        </>
      ) : (
        <>
          <span className="label">{t("player.now")}</span>
          <span className="text-ink-2">{at === -1 ? t("player.speech") : t("player.hint")}</span>
        </>
      )}
    </div>
  );
}

export function quoteText(words: readonly Word[], f: ViewFinding, standard: boolean): string {
  if (standard && f.canonicalText) return f.canonicalText;
  return words
    .slice(f.start, f.end + 1)
    .map((w) => w.text)
    .join(" ");
}
