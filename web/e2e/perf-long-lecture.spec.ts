import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// "It must stay smooth on a 2-hour lecture" (roadmap phase 12). Run on request: WAHY_E2E_PERF=1 npx playwright
// test e2e/perf-long-lecture.spec.ts. The lecture is the sample text 72 times (about 20,000 words over 2 hours,
// with real findings), played with a silent 2-hour video. It prints what it measured and fails if playback
// drops frames badly or a click takes long.

const SECONDS = 2 * 3600;

function silentLongVideo(): Buffer {
  const file = join(tmpdir(), "wahy-e2e-silent-2h.webm");
  if (!existsSync(file)) {
    execFileSync("ffmpeg", [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=0x0c1110:s=64x36:r=1:d=${SECONDS}`,
      "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono",
      "-t", String(SECONDS), "-c:v", "libvpx", "-b:v", "5k", "-c:a", "libopus", "-b:a", "6k", file,
    ]);
  }
  return readFileSync(file);
}

/** An .srt whose cues spread the words evenly over two hours. */
function longSrt(): { srt: string; words: number } {
  const sample = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../engine/golden/inputs/sample.json"), "utf8")).text as string;
  const all = Array.from({ length: 72 }, () => sample.split(/\s+/).filter(Boolean)).flat();
  const per = SECONDS / all.length;
  const stamp = (s: number) => new Date(s * 1000).toISOString().slice(11, 23).replace(".", ",");
  const cues: string[] = [];
  for (let i = 0, n = 1; i < all.length; i += 10, n++) {
    const chunk = all.slice(i, i + 10);
    cues.push(`${n}\n${stamp(i * per)} --> ${stamp((i + chunk.length) * per)}\n${chunk.join(" ")}\n`);
  }
  return { srt: cues.join("\n"), words: all.length };
}

test("a 2-hour lecture opens fast and plays without dropped frames", async ({ page, request }) => {
  const { srt, words } = longSrt();
  const lecture = await (await request.post("/api/lectures", { data: { text: srt, title: "two hours", filename: "long.srt" } })).json();
  expect(lecture.word_count).toBe(words);
  const { job } = await (await request.post(`/api/lectures/${lecture.id}/detect`)).json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${job.id}`)).json()).status, { timeout: 300_000, intervals: [2000] }).toBe("done");
  const put = await request.put(`/api/lectures/${lecture.id}/media`, { multipart: { file: { name: "long.webm", mimeType: "video/webm", buffer: silentLongVideo() } } });
  expect(put.ok()).toBe(true);
  const findings = (await (await request.get(`/api/lectures/${lecture.id}/findings`)).json()).count;

  const t0 = Date.now();
  await page.goto(`/lectures/${lecture.id}`);
  const transcript = page.getByTestId("transcript");
  await expect(transcript.locator(`[data-i="${words - 1}"]`)).toHaveCount(1, { timeout: 30_000 });
  const openMs = Date.now() - t0;

  // play for 5 seconds; count frames and long tasks
  await page.evaluate(() => {
    const w = window as unknown as { perf: { frames: number; long: number[] } };
    w.perf = { frames: 0, long: [] };
    new PerformanceObserver((list) => list.getEntries().forEach((e) => w.perf.long.push(e.duration))).observe({ type: "longtask" });
  });
  // click a word near the end: time from the click to the next painted frame, measured in the page (a
  // Playwright click adds its own waiting and scrolling, which a person's click does not have)
  const near = transcript.locator(`[data-i="${Math.floor(words * 0.9)}"]`).first();
  await near.scrollIntoViewIfNeeded();
  const clickMs = await near.evaluate(
    (el) =>
      new Promise<number>((done) => {
        const t = performance.now();
        (el as HTMLElement).click();
        requestAnimationFrame(() => setTimeout(() => done(performance.now() - t)));
      }),
  );
  await expect(near).toHaveClass(/\bnow\b/);
  await page.getByTestId("play").click();
  const play = await page.evaluate(
    () =>
      new Promise<{ frames: number; long: number[]; moved: number }>((done) => {
        const w = window as unknown as { perf: { frames: number; long: number[] } };
        const first = Number(document.querySelector(".w.now")?.getAttribute("data-i"));
        const start = performance.now();
        const tick = () => {
          w.perf.frames++;
          if (performance.now() - start < 5000) requestAnimationFrame(tick);
          else done({ ...w.perf, moved: Number(document.querySelector(".w.now")?.getAttribute("data-i")) - first });
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.getByTestId("play").click();

  // a filter change re-renders the whole transcript once
  const f0 = Date.now();
  await page.getByRole("button", { name: "أحاديث" }).click();
  await expect(transcript.locator('.f[data-kind="quran"]')).toHaveCount(0);
  const filterMs = Date.now() - f0;

  const fps = play.frames / 5;
  const worst = Math.max(0, ...play.long);
  console.log(JSON.stringify({ words, findings, openMs, clickMs, filterMs, fps, longTasksWhilePlaying: play.long.length, worstLongTaskMs: worst, wordsMovedIn5s: play.moved }));
  expect(play.moved).toBeGreaterThan(5);
  expect(fps).toBeGreaterThan(40);
  expect(worst).toBeLessThan(100);
  expect(clickMs).toBeLessThan(150);
});
