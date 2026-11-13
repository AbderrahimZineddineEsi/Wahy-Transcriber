import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { useTafrighModels } from "./api";
import { useStudio } from "../../shell/edition";
import type { Candidate, GeminiRoute, JevOrder, Mode, RunSettings, TextSource, TypoStrategy } from "./settings";

type Props = { settings: RunSettings; onChange: (patch: Partial<RunSettings>) => void; disabled: boolean; sentences: number | null };

function Seg<T extends string>({ label, value, options, onPick, disabled }: { label: string; value: T; options: [T, MessageKey][]; onPick: (v: T) => void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map(([v, key]) => (
          <button key={v} type="button" aria-pressed={value === v} disabled={disabled} onClick={() => onPick(v)}>
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A number typed in a box. While the box is half-typed (empty, "1.") the setting keeps its last good value; the
 *  box shows what the setting is again when the user leaves it. */
function NumberBox({ label, value, onNumber, disabled, min, max, step, testid }: { label: string; value: number; onNumber: (v: number) => void; disabled: boolean; min: number; max: number; step?: number; testid?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input
        className="input font-mono"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        data-testid={testid}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onNumber(Math.min(max, Math.max(min, n)));
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

const CANDIDATES: [Candidate, MessageKey][] = [
  ["gemini_all", "tfg.model.gemini"],
  ["jev_hybrid", "tfg.model.jev"],
  ["laya_hybrid", "tfg.model.laya"], // a research model: the studio only
  ["openrouter_chat", "tfg.model.chat"],
];

/** F-107 to F-113: how the text is cut, what is read, the model, the mode, the typo strategy and the sentence range.
 *  Every change is remembered in this browser; the preview and the estimate follow it. */
export function SettingsPanel({ settings: s, onChange, disabled, sentences }: Props) {
  const { t } = useI18n();
  const studio = useStudio();
  const models = useTafrighModels();
  const jev = s.candidate === "jev_hybrid";
  const helper = s.candidate === "jev_hybrid" || s.candidate === "laya_hybrid"; // Gemini then does the splits and typo fixes
  const gemini = s.candidate === "gemini_all" || helper;
  const quick = (n: number) => onChange({ from: "1", to: String(sentences ? Math.min(n, sentences) : n) });

  return (
    <div className="flex flex-col gap-3" data-testid="tfg-settings">
      <h4 className="m-0 text-s font-semibold text-ink-2">{t("tfg.set.sentences")}</h4>
      <div className="grid2">
        <NumberBox label={t("tfg.set.pause")} value={s.pauseSec} min={0} max={10} step={0.1} disabled={disabled} testid="tfg-pause" onNumber={(v) => onChange({ pauseSec: v })} />
        <NumberBox label={t("tfg.set.minWords")} value={s.minWords} min={1} max={50} disabled={disabled} testid="tfg-min" onNumber={(v) => onChange({ minWords: Math.round(v) })} />
        <NumberBox label={t("tfg.set.maxWords")} value={s.maxWords} min={0} max={500} disabled={disabled} testid="tfg-max" onNumber={(v) => onChange({ maxWords: Math.round(v) })} />
      </div>
      <label className="switch">
        <input type="checkbox" checked={s.usePunctuation} disabled={disabled} onChange={(e) => onChange({ usePunctuation: e.target.checked })} />
        {t("tfg.set.punctuation")}
      </label>
      <Seg<TextSource>
        label={t("tfg.set.source")}
        value={s.textSource}
        disabled={disabled}
        onPick={(v) => onChange({ textSource: v })}
        options={[["raw_findings", "tfg.source.raw_findings"], ["corrected", "tfg.source.corrected"], ["raw", "tfg.source.raw"]]}
      />
      <label className="field">
        <span className="label">{t("tfg.set.matn")}</span>
        <textarea className="input" rows={3} dir="rtl" placeholder={t("tfg.set.matnHint")} value={s.matnText} disabled={disabled} onChange={(e) => onChange({ matnText: e.target.value })} />
      </label>

      <h4 className="m-0 mt-2 text-s font-semibold text-ink-2">{t("tfg.set.model")}</h4>
      <label className="field">
        <span className="label">{t("tfg.set.classifier")}</span>
        <select className="input" aria-label={t("tfg.set.classifier")} value={s.candidate} disabled={disabled} onChange={(e) => onChange({ candidate: e.target.value as Candidate })}>
          {CANDIDATES.filter(([v]) => studio || v !== "laya_hybrid").map(([v, key]) => (
            <option key={v} value={v}>{t(key)}</option>
          ))}
        </select>
      </label>
      {gemini && (
        <>
          <div className="field">
            <span className="label">{t(helper ? "tfg.set.helperModel" : "tfg.set.geminiModel")}</span>
            <div className="row">
              <select className="input flex-1" aria-label={t("tfg.set.geminiModel")} value={s.geminiModel} disabled={disabled} onChange={(e) => onChange({ geminiModel: e.target.value })}>
                <option value="auto">{t("tfg.set.auto")}</option>
                {s.geminiModel !== "auto" && !models.data?.models.includes(s.geminiModel) && <option value={s.geminiModel}>{s.geminiModel}</option>}
                {models.data?.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <button type="button" className="btn small" disabled={disabled || models.isPending} onClick={() => models.mutate()}>
                {t("tfg.set.fetchModels")}
              </button>
            </div>
          </div>
          <label className="field">
            <span className="label">{t("tfg.set.route")}</span>
            <select className="input" aria-label={t("tfg.set.route")} value={s.geminiRoute} disabled={disabled} onChange={(e) => onChange({ geminiRoute: e.target.value as GeminiRoute })}>
              <option value="auto">{t("tfg.route.auto")}</option>
              <option value="direct">{t("tfg.route.direct")}</option>
              <option value="openrouter">{t("tfg.route.openrouter")}</option>
            </select>
          </label>
          <label className="switch">
            <input type="checkbox" checked={s.disableThinking} disabled={disabled} onChange={(e) => onChange({ disableThinking: e.target.checked })} />
            {t("tfg.set.noThinking")}
          </label>
        </>
      )}
      {s.candidate === "openrouter_chat" && (
        <label className="field">
          <span className="label">{t("tfg.set.chatModel")}</span>
          <input className="input font-mono" dir="ltr" placeholder="deepseek/deepseek-chat" value={s.chatModel} disabled={disabled} onChange={(e) => onChange({ chatModel: e.target.value })} />
        </label>
      )}

      <h4 className="m-0 mt-2 text-s font-semibold text-ink-2">{t("tfg.set.how")}</h4>
      <Seg<Mode>
        label={t("tfg.set.mode")}
        value={s.mode}
        disabled={disabled}
        onPick={(v) => onChange({ mode: v })}
        options={[["per_sentence", "tfg.mode.per_sentence"], ["windowed", "tfg.mode.windowed"]]}
      />
      {s.mode === "windowed" && !jev && (
        <NumberBox label={t("tfg.set.window")} value={s.windowSize} min={1} max={40} disabled={disabled} testid="tfg-window" onNumber={(v) => onChange({ windowSize: Math.round(v) })} />
      )}
      {jev && (
        <label className="field">
          <span className="label">{t("tfg.set.jevOrder")}</span>
          <select className="input" aria-label={t("tfg.set.jevOrder")} value={s.jevOrder} disabled={disabled} onChange={(e) => onChange({ jevOrder: e.target.value as JevOrder })}>
            <option value="parallel">{t("tfg.jev.parallel")}</option>
            <option value="sequential">{t("tfg.jev.sequential")}</option>
            <option value="combined">{t("tfg.jev.combined")}</option>
          </select>
        </label>
      )}
      <Seg<TypoStrategy>
        label={t("tfg.set.typos")}
        value={s.typo}
        disabled={disabled}
        onPick={(v) => onChange({ typo: v })}
        options={[["gated", "tfg.typo.gated"], ["always_correct", "tfg.typo.always"], ["off", "tfg.typo.off"]]}
      />

      <div className="field">
        <span className="label">{t("tfg.set.range")}</span>
        <div className="row">
          <input className="input w-20 font-mono" type="number" min={1} aria-label={t("tfg.set.from")} placeholder="1" value={s.from} disabled={disabled} data-testid="tfg-from" onChange={(e) => onChange({ from: e.target.value })} />
          <span>{t("tfg.set.rangeTo")}</span>
          <input className="input w-20 font-mono" type="number" min={1} aria-label={t("tfg.set.to")} placeholder={sentences ? String(sentences) : "∞"} value={s.to} disabled={disabled} data-testid="tfg-to" onChange={(e) => onChange({ to: e.target.value })} />
        </div>
        <div className="row">
          {[10, 25, 50].map((n) => (
            <button key={n} type="button" className="btn small ghost" disabled={disabled} data-testid={`tfg-first-${n}`} onClick={() => quick(n)}>
              {t("tfg.set.first", { n })}
            </button>
          ))}
          <button type="button" className="btn small ghost" disabled={disabled || (s.from === "" && s.to === "")} onClick={() => onChange({ from: "", to: "" })}>
            {t("tfg.set.all")}
          </button>
        </div>
      </div>
    </div>
  );
}
