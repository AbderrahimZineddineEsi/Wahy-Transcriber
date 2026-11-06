import { useMemo, useState, type Dispatch } from "react";
import { Link } from "react-router-dom";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { useToasts } from "../../shell/toasts";
import type { LectureDetail } from "../lectures/api";
import { isClipped, type ViewFinding } from "../lectures/view/model";
import { useExpand, useSetVerdict, type Verdict } from "../verification/api";
import { useEditFinding, useSaveDhikr, useUndo, useUnits, type FindingEdit } from "./api";
import { bare, candidatesOf, neighbours, stepFinding, type BoardAction, type Neighbour } from "./board";
import { DeleteDialog, ReferenceSearchDialog } from "./dialogs";

type Props = {
  lecture: LectureDetail;
  list: readonly ViewFinding[];
  f: ViewFinding;
  fullMatn: boolean;
  dispatch: Dispatch<BoardAction>;
  onPlay: (a: number, b: number) => void;
};

const KIND_EDIT: Record<ViewFinding["kind"], "ayah" | "hadith" | "dhikr"> = { quran: "ayah", hadith: "hadith", dhikr: "dhikr" };

/** F-057: one quote at a time: walk them in order, see what was said and what the source says, and fix it. Each
 *  button is one edit in the log (so the header's undo takes it back). */
export function QuoteInspector({ lecture, list, f, fullMatn, dispatch, onPlay }: Props) {
  const { t } = useI18n();
  const toasts = useToasts();
  const words = lecture.words;
  const id = f.id!;
  const edit = useEditFinding(lecture.id);
  const undo = useUndo(lecture.id);
  const setVerdict = useSetVerdict(lecture.id);
  const expand = useExpand(lecture.id);
  const saveDhikr = useSaveDhikr();
  const [dialog, setDialog] = useState<null | "delete" | "search">(null);
  const k = list.findIndex((x) => x.id === id);
  const spoken = words.slice(f.start, f.end + 1).map((w) => w.text);

  const run = (change: FindingEdit, message?: string) =>
    edit.mutate(
      { findingId: id, edit: change },
      {
        onSuccess: (done) => {
          if (message) toasts.success(message, { label: t("undo.action"), run: () => undo.mutate() });
          dispatch({ type: "selectFinding", id: done.finding_id ?? id }); // a merge may keep the other finding
        },
      },
    );

  const gold = f.verifier === "human";
  const confidence = f.confidence !== null && f.verifier !== "human" ? `${Math.round(f.confidence * 100)}%` : null;

  return (
    <section className="panel" data-testid="inspector">
      <div className="panel-h">
        <button className="iconbtn" title={t("insp.previous")} aria-label={t("insp.previous")} onClick={() => dispatch({ type: "selectFinding", id: stepFinding(list, id, -1) })}>
          <span className="rtl:hidden">←</span>
          <span className="ltr:hidden">→</span>
        </button>
        <span className="mono text-s text-ink-3" dir="ltr" data-testid="insp-pos">
          {k + 1} / {list.length}
        </span>
        <button className="iconbtn" title={t("insp.next")} aria-label={t("insp.next")} onClick={() => dispatch({ type: "selectFinding", id: stepFinding(list, id, 1) })}>
          <span className="rtl:hidden">→</span>
          <span className="ltr:hidden">←</span>
        </button>
        <span className="flex-1" />
        <span className={`kchip ${f.kind}`}>{t(`kindOne.${f.kind}` as MessageKey)}</span>
        <b data-testid="insp-ref">{f.ref}</b>
      </div>
      <div className="panel-b flex flex-col gap-3">
        <div className="row gap-2">
          <span className={`vchip ${f.verdict}`}>
            {t(`verdict.${f.verdict}` as MessageKey)}
            {gold ? ` ${t("insp.gold")}` : ""}
          </span>
          {f.boundary && <span className="text-xs text-ink-3">{t(`boundary.${f.boundary}` as MessageKey)}</span>}
          <span className="flex-1" />
          {f.verifier && !gold && <span className="mono text-[11px] text-ink-3">{[f.verifier, f.model, confidence].filter(Boolean).join(" · ")}</span>}
        </div>

        <div className="field">
          <span className="label">{t("insp.spoken")}</span>
          <div className="quote" data-testid="insp-spoken">
            {spoken.join(" ")}
          </div>
          <div className="row gap-1">
            {lecture.has_media && (
              <button className="btn small" onClick={() => onPlay(f.start, f.end)}>
                {t("card.play")}
              </button>
            )}
            <Link className="btn small ghost" to={`/lectures/${lecture.id}?finding=${id}`}>
              {t("insp.showInView")}
            </Link>
          </div>
        </div>

        <SourceWords f={f} spoken={spoken} fullMatn={fullMatn} busy={edit.isPending} onPick={(indices, full) => run({ op: "canonical_words", indices, full }, t("insp.wordsApplied"))} />
        <label className="switch">
          <input type="checkbox" checked={f.data.snappedToCanonical === true} onChange={(e) => run({ op: "snap", on: e.target.checked })} />
          {t("insp.snap")}
        </label>

        <Candidates f={f} busy={edit.isPending} run={run} onSearch={() => setDialog("search")} />

        <div className="grid2">
          <div className="field">
            <span className="label">{t("insp.start")}</span>
            <div className="row gap-1">
              <button className="btn small" onClick={() => run({ op: "move_edge", edge: "start", delta: -1 })}>
                {t("insp.wordMinus")}
              </button>
              <button className="btn small" onClick={() => run({ op: "move_edge", edge: "start", delta: 1 })}>
                {t("insp.wordPlus")}
              </button>
            </div>
          </div>
          <div className="field">
            <span className="label">{t("insp.end")}</span>
            <div className="row gap-1">
              <button className="btn small" onClick={() => run({ op: "move_edge", edge: "end", delta: -1 })}>
                {t("insp.wordMinus")}
              </button>
              <button className="btn small" onClick={() => run({ op: "move_edge", edge: "end", delta: 1 })}>
                {t("insp.wordPlus")}
              </button>
            </div>
          </div>
        </div>
        {isClipped(f) && (
          <button
            className="btn small self-start"
            disabled={expand.isPending}
            onClick={() =>
              expand.mutate(id, {
                onSuccess: (r) => {
                  toasts.success(r.changed ? t("card.expanded", { n: r.added.start + r.added.end }) : t("card.expandNothing"));
                },
              })
            }
          >
            {t("card.expand")}
          </button>
        )}

        <Merges list={list} f={f} words={words} run={run} />

        <div className="field">
          <span className="label">{t("card.yourVerdict")}</span>
          <div className="seg" role="group" aria-label={t("card.yourVerdict")}>
            {(["CORRECT", "NOT_SURE", "FALSE"] as Verdict[]).map((v) => {
              const key = v === "CORRECT" ? "ok" : v === "FALSE" ? "bad" : "unsure";
              return (
                <button key={v} aria-pressed={gold && f.verdict === key} onClick={() => setVerdict.mutate({ findingId: id, verdict: v }, { onSuccess: () => toasts.success(t("insp.goldSaved")) })}>
                  {t(`verdict.${key}` as MessageKey)}
                </button>
              );
            })}
          </div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={f.data.referenceWrong === true} onChange={(e) => run({ op: "flag_reference", wrong: e.target.checked })} />
          {t("insp.refWrong")}
        </label>

        <div className="row gap-1">
          <label className="row gap-1 text-s">
            <span className="text-ink-2">{t("insp.kind")}</span>
            <select className="input h-8 w-auto" value={KIND_EDIT[f.kind]} onChange={(e) => run({ op: "set_kind", kind: e.target.value as "ayah" | "hadith" | "dhikr" })}>
              <option value="ayah">{t("kindOne.quran")}</option>
              <option value="hadith">{t("kindOne.hadith")}</option>
              <option value="dhikr">{t("kindOne.dhikr")}</option>
            </select>
          </label>
          <Link className="btn small" to={`/lectures/${lecture.id}/verify?finding=${id}`}>
            {t("insp.verify")}
          </Link>
          <button
            className="btn small ghost"
            disabled={saveDhikr.isPending}
            onClick={() => saveDhikr.mutate({ text: spoken.join(" "), name: f.ref }, { onSuccess: (d) => toasts.success(t("insp.dhikrSaved", { ref: d.ref })) })}
          >
            {t("edit.saveDhikr")}
          </button>
          <span className="flex-1" />
          <button className="btn small danger" onClick={() => setDialog("delete")}>
            {t("insp.delete")}
          </button>
        </div>
      </div>
      {dialog === "delete" && (
        <DeleteDialog
          lectureId={lecture.id}
          findingId={id}
          onClose={() => setDialog(null)}
          onDeleted={() => dispatch({ type: "selectFinding", id: list[k + 1]?.id ?? list[k - 1]?.id ?? null })}
        />
      )}
      {dialog === "search" && (
        <ReferenceSearchDialog
          initialKind={f.kind === "quran" ? "QURAN" : f.kind === "dhikr" ? "ADHKAR" : "HADITH"}
          initialQuery={spoken.slice(0, 4).join(" ")}
          onClose={() => setDialog(null)}
          onPick={(unitId, link) => {
            run(link ? { op: "link_reference", unit_id: unitId } : { op: "add_candidate", unit_id: unitId });
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}

/** F-062 and F-050: the reference's words as chips; picked ones replace the quote's source text. With "full matn"
 *  a hadith shows its whole text, the chain dimmed. A chip whose word was not said is marked. */
function SourceWords({ f, spoken, fullMatn, busy, onPick }: { f: ViewFinding; spoken: string[]; fullMatn: boolean; busy: boolean; onPick: (indices: number[], full: boolean) => void }) {
  const { t } = useI18n();
  const unitId = String(f.data.unitId ?? "");
  const units = useUnits([unitId]);
  const unit = units.data?.[unitId];
  const full = fullMatn && unit?.full ? unit.full : null;
  const pool = full ? full.words : (unit?.words ?? f.canonicalText.split(/\s+/).filter(Boolean));
  const said = useMemo(() => new Set(spoken.map(bare)), [spoken]);
  const [picked, setPicked] = useState<number[]>([]);
  if (!pool.length) return null;
  const inMatn = (k: number) => !full || (k >= full.matnStart && k < full.matnEnd);
  const toggle = (k: number) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k].sort((a, b) => a - b)));
  return (
    <div className="field">
      <span className="label">{t("insp.source", { n: pool.length })}</span>
      <div className="tokens" data-testid="insp-tokens">
        {pool.map((w, k) => (
          <button
            key={k}
            type="button"
            aria-pressed={picked.includes(k)}
            className={!inMatn(k) ? "sanad" : !said.has(bare(w)) ? "diff" : undefined}
            onClick={() => toggle(k)}
          >
            {w}
          </button>
        ))}
      </div>
      {picked.length > 0 && (
        <div className="row gap-1">
          <button
            className="btn small primary"
            disabled={busy}
            onClick={() => {
              onPick(picked, Boolean(full));
              setPicked([]);
            }}
          >
            {t("insp.applyWords", { n: picked.length })}
          </button>
          <button className="btn small ghost" onClick={() => setPicked([])}>
            {t("edit.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}

/** F-061: the matching references; the chosen one is the finding's reference. */
function Candidates({ f, busy, run, onSearch }: { f: ViewFinding; busy: boolean; run: (e: FindingEdit, message?: string) => void; onSearch: () => void }) {
  const { t } = useI18n();
  const list = candidatesOf(f);
  const own = String(f.data.unitId ?? "");
  const [manual, setManual] = useState("");
  return (
    <div className="field">
      <span className="label">{t("insp.candidates", { n: list.length })}</span>
      <div className="cands" role="radiogroup" aria-label={t("insp.candidates", { n: list.length })}>
        {list.map((c) => (
          <label key={c.unitId} className="cand">
            <input
              type="radio"
              name="candidate"
              checked={c.unitId === own}
              disabled={busy}
              onChange={() => run(c.unitId.startsWith("MANUAL:") ? { op: "link_reference", ref: c.ref } : { op: "link_reference", unit_id: c.unitId }, t("insp.linked", { ref: c.ref }))}
            />
            <b className="text-s">{c.ref}</b>
            {c.unitId === own ? (
              <span className="text-xs text-ink-3">{t("insp.approved")}</span>
            ) : (
              <button className="iconbtn h-6" title={t("insp.removeCandidate")} aria-label={t("insp.removeCandidate")} onClick={(e) => (e.preventDefault(), run({ op: "remove_candidate", unit_id: c.unitId }))}>
                ✕
              </button>
            )}
          </label>
        ))}
      </div>
      <div className="row gap-1">
        <button className="btn small ghost" onClick={onSearch}>
          {t("insp.searchRef")}
        </button>
        <form
          className="row flex-1 gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) run({ op: "add_candidate", ref: manual.trim() });
            setManual("");
          }}
        >
          <input className="input h-8 min-w-0 flex-1" value={manual} placeholder={t("insp.manualRef")} aria-label={t("insp.manualRef")} onChange={(e) => setManual(e.target.value)} />
          <button type="submit" className="btn small" disabled={!manual.trim()}>
            {t("insp.add")}
          </button>
        </form>
      </div>
    </div>
  );
}

/** F-063: merge with a close neighbour (a quote the engine split on a misheard word or a commentary). */
function Merges({ list, f, words, run }: { list: readonly ViewFinding[]; f: ViewFinding; words: LectureDetail["words"]; run: (e: FindingEdit, message?: string) => void }) {
  const { t } = useI18n();
  const options = neighbours(list, f, words);
  if (!options.length) return null;
  return (
    <div className="field">
      <span className="label">{t("insp.merge")}</span>
      {options.map((nb) => (
        <MergeRow key={nb.direction} nb={nb} run={run} t={t} />
      ))}
    </div>
  );
}

function MergeRow({ nb, run, t }: { nb: Neighbour; run: (e: FindingEdit, message?: string) => void; t: ReturnType<typeof useI18n>["t"] }) {
  const [gap, setGap] = useState<"PART_OF_QUOTE" | "COMMENTARY">(nb.suggested?.gapType ?? "PART_OF_QUOTE");
  const suggested = nb.suggested && !nb.dismissed;
  return (
    <div className={`flex flex-col gap-1 rounded-m border p-2 text-s ${suggested ? "border-accent bg-accent-soft" : "border-line"}`} data-testid={`merge-${nb.direction}`}>
      <span>
        {t(nb.direction === "previous" ? "insp.mergePrevious" : "insp.mergeNext", { ref: nb.f.ref, n: nb.gapWords })}
        {suggested && <b className="ms-1 text-accent">{t("insp.suggested", { p: Math.round(nb.suggested!.confidence * 100) })}</b>}
      </span>
      {nb.gapWords > 0 && <span className="font-read text-ink-2">«{nb.gapText}»</span>}
      <div className="row gap-1">
        {nb.gapWords > 0 && (
          <select className="input h-8 w-auto" value={gap} aria-label={t("insp.gapIs")} onChange={(e) => setGap(e.target.value as typeof gap)}>
            <option value="PART_OF_QUOTE">{t("insp.gapPart")}</option>
            <option value="COMMENTARY">{t("insp.gapCommentary")}</option>
          </select>
        )}
        <button className="btn small" onClick={() => run({ op: "merge", direction: nb.direction, gap_type: gap }, t("insp.merged"))}>
          {t("insp.mergeDo")}
        </button>
        {suggested && (
          <button className="btn small ghost" onClick={() => run({ op: "dismiss_merge", direction: nb.direction })}>
            {t("insp.dismiss")}
          </button>
        )}
      </div>
    </div>
  );
}
