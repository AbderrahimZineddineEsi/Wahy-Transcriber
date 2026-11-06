import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { CopyButton } from "../../shell/fields";
import { useToasts } from "../../shell/toasts";
import { formatDate, parseServerDate } from "../lectures/format";
import { millis, rawJson, readableJson, tokens, usd } from "../verification/format";
import { useClearRequests, useRequest, useRequests, type LogFilter, type RequestFinding, type RequestRow } from "./api";

const PAGE = 100;
const PROVIDER_NAMES: Record<string, string> = { gemini: "Gemini", jev: "JEV", openrouter: "OpenRouter", laya: "Laya", groq: "Groq", fake: "fake" };

/** A server verdict as the verdict-chip class and text key. */
const CHIP: Record<string, "ok" | "bad" | "unsure"> = { CORRECT: "ok", FALSE: "bad", NOT_SURE: "unsure" };
export const chipOf = (verdict: string | null | undefined): "ok" | "bad" | "unsure" | "none" => (verdict ? (CHIP[verdict] ?? "none") : "none");

/** F-095, F-096: every AI request with its cost, and the exact JSON of the one you open. */
export function RequestsPage() {
  const { t } = useI18n();
  const toasts = useToasts();
  const [params, setParams] = useSearchParams();
  const [limit, setLimit] = useState(PAGE);
  const [provider, setProvider] = useState("");
  const [ok, setOk] = useState<LogFilter["ok"]>("all");
  const [confirm, setConfirm] = useState(false);
  const lecture = Number(params.get("lecture")) || null;
  const job = params.get("job");
  const selected = Number(params.get("request")) || null;
  const filter: LogFilter = { lecture, job, provider, ok, limit };
  const log = useRequests(filter);
  const clear = useClearRequests();

  const select = (id: number | null) => {
    const next = new URLSearchParams(params);
    if (id === null) next.delete("request");
    else next.set("request", String(id));
    setParams(next, { replace: true });
  };
  const dropScope = () => setParams(new URLSearchParams(), { replace: true });

  return (
    <>
      <div className="row flex-wrap">
        <h1 className="text-xl font-semibold">{t("page.requests")}</h1>
        {(lecture !== null || job !== null) && (
          <button className="chip on" onClick={dropScope} title={t("requests.showAll")}>
            {lecture !== null ? t("requests.ofLecture", { id: lecture }) : t("requests.ofPass")} ✕
          </button>
        )}
        <span className="flex-1" />
        <select className="input h-8 w-auto" aria-label={t("requests.provider")} value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="">{t("requests.allProviders")}</option>
          {Object.entries(PROVIDER_NAMES).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select className="input h-8 w-auto" aria-label={t("requests.status")} value={ok} onChange={(e) => setOk(e.target.value as LogFilter["ok"])}>
          <option value="all">{t("requests.anyStatus")}</option>
          <option value="ok">{t("requests.statusOk")}</option>
          <option value="failed">{t("requests.statusFailed")}</option>
        </select>
        <span className="text-s text-ink-2" data-testid="log-total">
          {t("requests.total", { n: log.data?.total ?? 0 })} · <b className="font-mono">{usd(log.data?.total_cost_usd)}</b>
        </span>
        <button
          className={`btn small${confirm ? " danger" : " ghost"}`}
          disabled={!log.data?.total || clear.isPending}
          onBlur={() => setConfirm(false)}
          onClick={() => {
            if (!confirm) return setConfirm(true);
            setConfirm(false);
            clear.mutate(lecture, { onSuccess: (r) => toasts.success(t("requests.cleared", { n: r.deleted })) });
          }}
        >
          {confirm ? t("requests.clearConfirm") : t("requests.clear")}
        </button>
      </div>
      <div className="vgrid">
        <section className="panel">
          {log.data && log.data.items.length === 0 ? (
            <p className="panel-b m-0 text-ink-3">{t("requests.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data" data-testid="request-table">
                <thead>
                  <tr>
                    <th>{t("requests.col.time")}</th>
                    <th>{t("requests.col.provider")}</th>
                    <th>{t("requests.col.quote")}</th>
                    <th>{t("requests.col.verdict")}</th>
                    <th>{t("requests.col.you")}</th>
                    <th>{t("requests.col.context")}</th>
                    <th>{t("requests.col.tokens")}</th>
                    <th>{t("requests.col.cost")}</th>
                    <th>{t("requests.col.latency")}</th>
                  </tr>
                </thead>
                <tbody>
                  {log.data?.items.map((r) => (
                    <Row key={r.id} r={r} picked={r.id === selected} onOpen={() => select(r.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {log.data && log.data.items.length < log.data.total && (
            <div className="panel-b">
              <button className="btn small" onClick={() => setLimit(limit + PAGE)}>
                {t("requests.more", { n: log.data.total - log.data.items.length })}
              </button>
            </div>
          )}
        </section>
        <Inspector id={selected} onClose={() => select(null)} />
      </div>
    </>
  );
}

function Row({ r, picked, onOpen }: { r: RequestRow; picked: boolean; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const first = r.findings[0];
  const more = r.findings.length - 1;
  const time = new Intl.DateTimeFormat(lang === "ar" ? "ar-u-nu-latn" : "en", { timeStyle: "medium" }).format(parseServerDate(r.created_at));
  return (
    <tr className={`clickable${picked ? " picked" : ""}`} data-testid="request-row" data-id={r.id} onClick={onOpen} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <td className="font-mono" title={formatDate(r.created_at, lang)}>{time}</td>
      <td>
        <div>{PROVIDER_NAMES[r.provider] ?? r.provider}</div>
        <div className="font-mono text-xs text-ink-3" dir="ltr">{r.model}</div>
      </td>
      <td>
        {first ? first.display_ref ?? `#${first.finding_id}` : "—"}
        {more > 0 && <span className="ms-1 text-xs text-ink-3">+{more}</span>}
      </td>
      <td>{r.ok ? <Verdicts findings={r.findings} /> : <span className="vchip bad" title={r.error ?? ""}>{t("requests.failed")}</span>}</td>
      <td>{r.findings.some((f) => f.human) ? <Human findings={r.findings} /> : "—"}</td>
      <td className="font-mono">{tokens(r.context_chars)}</td>
      <td className="font-mono">{r.input_tokens == null ? "—" : `${tokens(r.input_tokens)}/${tokens(r.output_tokens)}`}</td>
      <td className="font-mono">{usd(r.cost_usd)}</td>
      <td className="font-mono">{millis(r.latency_ms)}</td>
    </tr>
  );
}

function top(f: RequestFinding): string {
  if (!f.probabilities) return f.confidence == null ? "" : f.confidence.toFixed(2);
  const best = Math.max(...Object.values(f.probabilities));
  return best.toFixed(2);
}

function Verdicts({ findings }: { findings: RequestFinding[] }) {
  const { t } = useI18n();
  const first = findings[0];
  if (!first?.verdict) return <>—</>;
  const kinds = new Set(findings.map((f) => chipOf(f.verdict)));
  const shown = kinds.size === 1 ? chipOf(first.verdict) : "none";
  return (
    <span className={`vchip ${shown}`}>
      {kinds.size === 1 ? t(`verdict.${shown}` as MessageKey) : t("requests.mixed", { n: findings.length })} <span className="font-mono">{findings.length === 1 ? top(first) : ""}</span>
    </span>
  );
}

function Human({ findings }: { findings: RequestFinding[] }) {
  const { t } = useI18n();
  const h = findings.find((f) => f.human)?.human;
  const chip = chipOf(h?.verdict);
  return <span className={`vchip ${chip}`}>{t(`verdict.${chip}` as MessageKey)}</span>;
}

function Inspector({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { t } = useI18n();
  const detail = useRequest(id);
  const [mode, setMode] = useState<"readable" | "raw">("readable");
  const d = detail.data;
  const show = (value: unknown) => (mode === "readable" ? readableJson(value) : rawJson(value));
  return (
    <aside className="panel" aria-labelledby="inspector-title">
      <div className="panel-h">
        <h3 id="inspector-title" className="text-l font-semibold">{t("requests.inspector")}</h3>
        <span className="flex-1" />
        <div className="seg" role="group" aria-label={t("requests.view")}>
          <button aria-pressed={mode === "readable"} onClick={() => setMode("readable")}>{t("requests.readable")}</button>
          <button aria-pressed={mode === "raw"} onClick={() => setMode("raw")}>{t("requests.raw")}</button>
        </div>
        {id !== null && <button className="iconbtn" aria-label={t("card.close")} onClick={onClose}>✕</button>}
      </div>
      <div className="panel-b" data-testid="inspector">
        {id === null && <p className="m-0 text-ink-3">{t("requests.pick")}</p>}
        {id !== null && !d && <p className="m-0 text-ink-3">{t("verify.loading")}</p>}
        {d && (
          <>
            <p className="m-0 font-mono text-s text-ink-2" dir="ltr">
              #{d.id} · {d.provider} · {d.model} · {d.purpose}
            </p>
            {d.error && <p role="alert" className="m-0 text-s text-bad">{d.error}</p>}
            <div className="row">
              <span className="label">{t("requests.input")}</span>
              <span className="flex-1" />
              <CopyButton text={() => show(d.request)} label={t("requests.copyInput")} />
            </div>
            <pre className="code" data-testid="payload-in">{show(d.request)}</pre>
            <div className="row">
              <span className="label">{t("requests.output")}</span>
              <span className="flex-1" />
              <CopyButton text={() => show(d.response)} label={t("requests.copyOutput")} />
            </div>
            <pre className="code" data-testid="payload-out">{d.response == null ? "—" : show(d.response)}</pre>
          </>
        )}
      </div>
    </aside>
  );
}
