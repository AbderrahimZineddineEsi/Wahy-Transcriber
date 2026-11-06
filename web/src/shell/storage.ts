import { useState } from "react";

// localStorage can be missing or throw (private windows, blocked site data): the app must work without it.
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* not remembered; the choice still applies for this visit */
  }
}

/** A small choice remembered in this browser (a layout, a switch). Falls back to `initial` when nothing valid
 *  is stored; `valid` guards against an old or hand-edited value. */
export function useStoredState<T extends string>(key: string, initial: T, valid: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readStored(key) as T | null;
    return stored !== null && valid.includes(stored) ? stored : initial;
  });
  return [
    value,
    (next: T) => {
      setValue(next);
      writeStored(key, next);
    },
  ];
}
