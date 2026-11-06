import { useState } from "react";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { Modal } from "../../shell/Modal";
import { useToasts } from "../../shell/toasts";
import type { Word } from "../lectures/view/model";
import { useCorpusSearch, useDeleteFinding, useReplaceWords, useSaveDhikr, useUndo, type DeleteIntent, type SourceType } from "./api";

type WordsProps = {
  lectureId: number;
  words: readonly Word[];
  range: [number, number];
  hasMedia: boolean;
  onPlay: () => void;
  onClose: () => void;
  onDone: () => void;
};

/** F-056: rewrite or delete the selected words. The other words keep their times; new words share the time of
 *  the words they replace. */
export function WordsDialog({ lectureId, words, range, hasMedia, onPlay, onClose, onDone }: WordsProps) {
  const { t } = useI18n();
  const toasts = useToasts();
  const [a, b] = range;
  const old = words.slice(a, b + 1).map((w) => w.text).join(" ");
  const [text, setText] = useState(old);
  const replace = useReplaceWords(lectureId);
  const undo = useUndo(lectureId);
  const save = (value: string) =>
    replace.mutate(
      { start: a, end: b, text: value },
      {
        onSuccess: () => {
          toasts.success(value ? t("words.saved") : t("words.deleted"), { label: t("undo.action"), run: () => undo.mutate() });
          onDone();
          onClose();
        },
      },
    );
  return (
    <Modal title={t("words.title", { n: b - a + 1 })} onClose={onClose}>
      <p className="m-0 text-s text-ink-2">{t("words.help")}</p>
      <textarea className="input font-read text-base" rows={4} value={text} aria-label={t("words.title", { n: b - a + 1 })} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button className="btn primary" disabled={replace.isPending || !text.trim() || text.trim() === old} onClick={() => save(text.trim())}>
          {t("words.save")}
        </button>
        <button className="btn danger" disabled={replace.isPending} onClick={() => save("")}>
          {t("words.delete")}
        </button>
        {hasMedia && (
          <button className="btn ghost" onClick={onPlay}>
            {t("edit.listen")}
          </button>
        )}
      </div>
    </Modal>
  );
}

type Dhikr = { id: string; ref: string };

/** F-054: keep the words in the adhkar list, so the next detection finds them. */
export function DhikrDialog({ text, onClose, onSaved }: { text: string; onClose: () => void; onSaved: (dhikr: Dhikr) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(text.split(/\s+/).slice(0, 6).join(" "));
  const save = useSaveDhikr();
  return (
    <Modal title={t("dhikr.title")} onClose={onClose}>
      <div className="quote font-read">{text}</div>
      <label className="field">
        <span className="label">{t("dhikr.name")}</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <p className="m-0 text-s text-ink-2">{t("dhikr.help")}</p>
      <div className="row">
        <button
          className="btn primary"
          disabled={save.isPending || !name.trim()}
          onClick={() =>
            save.mutate(
              { text, name: name.trim() },
              {
                onSuccess: (d) => {
                  onSaved({ id: d.id, ref: d.ref });
                  onClose();
                },
              },
            )
          }
        >
          {t("dhikr.save")}
        </button>
      </div>
    </Modal>
  );
}

const INTENTS: DeleteIntent[] = ["ordinary_speech", "highlight_mistake", "testing"];

/** F-064: deleting asks why. Only "ordinary speech" is kept, as a gold "false" label for training. */
export function DeleteDialog({ lectureId, findingId, onClose, onDeleted }: { lectureId: number; findingId: number; onClose: () => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const toasts = useToasts();
  const remove = useDeleteFinding(lectureId);
  const undo = useUndo(lectureId);
  return (
    <Modal title={t("delete.title")} onClose={onClose}>
      <p className="m-0 text-s text-ink-2">{t("delete.help")}</p>
      <div className="flex flex-col gap-2">
        {INTENTS.map((intent) => (
          <button
            key={intent}
            className={`btn justify-start text-start ${intent === "ordinary_speech" ? "danger" : ""}`}
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(
                { findingId, intent },
                {
                  onSuccess: () => {
                    toasts.success(t(`delete.done.${intent}` as MessageKey), { label: t("undo.action"), run: () => undo.mutate() });
                    onDeleted();
                    onClose();
                  },
                },
              )
            }
          >
            <span className="flex flex-col items-start">
              <b>{t(`delete.${intent}` as MessageKey)}</b>
              <span className="text-xs text-ink-2">{t(`delete.${intent}.help` as MessageKey)}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

const SEARCH_KINDS: ("ALL" | SourceType)[] = ["ALL", "QURAN", "HADITH", "ADHKAR"];
const SEARCH_KIND_KEY: Record<"ALL" | SourceType, MessageKey> = { ALL: "kind.all", QURAN: "kind.quran", HADITH: "kind.hadith", ADHKAR: "kind.dhikr" };

/** F-061: search the corpus by reference ("البقرة: 255", "112:1") or words, then link the finding to a result or
 *  add it to the finding's matching references. */
export function ReferenceSearchDialog({
  initialKind,
  initialQuery,
  onClose,
  onPick,
}: {
  initialKind: SourceType;
  initialQuery: string;
  onClose: () => void;
  onPick: (unitId: string, link: boolean) => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<"ALL" | SourceType>(initialKind);
  const [q, setQ] = useState(initialQuery);
  const hits = useCorpusSearch(q, kind, true);
  return (
    <Modal title={t("refsearch.title")} onClose={onClose} wide>
      <div className="row">
        <div className="seg" role="group" aria-label={t("studio.kind")}>
          {SEARCH_KINDS.map((k) => (
            <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {t(SEARCH_KIND_KEY[k])}
            </button>
          ))}
        </div>
        <input className="input min-w-0 flex-1" type="search" autoFocus value={q} placeholder={t("refsearch.hint")} aria-label={t("refsearch.hint")} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex flex-col" data-testid="refsearch-results">
        {(hits.data ?? []).map((h) => (
          <div key={h.unitId} className="row border-b border-line py-2">
            <b className="text-s whitespace-nowrap">{h.displayRef}</b>
            <span className="min-w-0 flex-1 truncate font-read text-ink-2">{h.fullText}</span>
            <button className="btn small primary" onClick={() => onPick(h.unitId, true)}>
              {t("refsearch.link")}
            </button>
            <button className="btn small ghost" onClick={() => onPick(h.unitId, false)}>
              {t("refsearch.add")}
            </button>
          </div>
        ))}
        {q.trim() && hits.data?.length === 0 && <p className="text-s text-ink-3">{t("refsearch.none")}</p>}
      </div>
    </Modal>
  );
}
