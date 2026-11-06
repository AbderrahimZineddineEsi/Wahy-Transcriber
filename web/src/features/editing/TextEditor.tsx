import { useMemo, useState } from "react";
import { useI18n } from "../../shell/i18n";
import { useToasts } from "../../shell/toasts";
import type { LectureDetail } from "../lectures/api";
import { useReplaceText, useUndo } from "./api";

/** The lecture's words as text, a blank line at each long pause so it reads in paragraphs. Any whitespace
 *  separates words on the server, so the blank lines change nothing. */
export function lectureText(words: LectureDetail["words"]): string {
  let out = "";
  words.forEach((w, i) => {
    if (i > 0) out += i > 0 && w.start - words[i - 1].end >= 1.2 && /[.؟?!،]$/.test(words[i - 1].text) ? "\n\n" : " ";
    out += w.text;
  });
  return out;
}

/** F-067: edit the whole text. Saving aligns the new words with the old ones (LCS on the server), so unchanged
 *  words keep their times, and the edited spans are scanned for quotes again. */
export function TextEditor({ lecture }: { lecture: LectureDetail }) {
  const { t } = useI18n();
  const toasts = useToasts();
  const original = useMemo(() => lectureText(lecture.words), [lecture.words]);
  const [text, setText] = useState(original);
  const save = useReplaceText(lecture.id);
  const undo = useUndo(lecture.id);
  const dirty = text !== original;
  const count = text.split(/\s+/).filter(Boolean).length;
  return (
    <section className="panel">
      <div className="panel-h">
        <h3 className="font-semibold">{t("text.title")}</h3>
        <span className="mono text-s text-ink-3">{t("text.words", { n: count })}</span>
        <span className="flex-1" />
        <button className="btn small ghost" disabled={!dirty} onClick={() => setText(original)}>
          {t("text.reset")}
        </button>
        <button
          className="btn small primary"
          disabled={!dirty || !text.trim() || save.isPending}
          onClick={() =>
            save.mutate(text, {
              onSuccess: (done) =>
                toasts.success(t("text.saved", { n: done.added?.length ?? 0, m: done.removed?.length ?? 0 }), { label: t("undo.action"), run: () => undo.mutate() }),
            })
          }
        >
          {t("text.save")}
        </button>
      </div>
      <div className="panel-b flex flex-col gap-3">
        <p className="m-0 text-s text-ink-2">{t("text.help")}</p>
        <textarea className="input font-read" style={{ fontSize: "1.1rem", lineHeight: 1.9 }} rows={18} value={text} aria-label={t("text.title")} onChange={(e) => setText(e.target.value)} />
      </div>
    </section>
  );
}
