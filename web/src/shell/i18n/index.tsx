import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ar, type MessageKey } from "./ar";
import { en } from "./en";
import { readStored, writeStored } from "../storage";

export type Lang = "ar" | "en";
export type { MessageKey };

const messages: Record<Lang, Record<MessageKey, string>> = { ar, en };
const STORAGE_KEY = "wahy.lang";

/** Look a key up and fill the `{name}` slots. Pure, so it is easy to test. */
export function translate(lang: Lang, key: MessageKey, values?: Record<string, string | number>): string {
  const text = messages[lang][key] ?? messages.ar[key] ?? key;
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

type I18n = {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  setLang: (lang: Lang) => void;
};

const Context = createContext<I18n | null>(null);

function initialLang(): Lang {
  return readStored(STORAGE_KEY) === "en" ? "en" : "ar"; // Arabic is the default
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const dir = lang === "ar" ? "rtl" : "ltr";

  // The page itself is rtl or ltr: logical utilities (ms-*, text-start…) then mirror by themselves.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    writeStored(STORAGE_KEY, next);
    setLangState(next);
  }, []);
  const t = useCallback<I18n["t"]>((key, values) => translate(lang, key, values), [lang]);
  const value = useMemo(() => ({ lang, dir, t, setLang }) as I18n, [lang, dir, t, setLang]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error("useI18n needs <I18nProvider>");
  return value;
}
