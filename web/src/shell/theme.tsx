import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readStored, writeStored } from "./storage";

export type ThemeChoice = "light" | "dark" | "system";
const STORAGE_KEY = "wahy.theme";

type Theme = { choice: ThemeChoice; setChoice: (choice: ThemeChoice) => void; toggle: () => void };
const Context = createContext<Theme | null>(null);

function initialChoice(): ThemeChoice {
  const stored = readStored(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/** Is the page dark right now? "system" follows the operating system. */
export function isDark(choice: ThemeChoice): boolean {
  if (choice !== "system") return choice === "dark";
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(initialChoice);

  // tokens.css reads <html data-theme>: no attribute means "follow the system".
  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    writeStored(STORAGE_KEY, next === "system" ? null : next);
    setChoiceState(next);
  }, []);
  const toggle = useCallback(() => setChoice(isDark(choice) ? "light" : "dark"), [choice, setChoice]);
  const value = useMemo(() => ({ choice, setChoice, toggle }), [choice, setChoice, toggle]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTheme(): Theme {
  const value = useContext(Context);
  if (!value) throw new Error("useTheme needs <ThemeProvider>");
  return value;
}
