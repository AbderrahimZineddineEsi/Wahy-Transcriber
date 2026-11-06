import { useMemo, useState } from "react";
import { useI18n, type MessageKey } from "../../shell/i18n";
import type { Kind, VerdictKey, ViewFinding, Word } from "../lectures/view/model";
import { quoteText } from "../lectures/view/Player";
import {
  idsInScope,
  invert,
  NO_FILTER,
  scopeOf,
  SCOPES,
  selectNone,
  selectShown,
  toggle,
  visibleRows,
  type ListFilter,
  type Scope,
} from "./selection";

/** What a row's chip says: a verdict, or where the finding is in a running pass. */
export type RowStatus = "queued" | "error" | null;

type Props = {
  findings: readonly ViewFinding[];
  words: readonly Word[];
  picked: ReadonlySet<number>;
  onPick: (next: Set<number>) => void;
  status: (f: ViewFinding) => RowStatus;
  errors: ReadonlyMap<number, string>;
};

/** F-084: choose the findings by scope or by hand, with search, kind and verdict filters, none and invert. */
export function FindingPicker({ findings, words, picked, onPick, status, errors }: Props) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<ListFilter>(NO_FILTER);
  const text = useMemo(() => new Map(findings.map((f) => [f.key, quoteText(words, f, false)])), [findings, words]);
  const shown = useMemo(() => visibleRows(findings, filter, (f) => text.get(f.key) ?? ""), [findings, filter, text]);
  const scope = scopeOf(findings, picked);
  const chosen = findings.filter((f) => f.id !== null && picked.has(f.id)).length;

  return (
    <section className="panel" aria-labelledby="picker-title">
      <div className="panel-h flex-wrap">
        <h3 id="picker-title" className="text-l font-semibold">{t("verify.sent")}</h3>
        <span className="text-s text-ink-3">{t("verify.sentHint")}</span>
        <span className="flex-1" />
        <select
          className="input h-8 w-auto"
          aria-label={t("verify.scope")}
          value={scope ?? "custom"}
          onChange={(e) => e.target.value !== "custom" && onPick(new Set(idsInScope(findings, e.target.value as Scope)))}
        >
          {scope === null && <option value="custom">{t("verify.scope.custom")}</option>}
          {SCOPES.map((s) => (
            <option key={s} value={s}>
              {t(`verify.scope.${s}` as MessageKey)}
            </option>
          ))}
        </select>
      </div>
      <div className="toolbar border-b border-line px-4 py-2">
        <input
          className="input h-8 w-44"
          type="search"
          placeholder={t("view.search")}
          aria-label={t("view.search")}
          value={filter.query}
          onChange={(e) => setFilter({ ...filter, query: e.target.value })}
        />
        <select className="input h-8 w-auto" aria-label={t("kind.label")} value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value as "all" | Kind })}>
          {(["all", "quran", "hadith", "dhikr"] as const).map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}` as MessageKey)}
            </option>
          ))}
        </select>
        <select className="input h-8 w-auto" aria-label={t("verdict.label")} value={filter.verdict} onChange={(e) => setFilter({ ...filter, verdict: e.target.value as "all" | VerdictKey })}>
          <option value="all">{t("verify.anyVerdict")}</option>
          {(["none", "ok", "unsure", "bad"] as const).map((v) => (
            <option key={v} value={v}>
              {t(`verdict.${v}` as MessageKey)}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <button className="btn small" onClick={() => onPick(selectShown(picked, shown))}>
          {t("verify.selectShown")}
        </button>
        <button className="btn small" onClick={() => onPick(selectNone(picked, shown))}>
          {t("verify.selectNone")}
        </button>
        <button className="btn small" onClick={() => onPick(invert(picked, shown))}>
          {t("verify.invert")}
        </button>
        <span className="font-mono text-s text-ink-3" data-testid="picked-count">
          {chosen}/{findings.length}
        </span>
      </div>
      <div className="flist" data-testid="finding-list">
        {shown.length === 0 && <p className="m-0 p-4 text-ink-3">{t("verify.noRows")}</p>}
        {shown.map((f) => {
          const state = status(f);
          return (
            <label key={f.key} className="frow" data-testid="finding-row" data-id={f.id}>
              <input type="checkbox" checked={picked.has(f.id!)} onChange={() => onPick(toggle(picked, f.id!))} aria-label={f.ref} />
              <span className={`kchip ${f.kind}`}>{f.ref}</span>
              <span className="t">{text.get(f.key)}</span>
              <span>
                {state === "queued" ? (
                  <span className="vchip busy">{t("verify.queued")}</span>
                ) : state === "error" ? (
                  <span className="vchip bad" title={errors.get(f.id!)}>
                    {t("verify.error")}
                  </span>
                ) : (
                  <span className={`vchip ${f.verdict}`}>
                    {t(`verdict.${f.verdict}` as MessageKey)}
                    {f.boundary && f.boundary !== "complete" ? ` · ${t(`boundary.${f.boundary}` as MessageKey)}` : ""}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
