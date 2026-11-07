import { useState, type FormEvent } from "react";
import { useI18n } from "../../shell/i18n";
import { useQuoteActions, useQuotes, type Quote } from "./api";

const MIN_CHARS = 4;

/** F-075: sayings that are not in the corpus (custom quotes); the engine finds them like any hadith. */
export function QuotesTab() {
  const { t } = useI18n();
  const quotes = useQuotes();
  const actions = useQuoteActions();
  const [text, setText] = useState("");
  const [ref, setRef] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length < MIN_CHARS) return;
    actions.add.mutate({ t: text.trim(), ref: ref.trim() || "حديث خارج القاعدة" }, { onSuccess: () => (setText(""), setRef("")) });
  }

  return (
    <div className="vgrid">
      <section className="panel" aria-label={t("corp.tab.quotes")}>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>{t("corp.quotes.text")}</th>
                <th>{t("corp.quotes.ref")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(quotes.data ?? []).map((q) =>
                editing === q.id ? (
                  <EditRow key={q.id} quote={q} onDone={() => setEditing(null)} />
                ) : (
                  <tr key={q.id} data-testid="quote-row">
                    <td className="font-quran">{q.t}</td>
                    <td>{q.ref}</td>
                    <td className="whitespace-nowrap">
                      <button className="btn small ghost" onClick={() => setEditing(q.id)}>
                        {t("corp.edit")}
                      </button>
                      <button className="btn small ghost danger" onClick={() => actions.remove.mutate(q.id)} aria-label={`${t("corp.delete")} ${q.t}`}>
                        {t("corp.delete")}
                      </button>
                    </td>
                  </tr>
                ),
              )}
              {quotes.data?.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-ink-3">
                    {t("corp.quotes.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <aside className="panel">
        <div className="panel-h">
          <h3 className="text-l font-semibold">{t("corp.quotes.add")}</h3>
        </div>
        <form className="panel-b" onSubmit={submit}>
          <textarea className="input font-quran" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("corp.quotes.placeholder")} aria-label={t("corp.quotes.text")} data-testid="quote-new" />
          <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t("corp.quotes.refPlaceholder")} aria-label={t("corp.quotes.ref")} />
          <button className="btn primary self-start" type="submit" disabled={text.trim().length < MIN_CHARS || actions.add.isPending} data-testid="quote-add">
            {t("corp.add")}
          </button>
        </form>
      </aside>
    </div>
  );
}

function EditRow({ quote, onDone }: { quote: Quote; onDone: () => void }) {
  const { t } = useI18n();
  const actions = useQuoteActions();
  const [text, setText] = useState(quote.t);
  const [ref, setRef] = useState(quote.ref);
  return (
    <tr>
      <td>
        <textarea className="input font-quran" rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label={t("corp.quotes.text")} />
      </td>
      <td>
        <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} aria-label={t("corp.quotes.ref")} />
      </td>
      <td className="whitespace-nowrap">
        <button className="btn small" disabled={text.trim().length < MIN_CHARS} onClick={() => actions.update.mutate({ id: quote.id, body: { t: text.trim(), ref: ref.trim() } }, { onSuccess: onDone })}>
          {t("corp.save")}
        </button>
        <button className="btn small ghost" onClick={onDone}>
          {t("corp.cancel")}
        </button>
      </td>
    </tr>
  );
}
