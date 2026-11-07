import { useI18n } from "../../shell/i18n";
import { useDetectionSettings, useUpdateDetectionSettings } from "../corpora/api";

// Brand-free technical names, never translated: the engine versions the old app offered (F-011).
const ENGINES = ["v5", "v5:loose", "v4", "v3"];

/** F-011, F-046: which engine the next detection uses, and whether it looks for adhkar too. */
export function EnginePanel() {
  const { t } = useI18n();
  const settings = useDetectionSettings();
  const update = useUpdateDetectionSettings();
  const s = settings.data;
  return (
    <section className="panel" aria-labelledby="engine-title">
      <div className="panel-h">
        <h3 id="engine-title" className="text-l font-semibold">{t("settings.engine")}</h3>
        <span className="text-xs text-ink-3">{t("settings.engineHelp")}</span>
      </div>
      <div className="panel-b">
        <div className="field">
          <span className="label">{t("settings.engineVersion")}</span>
          <div className="seg" role="group" aria-label={t("settings.engineVersion")}>
            {ENGINES.map((e) => (
              <button key={e} aria-pressed={s?.engine === e} disabled={!s} onClick={() => update.mutate({ engine: e })} data-testid={`engine-${e}`}>
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">{t("settings.qiraat")}</span>
          <input
            className="input !h-8 w-[160px] font-mono"
            dir="ltr"
            key={s?.qiraat}
            defaultValue={s?.qiraat ?? ""}
            aria-label={t("settings.qiraat")}
            onBlur={(e) => s && /^[A-Za-z_]{1,32}$/.test(e.target.value) && e.target.value !== s.qiraat && update.mutate({ qiraat: e.target.value })}
          />
        </div>
        <label className="switch">
          <input type="checkbox" checked={s?.adhkar ?? true} disabled={!s} onChange={(e) => update.mutate({ adhkar: e.target.checked })} />
          {t("corp.adhkar.detect")}
        </label>
      </div>
    </section>
  );
}
