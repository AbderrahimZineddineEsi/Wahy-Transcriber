import { useState } from "react";
import { useI18n } from "../../shell/i18n";
import { CopyButton } from "../../shell/fields";
import { usd } from "../verification/format";
import { duration } from "../verification/format";
import { useCompare, type RunSummary } from "./api";

/** F-122: saved runs side by side — their settings, cost and time, how many sentences got each tag, and the sentences
 *  that the first run labels differently from each of the others. */
export function Compare({ runs }: { runs: RunSummary[] }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string[]>(() => runs.slice(0, 2).map((r) => r.run_id));
  const ids = picked.filter((id) => runs.some((r) => r.run_id === id));
  const compare = useCompare(ids);
  const toggle = (id: string) => setPicked(ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < 6 ? [...ids, id] : ids);
  const nameOf = (id: string) => runs.find((r) => r.run_id === id)?.name ?? id;

  if (runs.length < 2) {
    return (
      <p className="panel-b m-0 text-ink-2" role="status" data-testid="tfg-compare-need">
        {t("tfg.compare.need")}
      </p>
    );
  }
  const result = compare.data;
  return (
    <div className="panel-b flex flex-col gap-4" data-testid="tfg-compare">
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="label">{t("tfg.compare.pick")}</legend>
        {runs.map((r) => (
          <label key={r.run_id} className="row text-s">
            <input type="checkbox" checked={ids.includes(r.run_id)} onChange={() => toggle(r.run_id)} />
            <span>{r.name}</span>
          </label>
        ))}
      </fieldset>
      {ids.length < 2 && <p className="m-0 text-s text-ink-3">{t("tfg.compare.atLeastTwo")}</p>}
      {compare.isPending && ids.length >= 2 && <p className="m-0 text-ink-2">{t("tfg.preview.loading")}</p>}
      {compare.isError && <p role="alert" className="m-0 text-bad">{compare.error.message}</p>}
      {result && (
        <>
          <div className="scroll-x">
            <table className="data text-s" data-testid="tfg-compare-table">
              <thead>
                <tr>
                  <th>{t("tfg.compare.run")}</th>
                  <th>{t("tfg.set.classifier")}</th>
                  <th>{t("tfg.set.mode")}</th>
                  <th>{t("tfg.stat.sentences")}</th>
                  <th>{t("verify.stat.requests")}</th>
                  <th>{t("verify.stat.cost")}</th>
                  <th>{t("tfg.compare.per100")}</th>
                  <th>{t("verify.stat.time")}</th>
                  <th>{t("tfg.compare.tags")}</th>
                </tr>
              </thead>
              <tbody>
                {result.runs.map((r) => (
                  <tr key={r.run_id} data-testid="tfg-compare-run">
                    <td>{r.name}</td>
                    <td className="font-mono">{r.model_candidate}</td>
                    <td className="font-mono">{r.processing_mode}{r.typo_strategy ? ` · ${r.typo_strategy}` : ""}</td>
                    <td className="font-mono">{r.num_segments}</td>
                    <td className="font-mono">{r.requests_sent}</td>
                    <td className="font-mono">{usd(r.total_cost_usd)}</td>
                    <td className="font-mono">{usd(r.cost_per_100_sentences_usd)}</td>
                    <td className="font-mono">{duration(r.wall_clock_seconds)}</td>
                    <td className="font-mono text-xs">{Object.entries(r.tag_distribution).map(([k, v]) => `${k} ${v}`).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.comparisons.map((c) => (
            <section key={c.b} className="flex flex-col gap-2" data-testid="tfg-disagreements">
              <h4 className="m-0 text-s font-semibold">{t("tfg.compare.differ", { a: nameOf(c.a), b: nameOf(c.b), n: c.count })}</h4>
              {c.count === 0 ? (
                <p className="m-0 text-s text-ink-3">{t("tfg.compare.same")}</p>
              ) : (
                <div className="flex max-h-[50vh] flex-col overflow-y-auto">
                  {c.disagreements.map((d) => (
                    <div key={d.segment_id} className="sent" data-testid="tfg-disagreement">
                      <span className="mono text-xs text-ink-3">{d.segment_id.replace("seg_", "")}</span>
                      <span className="t ar">{d.text}</span>
                      <span className="mono text-xs text-unsure" dir="ltr">{d.diff_type}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
          <div className="row">
            <CopyButton label={t("tfg.compare.copy")} text={() => result.markdown} />
          </div>
        </>
      )}
    </div>
  );
}
