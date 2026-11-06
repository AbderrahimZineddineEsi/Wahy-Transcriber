import { useI18n, type MessageKey } from "../../shell/i18n";

/** A place in the navigation whose screen is built in a later phase. */
export function ComingSoon({ title }: { title: MessageKey }) {
  const { t } = useI18n();
  return (
    <section className="panel">
      <div className="panel-h">
        <h2 className="text-xl font-semibold">{t(title)}</h2>
      </div>
      <div className="panel-b">
        <p className="text-ink-2">
          <b>{t("page.comingTitle")}</b> — {t("page.coming")}
        </p>
      </div>
    </section>
  );
}
