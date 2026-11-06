import { useMatch } from "react-router-dom";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { useToasts } from "../../shell/toasts";
import { useEditLog, useUndo, type EditOp } from "./api";

/** The edit kinds the app names in its own words; anything else shows the server's English label. */
const KNOWN = new Set([
  "edit_word", "replace_words", "replace_text", "add_quote", "move_edge", "set_kind", "snap", "canonical_words", "link_reference",
  "add_candidate", "remove_candidate", "merge", "dismiss_merge", "flag_reference", "delete", "expand", "caption_split",
  "caption_merge", "caption_time",
]);

export function opName(op: EditOp, t: (key: MessageKey) => string): string {
  return KNOWN.has(op.kind) ? t(`op.${op.kind}` as MessageKey) : op.label;
}

/** F-003: the header's undo button, on a lecture's screens. It names the edit it would take back (the newest one
 *  in the lecture's edit log), so nothing is undone by surprise; the log lives on the server, so this works after
 *  a reload too. */
export function UndoButton() {
  const id = Number(useMatch("/lectures/:id/*")?.params.id);
  const lectureId = Number.isInteger(id) && id > 0 ? id : null;
  if (lectureId === null) return null;
  return <Undo lectureId={lectureId} />;
}

function Undo({ lectureId }: { lectureId: number }) {
  const { t } = useI18n();
  const toasts = useToasts();
  const log = useEditLog(lectureId);
  const undo = useUndo(lectureId);
  const last = log.data?.find((op) => !op.undone) ?? null;
  const name = last ? opName(last, t) : "";
  return (
    <button
      className="iconbtn gap-1.5 px-2"
      data-testid="undo"
      disabled={!last || undo.isPending}
      title={last ? t("undo.named", { label: name }) : t("undo.nothing")}
      aria-label={last ? t("undo.named", { label: name }) : t("undo.nothing")}
      onClick={() => undo.mutate(undefined, { onSuccess: () => toasts.success(t("undo.done", { label: name })) })}
    >
      <svg className="size-4 rtl:-scale-x-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 14l-4-4 4-4" />
        <path d="M5 10h9a5 5 0 0 1 0 10h-3" />
      </svg>
      <span className="max-w-56 truncate text-s max-[720px]:hidden">{last ? t("undo.named", { label: name }) : t("undo.nothing")}</span>
    </button>
  );
}
