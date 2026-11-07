import type { UseQueryResult } from "@tanstack/react-query";
import { useI18n } from "../../shell/i18n";
import { clock } from "./format";
import { CUT_KEYS, KIND_KEYS } from "./labels";
import type { Preview } from "./api";

/** F-106: the sentences the transcript splits into, with their statistics, before any model is called. */
export function PreviewPane({ query }: { query: UseQueryResult<Preview, Error> }) {
  const { t } = useI18n();
  const preview = query.data;
  if (!preview) {
    return (
      <p className="panel-b m-0 text-ink-2" role={query.isError ? "alert" : "status"}>
        {query.isError ? query.error.message : t("tfg.preview.loading")}
      </p>
    );
  }
  const st = preview.stats;
  return (
    <div className="panel-b flex flex-col gap-3" data-testid="tfg-preview">
      <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
        <Stat label={t("tfg.stat.sentences")} value={st.sentences} testid="tfg-stat-sentences" />
        <Stat label={t("tfg.stat.words")} value={st.words_total} />
        <Stat label={t("tfg.stat.shortest")} value={st.min_words} />
        <Stat label={t("tfg.stat.longest")} value={st.max_words} testid="tfg-stat-longest" />
        <Stat label={t("tfg.stat.mean")} value={st.avg_words} />
        <Stat label={t("tfg.stat.median")} value={st.median_words} />
        <Stat label={t("tfg.stat.duration")} value={st.avg_duration_sec == null ? "—" : `${st.avg_duration_sec.toFixed(1)} s`} />
        <Stat label={t("tfg.stat.quotes")} value={st.quote_sentences} />
      </div>
      <div className="row" aria-label={t("tfg.stat.cuts")}>
        <span className="label">{t("tfg.stat.cuts")}</span>
        {Object.entries(st.cut_reasons).map(([reason, n]) => (
          <span key={reason} className="vchip none">{CUT_KEYS[reason] ? t(CUT_KEYS[reason]) : reason} {n}</span>
        ))}
        {st.over_cap > 0 && <span className="vchip unsure">{t("tfg.stat.overCap", { n: st.over_cap })}</span>}
      </div>
      <div className="flex max-h-[60vh] flex-col overflow-y-auto" data-testid="tfg-sentences">
        {preview.sentences.map((s) => (
          <div key={s.id} className="sent" data-testid="tfg-sentence">
            <span className="mono text-xs text-ink-3">{s.index + 1}</span>
            <span className="t ar">{s.text}</span>
            <span className="row text-xs text-ink-3">
              {s.quote_kinds.map((k) => (
                <span key={k} className="vchip ok">{KIND_KEYS[k] ? t(KIND_KEYS[k]) : k}</span>
              ))}
              <span className="mono">{s.words}</span>
              {s.start_time != null && <span className="mono">{clock(s.start_time)}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: number | string; testid?: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <b data-testid={testid}>{value}</b>
    </div>
  );
}
