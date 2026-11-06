import { useEffect, useState, type InputHTMLAttributes } from "react";
import { useI18n } from "./i18n";

type CommitProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur"> & {
  value: string;
  onCommit: (value: string) => void;
  multiline?: false;
};

/** A text field that saves when the user leaves it (or presses Enter), not on every key. It follows the saved
 *  value when that changes from outside. */
export function CommitInput({ value, onCommit, ...rest }: CommitProps) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text !== value && onCommit(text);
  return (
    <input
      className="input"
      {...rest}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function CommitTextarea({ value, onCommit, rows = 4, ...rest }: { value: string; onCommit: (value: string) => void; rows?: number; "aria-label"?: string; placeholder?: string; dir?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <textarea className="input" rows={rows} {...rest} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onCommit(text)} />;
}

/** Copies `text` to the clipboard and says so for two seconds. */
export function CopyButton({ text, label }: { text: string | (() => string); label?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(id);
  }, [done]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      setDone(true);
    } catch {
      /* the text is selectable on the page */
    }
  }
  return (
    <button type="button" className="btn small ghost" onClick={copy}>
      {done ? t("copy.done") : (label ?? t("copy.copy"))}
    </button>
  );
}
