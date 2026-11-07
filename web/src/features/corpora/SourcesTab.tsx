import { useRef } from "react";
import { useI18n } from "../../shell/i18n";
import { useToasts } from "../../shell/toasts";
import { useCorpusInfo, useSourceActions, useSources, type Source } from "./api";

/** F-014, F-015, F-078, F-079: where the hadith come from: status, prepare, re-prepare, use this one, upload by hand. */
export function SourcesTab() {
  const { t } = useI18n();
  const sources = useSources();
  const info = useCorpusInfo();
  return (
    <section className="panel" aria-label={t("corp.tab.sources")}>
      <div className="panel-h flex-wrap">
        <h3 className="text-l font-semibold">{t("corp.sources.title")}</h3>
        <span className="flex-1" />
        {info.data && (
          <span className="text-s text-ink-3" data-testid="corpus-totals">
            {t("corp.sources.totals", { quran: info.data.quran.toLocaleString("en"), hadiths: info.data.hadiths.toLocaleString("en"), adhkar: info.data.adhkar, quotes: info.data.custom_quotes })}
          </span>
        )}
      </div>
      <div className="panel-b">
        {(sources.data ?? []).map((s) => (
          <SourceRow key={s.id} source={s} />
        ))}
        <p className="m-0 text-xs text-ink-3">{t("corp.sources.help")}</p>
      </div>
    </section>
  );
}

function SourceRow({ source: s }: { source: Source }) {
  const { t } = useI18n();
  const toasts = useToasts();
  const actions = useSourceActions();
  const file = useRef<HTMLInputElement>(null);
  const busy = s.status === "preparing" || actions.prepare.isPending;
  const chip = s.status === "ready" ? "ok" : s.status === "preparing" ? "unsure" : "none";

  return (
    <div className="cand flex-wrap" data-testid={`source-${s.id}`} data-status={s.status}>
      <label className="flex min-w-[220px] flex-1 items-center gap-2">
        <input type="radio" name="hadith-source" checked={s.active} disabled={s.status !== "ready" || actions.activate.isPending} onChange={() => actions.activate.mutate(s.id)} aria-label={`${t("corp.sources.use")}: ${s.label}`} />
        <span>
          <b className="text-s">{s.label}</b>
          <span className="block text-xs text-ink-3">{s.description}</span>
        </span>
      </label>
      {s.count != null && <span className="font-mono text-xs text-ink-3">{s.count.toLocaleString("en")}</span>}
      <span className={`vchip ${chip}`} data-testid={`source-status-${s.id}`}>
        {t(`corp.sources.status.${s.status === "ready" ? "ready" : s.status === "preparing" ? "preparing" : "missing"}`)}
      </span>
      {!s.builtin && (
        <>
          <button className="btn small ghost" disabled={busy} onClick={() => actions.prepare.mutate({ id: s.id }, { onSuccess: () => toasts.success(t("corp.sources.started", { name: s.label })) })} data-testid={`source-prepare-${s.id}`}>
            {s.status === "ready" ? t("corp.sources.prepareAgain") : t("corp.sources.prepare")}
          </button>
          {s.zip_cached && (
            <button className="btn small ghost" disabled={busy} onClick={() => actions.prepare.mutate({ id: s.id, redownload: true })}>
              {t("corp.sources.redownload")}
            </button>
          )}
          <button className="btn small ghost" disabled={busy} onClick={() => file.current?.click()}>
            {t("corp.sources.upload")}
          </button>
          <input ref={file} type="file" accept=".zip,application/zip" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) actions.upload.mutate({ id: s.id, file: f });
          }} />
          {s.status === "ready" && (
            <button className="btn small ghost danger" disabled={busy} onClick={() => actions.remove.mutate(s.id)}>
              {t("corp.sources.forget")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
