import { useState } from "react";
import { Link } from "react-router-dom";
import { useHealth } from "../../api/health";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { CommitInput, CommitTextarea } from "../../shell/fields";
import {
  useGeminiModels,
  useLayaStatus,
  useOpenRouterModels,
  usePromptCatalog,
  useUpdateSettings,
  type OpenRouterModel,
  type Settings,
  type PromptConfig,
  type PromptRules,
  type Provider,
} from "./api";
import { pricePerM } from "./format";
import { useStudio } from "../../shell/edition";

// Provider names are brand names: they are never translated.
// Laya (local) is a research model: only the studio offers it.
const PROVIDERS: { id: Provider; label: string; studio?: true }[] = [
  { id: "laya", label: "Laya", studio: true },
  { id: "gemini", label: "Gemini" },
  { id: "jev", label: "JEV" },
  { id: "openrouter", label: "OpenRouter" },
];
const PRESETS = ["balanced", "strict", "lenient", "boundaries"] as const;
const RULES: (keyof PromptRules)[] = [
  "ignore_asr_errors", "citation_cues", "narrator_names", "explaining_repeat", "cue_before_garbled",
  "explaining_with_text", "prefer_not_sure", "passages", "no_thinking", "suggest_merges",
];

/** F-080 to F-086: the verifier, its model and its options, saved on the server as the settings a pass uses.
 *  Every change is saved at once; the estimate beside it follows. */
export function VerifierPanel({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const update = useUpdateSettings();
  const health = useHealth();
  const provider = settings.provider;
  const studio = useStudio();
  const keyMissing = provider !== "laya" && provider !== "fake" && health.data !== undefined && !health.data.keys[provider];

  return (
    <div className="flex flex-col gap-3">
      <div className="field">
        <span className="label">{t("verify.verifier")}</span>
        <div className="seg flex-wrap" role="group" aria-label={t("verify.verifier")}>
          {PROVIDERS.filter((p) => studio || !p.studio).map((p) => (
            <button key={p.id} aria-pressed={provider === p.id} onClick={() => update.mutate({ provider: p.id })}>
              {p.label}
            </button>
          ))}
          {provider === "fake" && <button aria-pressed>fake</button>}
        </div>
      </div>
      {keyMissing && (
        <p role="alert" className="m-0 rounded-m bg-unsure-soft px-3 py-2 text-s text-unsure">
          {t("verify.keyMissing", { provider: PROVIDERS.find((p) => p.id === provider)?.label ?? provider })}{" "}
          <Link className="font-semibold underline" to="/settings">
            {t("nav.settings")}
          </Link>
        </p>
      )}
      {provider === "laya" && <LayaFields settings={settings} />}
      {provider === "gemini" && <GeminiFields settings={settings} />}
      {provider === "jev" && (
        <div className="field">
          <span className="label">{t("verify.jevModel")}</span>
          <CommitInput className="input font-mono" dir="ltr" aria-label={t("verify.jevModel")} value={settings.jev_model} onCommit={(v) => update.mutate({ jev_model: v })} />
        </div>
      )}
      {provider === "openrouter" && <OpenRouterFields settings={settings} />}
      {provider !== "laya" && <PromptedOptions settings={settings} />}
    </div>
  );
}

function LayaFields({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const update = useUpdateSettings();
  const status = useLayaStatus(true).data;
  const env = status?.envelope;
  return (
    <>
      <div className="field">
        <span className="label">{t("verify.checkpoint")}</span>
        <CommitInput
          className="input font-mono"
          dir="ltr"
          aria-label={t("verify.checkpoint")}
          placeholder={status?.checkpoint ?? ""}
          value={settings.laya_checkpoint ?? ""}
          onCommit={(v) => update.mutate({ laya_checkpoint: v })}
        />
      </div>
      <div className="field">
        <span className="label">{t("verify.device")}</span>
        <div className="seg" role="group" aria-label={t("verify.device")}>
          {(["auto", "cuda", "cpu"] as const).map((d) => (
            <button key={d} aria-pressed={(settings.laya_device ?? "auto") === d} onClick={() => update.mutate({ laya_device: d })}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="text-s text-ink-2" data-testid="laya-info">
        {status && !status.installed
          ? t("verify.layaMissing")
          : [
              status?.loaded ? t("verify.layaLoaded", { device: status.device ?? "?" }) : t("verify.layaNotLoaded"),
              env ? t("verify.layaEnvelope", { v: env.version }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
      </div>
      <p className="m-0 text-s text-ink-3">{t("verify.layaHint")}</p>
    </>
  );
}

function GeminiFields({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const update = useUpdateSettings();
  const models = useGeminiModels();
  return (
    <>
      <div className="field">
        <span className="label">{t("verify.model")}</span>
        <div className="row">
          <CommitInput
            className="input flex-1 font-mono"
            dir="ltr"
            list="gemini-models"
            aria-label={t("verify.model")}
            value={settings.gemini_model}
            onCommit={(v) => update.mutate({ gemini_model: v })}
          />
          <button className="btn small" disabled={models.isPending} onClick={() => models.mutate()}>
            {t("verify.fetchModels")}
          </button>
        </div>
        <datalist id="gemini-models">{models.data?.models.map((m) => <option key={m} value={m} />)}</datalist>
        {models.data && <span className="text-xs text-ink-3">{t("verify.modelsFound", { n: models.data.models.length })}</span>}
      </div>
      <div className="grid2">
        <div className="field">
          <span className="label">{t("verify.batch")}</span>
          <select className="input" aria-label={t("verify.batch")} value={settings.gemini_batch_size} onChange={(e) => update.mutate({ gemini_batch_size: Number(e.target.value) })}>
            {[5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="label">{t("verify.rpm")}</span>
          <CommitInput
            className="input font-mono"
            type="number"
            min={1}
            max={120}
            aria-label={t("verify.rpm")}
            disabled={!settings.gemini_free_tier}
            value={String(settings.gemini_rpm)}
            onCommit={(v) => Number(v) >= 1 && update.mutate({ gemini_rpm: Math.min(120, Math.round(Number(v))) })}
          />
        </div>
      </div>
      <label className="switch">
        <input type="checkbox" checked={settings.gemini_free_tier} onChange={(e) => update.mutate({ gemini_free_tier: e.target.checked })} />
        {t("verify.freeTier")}
      </label>
    </>
  );
}

const CATEGORIES = ["all", "jev", "gemini", "chinese", "free"] as const;

function OpenRouterFields({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const update = useUpdateSettings();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");
  const [open, setOpen] = useState(false);
  const found = useOpenRouterModels(query.trim(), category, open);
  const pick = (m: OpenRouterModel) => {
    update.mutate({ openrouter_model: m.id });
    setOpen(false);
  };
  return (
    <div className="field">
      <span className="label">{t("verify.chatModel")}</span>
      <div className="row">
        <b className="font-mono text-s break-all" dir="ltr" data-testid="chat-model">{settings.openrouter_model}</b>
        <span className="flex-1" />
        <button className="btn small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t("verify.searchModels")}
        </button>
      </div>
      {open && (
        <div className="rounded-m border border-line">
          <div className="flex flex-col gap-2 p-2">
            <input className="input" type="search" dir="ltr" placeholder={t("verify.searchPlaceholder")} aria-label={t("verify.searchModels")} value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="row gap-1.5" role="group" aria-label={t("verify.category")}>
              {CATEGORIES.map((c) => (
                <button key={c} className={`chip${category === c ? " on" : ""}`} aria-pressed={category === c} onClick={() => setCategory(c)}>
                  {t(`verify.cat.${c}` as MessageKey)}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto" data-testid="model-results">
            {found.isError && <p className="m-0 p-3 text-s text-bad">{(found.error as Error).message}</p>}
            {found.data?.length === 0 && <p className="m-0 p-3 text-s text-ink-3">{t("verify.noModels")}</p>}
            {found.data?.map((m) => (
              <button key={m.id} className="mrow" aria-pressed={m.id === settings.openrouter_model} onClick={() => pick(m)}>
                <span className="font-mono text-s break-all" dir="ltr">{m.id}</span>
                <span className="font-mono text-xs text-ink-3" dir="ltr">
                  {m.free ? "free" : `${pricePerM(m.prompt_price_per_m)} / ${pricePerM(m.completion_price_per_m)}`}
                </span>
                <span className="text-xs text-ink-3">
                  {Math.round(m.context_length / 1000)}k {m.json_mode ? "· JSON" : `· ${t("verify.noJson")}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="switch mt-2">
        <input
          type="checkbox"
          checked={settings.prompt.rules.no_thinking}
          onChange={(e) => update.mutate({ prompt: { ...settings.prompt, rules: { ...settings.prompt.rules, no_thinking: e.target.checked } } })}
        />
        {t("verify.rule.no_thinking")}
      </label>
    </div>
  );
}

/** F-085, F-086: the options of a prompted verifier (everything but Laya, which reads the envelope it was trained
 *  on): passages, merges, the verdict style, the rules, the language of the reasons, and the prompts themselves. */
function PromptedOptions({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const update = useUpdateSettings();
  const catalog = usePromptCatalog().data;
  const prompt = settings.prompt;
  const setPrompt = (change: Partial<PromptConfig>) => update.mutate({ prompt: { ...prompt, ...change } });
  const setRule = (name: keyof PromptRules, on: boolean) => setPrompt({ rules: { ...prompt.rules, [name]: on } });
  const showRules = RULES.filter((r) => r !== "no_thinking"); // shown beside the OpenRouter model

  return (
    <details className="opts">
      <summary>{t("verify.options")}</summary>
      <div className="flex flex-col gap-3">
        <div className="field">
          <span className="label">{t("verify.preset")}</span>
          <div className="seg flex-wrap" role="group" aria-label={t("verify.preset")}>
            {PRESETS.map((p) => (
              <button key={p} aria-pressed={prompt.preset === p} title={catalog?.presets[p]?.hint as string | undefined} onClick={() => setPrompt({ preset: p })}>
                {t(`verify.preset.${p}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <span className="label">{t("verify.context")}</span>
            <CommitInput
              className="input font-mono"
              type="number"
              min={5}
              max={100}
              aria-label={t("verify.context")}
              value={String(settings.context_words)}
              onCommit={(v) => Number(v) >= 5 && update.mutate({ context_words: Math.min(100, Math.round(Number(v))) })}
            />
          </div>
          <div className="field">
            <span className="label">{t("verify.temperature")}</span>
            <CommitInput
              className="input font-mono"
              type="number"
              step={0.1}
              min={0}
              max={1}
              aria-label={t("verify.temperature")}
              value={String(prompt.temperature)}
              onCommit={(v) => v !== "" && Number(v) >= 0 && Number(v) <= 1 && setPrompt({ temperature: Number(v) })}
            />
          </div>
          <div className="field">
            <span className="label">{t("verify.reasonLang")}</span>
            <div className="seg" role="group" aria-label={t("verify.reasonLang")}>
              {(["ar", "en"] as const).map((l) => (
                <button key={l} aria-pressed={prompt.reason_lang === l} onClick={() => setPrompt({ reason_lang: l })}>
                  {l === "ar" ? "العربية" : "English"}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">{t("verify.reasonDetail")}</span>
            <div className="seg" role="group" aria-label={t("verify.reasonDetail")}>
              {(["brief", "detailed"] as const).map((d) => (
                <button key={d} aria-pressed={prompt.reason_detail === d} onClick={() => setPrompt({ reason_detail: d })}>
                  {t(`verify.detail.${d}` as MessageKey)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2" role="group" aria-label={t("verify.rules")}>
          {showRules.map((r) => (
            <label key={r} className="switch" title={catalog?.rules[r]?.hint as string | undefined}>
              <input type="checkbox" checked={prompt.rules[r]} onChange={(e) => setRule(r, e.target.checked)} />
              {t(`verify.rule.${r}` as MessageKey)}
            </label>
          ))}
        </div>
        <div className="field">
          <span className="label">{t("verify.extra")}</span>
          <CommitTextarea aria-label={t("verify.extra")} rows={3} value={prompt.extra_instructions} onCommit={(v) => setPrompt({ extra_instructions: v })} />
        </div>
        <div className="field">
          <span className="label">{t("verify.systemPrompt")}</span>
          <CommitTextarea
            aria-label={t("verify.systemPrompt")}
            rows={6}
            dir="ltr"
            placeholder={t("verify.systemDefault")}
            value={prompt.system_prompt_override}
            onCommit={(v) => setPrompt({ system_prompt_override: v })}
          />
          <div className="row">
            <button className="btn small" disabled={!catalog} onClick={() => catalog && setPrompt({ system_prompt_override: catalog.default_system_prompt })}>
              {t("verify.loadDefault")}
            </button>
            <button className="btn small ghost" disabled={!prompt.system_prompt_override} onClick={() => setPrompt({ system_prompt_override: "" })}>
              {t("verify.resetPrompt")}
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}
