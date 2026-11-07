import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, data } from "../../api/client";
import { useHealth, type Health } from "../../api/health";
import { useI18n } from "../../shell/i18n";
import { useTheme, type ThemeChoice } from "../../shell/theme";
import { useToasts } from "../../shell/toasts";
import { EnginePanel } from "./EnginePanel";
import { LayaPanel } from "./LayaPanel";

// The provider names are brand names: they are never translated.
const PROVIDERS = [
  { id: "groq", name: "Groq" },
  { id: "gemini", name: "Gemini" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "jev", name: "JEV" },
] as const;

export function SettingsPage() {
  const { t } = useI18n();
  return (
    <>
      <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-start gap-3">
        <KeysPanel />
        <StatusPanel />
        <EnginePanel />
        <LayaPanel />
        <InterfacePanel />
      </div>
    </>
  );
}

function KeysPanel() {
  const { t } = useI18n();
  const health = useHealth();
  return (
    <section className="panel" aria-labelledby="keys-title">
      <div className="panel-h">
        <h3 id="keys-title" className="text-l font-semibold">{t("settings.keys")}</h3>
        <span className="text-xs text-ink-3">{t("settings.keysHelp")}</span>
      </div>
      <div className="panel-b">
        {PROVIDERS.map((p) => (
          <KeyRow key={p.id} provider={p} isSet={health.data?.keys[p.id] ?? false} />
        ))}
      </div>
    </section>
  );
}

function KeyRow({ provider, isSet }: { provider: (typeof PROVIDERS)[number]; isSet: boolean }) {
  const { t } = useI18n();
  const toasts = useToasts();
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");

  const save = useMutation({
    mutationFn: (key: string) =>
      data(api.PUT("/api/settings/keys/{provider}", { params: { path: { provider: provider.id } }, body: { value: key } })),
    onSuccess: (keys, key) => {
      // The answer is only "which keys are set": put it straight into the health cache.
      queryClient.setQueryData<Health>(["health"], (old) => (old ? { ...old, keys } : old));
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      setValue("");
      toasts.success(t(key ? "settings.keySaved" : "settings.keyRemoved", { provider: provider.name }));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (value.trim()) save.mutate(value.trim());
  }

  const label = `${provider.name}`;
  return (
    <form className="row" onSubmit={submit} aria-label={label}>
      <b className="min-w-[90px]">{provider.name}</b>
      <span className={`vchip ${isSet ? "ok" : "none"}`} data-testid={`key-${provider.id}`} data-set={isSet}>
        {isSet ? t("settings.keySet") : t("settings.keyNotSet")}
      </span>
      <span className="flex-1" />
      <input
        className="input w-[180px] !h-8 font-mono"
        dir="ltr"
        type="password"
        autoComplete="off"
        aria-label={`${provider.name} API key`}
        placeholder={isSet ? t("settings.keyPlaceholderReplace") : t("settings.keyPlaceholderNew")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="btn small" type="submit" disabled={!value.trim() || save.isPending}>
        {t("settings.keySave")}
      </button>
      {isSet && (
        <button className="btn small ghost danger" type="button" disabled={save.isPending} onClick={() => save.mutate("")}>
          {t("settings.keyRemove")}
        </button>
      )}
    </form>
  );
}

function StatusPanel() {
  const { t } = useI18n();
  const health = useHealth();
  const h = health.data;
  const connected = !!h && !health.isError;
  return (
    <section className="panel" aria-labelledby="status-title">
      <div className="panel-h">
        <h3 id="status-title" className="text-l font-semibold">{t("settings.status")}</h3>
      </div>
      <div className="panel-b">
        <table className="data">
          <tbody>
            <tr>
              <td>{t("settings.statusServer")}</td>
              <td>
                <span className={`vchip ${connected ? "ok" : "bad"}`}>{connected ? t("settings.connected") : t("settings.unreachable")}</span>
              </td>
            </tr>
            {h && (
              <>
                <tr>
                  <td>{t("settings.statusEngine")}</td>
                  <td>{h.engine.running ? t("settings.engineRunning") : t("settings.engineIdle")}</td>
                </tr>
                <tr>
                  <td>{t("settings.statusCorpus")}</td>
                  <td>
                    <span className={`vchip ${h.corpus.ready ? "ok" : "unsure"}`}>{h.corpus.ready ? t("settings.corpusReady") : t("settings.corpusMissing")}</span>
                    <span className="ms-2 font-mono text-ink-3">{h.corpus.hadith_source}</span>
                  </td>
                </tr>
                <tr>
                  <td>{t("settings.statusGpu")}</td>
                  <td>{gpuText(h, t)}</td>
                </tr>
                <tr>
                  <td>{t("settings.statusModel")}</td>
                  <td className="font-mono">{h.gpu.resident ?? t("settings.modelNone")}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function gpuText(h: Health, t: ReturnType<typeof useI18n>["t"]): string {
  if (!h.gpu.card) return t("settings.gpuNone");
  const free = h.gpu.free_mb != null && h.gpu.total_mb != null ? ` · ${t("settings.gpuFree", { free: h.gpu.free_mb, total: h.gpu.total_mb })}` : "";
  return `${h.gpu.card}${free}`;
}

function InterfacePanel() {
  const { t, lang, setLang } = useI18n();
  const theme = useTheme();
  const themes: { id: ThemeChoice; label: string }[] = [
    { id: "light", label: t("settings.themeLight") },
    { id: "dark", label: t("settings.themeDark") },
    { id: "system", label: t("settings.themeSystem") },
  ];
  return (
    <section className="panel" aria-labelledby="ui-title">
      <div className="panel-h">
        <h3 id="ui-title" className="text-l font-semibold">{t("settings.ui")}</h3>
      </div>
      <div className="panel-b">
        <div className="field">
          <span className="label">{t("settings.language")}</span>
          <div className="seg" role="group" aria-label={t("settings.language")}>
            <button aria-pressed={lang === "ar"} onClick={() => setLang("ar")}>العربية</button>
            <button aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
          </div>
        </div>
        <div className="field">
          <span className="label">{t("settings.theme")}</span>
          <div className="seg" role="group" aria-label={t("settings.theme")}>
            {themes.map((x) => (
              <button key={x.id} aria-pressed={theme.choice === x.id} onClick={() => theme.setChoice(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
