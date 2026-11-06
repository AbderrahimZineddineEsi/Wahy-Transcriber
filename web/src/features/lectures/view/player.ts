import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "./clock";

export type PlayerControls = {
  clock: Clock;
  /** give this to the <video> element */
  mediaRef: (el: HTMLVideoElement | null) => void;
  seek: (t: number) => void;
  step: (seconds: number) => void;
  toggle: () => void;
  /** play from `from` and pause at `to` (a quote's card, F-033) */
  playRange: (from: number, to: number) => void;
};

/** The media element drives the clock. While it plays, a requestAnimationFrame loop reads `currentTime` once
 *  per screen frame: the element's own `timeupdate` event fires only about 4 times a second, too slow for a
 *  marker that moves word by word. Without media, `seek` still moves the clock (the marker and the caption
 *  preview follow a click), but nothing plays (F-040 was removed). */
export function usePlayer(fallbackDuration: number): PlayerControls {
  const clock = useMemo(() => new Clock(), []);
  const [media, setMedia] = useState<HTMLVideoElement | null>(null);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    clock.set({ duration: fallbackDuration });
  }, [clock, fallbackDuration]);

  useEffect(() => {
    if (!media) return;
    let frame = 0;
    const read = () => {
      const t = media.currentTime;
      if (stopAt.current !== null && t >= stopAt.current) {
        stopAt.current = null;
        media.pause();
      }
      clock.set({ t });
    };
    const loop = () => {
      read();
      frame = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      clock.set({ playing: true });
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(loop);
    };
    const onPause = () => {
      cancelAnimationFrame(frame);
      read();
      clock.set({ playing: false });
    };
    const onMeta = () => {
      if (Number.isFinite(media.duration) && media.duration > 0) clock.set({ duration: media.duration });
    };
    media.addEventListener("play", onPlay);
    media.addEventListener("pause", onPause);
    media.addEventListener("ended", onPause);
    media.addEventListener("seeked", read);
    media.addEventListener("loadedmetadata", onMeta);
    onMeta();
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("play", onPlay);
      media.removeEventListener("pause", onPause);
      media.removeEventListener("ended", onPause);
      media.removeEventListener("seeked", read);
      media.removeEventListener("loadedmetadata", onMeta);
    };
  }, [media, clock]);

  const seek = useCallback(
    (t: number) => {
      const max = clock.get().duration || Infinity;
      const to = Math.min(Math.max(0, t), max);
      stopAt.current = null;
      if (media) media.currentTime = to;
      clock.set({ t: to }); // at once, before the element reports `seeked`
    },
    [media, clock],
  );

  const toggle = useCallback(() => {
    if (!media) return;
    if (media.paused) void media.play().catch(() => clock.set({ playing: false }));
    else media.pause();
  }, [media, clock]);

  const playRange = useCallback(
    (from: number, to: number) => {
      seek(from);
      if (!media) return;
      stopAt.current = to;
      void media.play().catch(() => clock.set({ playing: false }));
    },
    [media, seek, clock],
  );

  const step = useCallback((seconds: number) => seek(clock.get().t + seconds), [seek, clock]);

  // one object for as long as nothing in it changes, so callbacks built on it (and the transcript) stay put
  return useMemo(() => ({ clock, mediaRef: setMedia, seek, step, toggle, playRange }), [clock, seek, step, toggle, playRange]);
}
