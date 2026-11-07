import { useEffect, useState } from "react";
import { useI18n } from "../../shell/i18n";
import { useLayaActions, useLayaStatus } from "../corpora/api";

const DEVICES = ["auto", "cuda", "cpu"] as const;

/** F-097, F-098: is Laya loaded, where, how much GPU memory is left, which envelope it reads; load or unload it. */
export function LayaPanel() {
  const { t } = useI18n();
  const status = useLayaStatus();
  const actions = useLayaActions();
  const s = status.data;
  const [checkpoint, setCheckpoint] = useState("");
  const [device, setDevice] = useState<(typeof DEVICES)[number]>("auto");
  useEffect(() => {
    if (s && !checkpoint) setCheckpoint(s.checkpoint);
  }, [s, checkpoint]);
  const busy = actions.load.isPending || actions.unload.isPending;
  const vram = s?.vram ?? {};
  const free = typeof vram.free_mb === "number" ? vram.free_mb : null;
  const total = typeof vram.total_mb === "number" ? vram.total_mb : null;
  const used = typeof vram.allocated_mb === "number" ? vram.allocated_mb : null;

  return (
    <section className="panel" aria-labelledby="laya-title">
      <div className="panel-h">
        <h3 id="laya-title" className="text-l font-semibold">{t("settings.laya")}</h3>
        {s && (
          <span className={`vchip ${s.loaded ? "ok" : "none"}`} data-testid="laya-state">
            {s.loaded ? t("settings.layaLoaded") : t("settings.layaNotLoaded")}
          </span>
        )}
      </div>
      <div className="panel-b">
        {s && !s.installed && <p className="m-0 text-s text-unsure">{t("settings.layaNotInstalled")}</p>}
        <table className="data">
          <tbody>
            <tr>
              <td>{t("settings.layaDevice")}</td>
              <td data-testid="laya-device">{s?.device ?? "—"}</td>
            </tr>
            <tr>
              <td>{t("settings.layaVram")}</td>
              <td data-testid="laya-vram">
                {free !== null && total !== null ? t("settings.gpuFree", { free: Math.round(free), total: Math.round(total) }) : t("settings.gpuNone")}
                {used !== null && used > 0 ? ` · ${t("settings.layaUsed", { used: Math.round(used) })}` : ""}
              </td>
            </tr>
            <tr>
              <td>{t("settings.layaCheckpoint")}</td>
              <td className="font-mono break-all" dir="ltr">{s?.checkpoint ?? "—"}</td>
            </tr>
            <tr>
              <td>{t("settings.layaEnvelope")}</td>
              <td data-testid="laya-envelope">{s?.envelope ? `v${s.envelope.version}` : "—"}</td>
            </tr>
          </tbody>
        </table>
        <div className="field">
          <span className="label">{t("settings.layaCheckpointChoose")}</span>
          <input className="input !h-8 font-mono" dir="ltr" value={checkpoint} onChange={(e) => setCheckpoint(e.target.value)} aria-label={t("settings.layaCheckpointChoose")} placeholder={t("settings.layaCheckpointHint")} />
        </div>
        <div className="row flex-wrap">
          <div className="seg" role="group" aria-label={t("settings.layaDevice")}>
            {DEVICES.map((d) => (
              <button key={d} aria-pressed={device === d} onClick={() => setDevice(d)}>
                {d}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <button className="btn small primary" disabled={busy || !s?.installed} onClick={() => actions.load.mutate({ checkpoint: checkpoint.trim() || undefined, device })} data-testid="laya-load">
            {actions.load.isPending ? t("settings.layaLoading") : t("settings.layaLoad")}
          </button>
          <button className="btn small" disabled={busy || !s?.loaded} onClick={() => actions.unload.mutate()} data-testid="laya-unload">
            {t("settings.layaUnload")}
          </button>
        </div>
      </div>
    </section>
  );
}
