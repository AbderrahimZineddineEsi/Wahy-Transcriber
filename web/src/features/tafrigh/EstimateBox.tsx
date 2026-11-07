import type { UseQueryResult } from "@tanstack/react-query";
import { useI18n } from "../../shell/i18n";
import { tokens, usd } from "../verification/format";
import type { Estimate } from "./api";
import { modeRow, rowCost, rowOf } from "./format";
import type { RunSettings } from "./settings";

/** F-114: requests and tokens of each mode over the chosen sentences, from the real prompts; the mode the run would
 *  use is marked. The cost is shown when the model's price is known (OpenRouter's catalog). */
export function EstimateBox({ query, settings }: { query: UseQueryResult<Estimate, Error>; settings: RunSettings }) {
  const { t } = useI18n();
  const estimate = query.data;
  if (!estimate) {
    return (
      <p className="m-0 text-s text-ink-3" role={query.isError ? "alert" : "status"} data-testid="tfg-estimate">
        {query.isError ? query.error.message : "—"}
      </p>
    );
  }
  const rows: { id: string; label: string; row: ReturnType<typeof rowOf>; active: boolean }[] = [
    { id: "per_sentence", label: t("tfg.mode.per_sentence"), row: rowOf(estimate.per_sentence), active: settings.candidate === "gemini_all" || settings.candidate === "openrouter_chat" ? settings.mode === "per_sentence" : false },
    { id: "windowed", label: t("tfg.est.window", { n: estimate.windowed.window_size as number }), row: rowOf(estimate.windowed), active: (settings.candidate === "gemini_all" || settings.candidate === "openrouter_chat") && settings.mode === "windowed" },
    { id: "jev", label: t("tfg.model.jev"), row: rowOf(estimate.jev), active: settings.candidate === "jev_hybrid" },
    { id: "laya", label: t("tfg.model.laya"), row: rowOf(estimate.laya), active: settings.candidate === "laya_hybrid" },
  ];
  const chosen = modeRow(estimate, settings.mode, settings.candidate);
  const cost = rowCost(chosen, estimate.price);
  return (
    <div className="flex flex-col gap-2" data-testid="tfg-estimate">
      <div className="stats">
        <div className="stat">
          <span className="label">{t("tfg.stat.sentences")}</span>
          <b data-testid="est-sentences">{estimate.sentences}</b>
        </div>
        <div className="stat">
          <span className="label">{t("verify.stat.requests")}</span>
          <b data-testid="est-requests">{chosen.requests}</b>
        </div>
        <div className="stat">
          <span className="label">{t("verify.stat.tokens")}</span>
          <b>{tokens(chosen.input + chosen.output)}</b>
        </div>
        <div className="stat">
          <span className="label">{t("verify.stat.cost")}</span>
          <b data-testid="est-cost">{cost === null ? "—" : usd(cost)}</b>
        </div>
      </div>
      <table className="data text-s" aria-label={t("tfg.est.modes")}>
        <thead>
          <tr>
            <th>{t("tfg.est.mode")}</th>
            <th>{t("verify.stat.requests")}</th>
            <th>{t("verify.stat.tokens")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid={`est-row-${r.id}`} aria-current={r.active ? "true" : undefined} className={r.active ? "font-semibold text-accent" : ""}>
              <td>{r.label}</td>
              <td className="font-mono">{r.row.requests}</td>
              <td className="font-mono">{tokens(r.row.input + r.row.output)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cost === null && <p className="m-0 text-xs text-ink-3">{t("tfg.est.noPrice")}</p>}
    </div>
  );
}
