// The player's clock: the current time and whether it plays, kept OUTSIDE React state. The time changes up to
// 60 times a second; if it were React state, every change would re-render the whole lecture screen (20,000
// words on a long lecture). Instead, components subscribe to the one thing they show (the second for the time
// label, the caption number for the overlay) and re-render only when that changes; the transcript marker is
// moved by hand, without React (see useWordMarker in Transcript.tsx).
import { useCallback, useRef, useSyncExternalStore } from "react";

export type ClockState = { t: number; playing: boolean; duration: number };

export class Clock {
  private state: ClockState = { t: 0, playing: false, duration: 0 };
  private listeners = new Set<() => void>();

  get = (): ClockState => this.state;

  set(patch: Partial<ClockState>): void {
    const next = { ...this.state, ...patch };
    if (next.t === this.state.t && next.playing === this.state.playing && next.duration === this.state.duration) return;
    this.state = next;
    this.listeners.forEach((fn) => fn());
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

/** Re-render when `select(clock state)` changes, and only then. `select` must return a primitive. */
export function useClock<T extends string | number | boolean>(clock: Clock, select: (s: ClockState) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const get = useCallback(() => selectRef.current(clock.get()), [clock]);
  return useSyncExternalStore(clock.subscribe, get, get);
}
