import { expect, test, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Milestone B (roadmap phase 12): the sample lecture with a media file. The sample has no recording, so the test
// makes a silent 140-second video with ffmpeg (VP8 + Opus in WebM, which Playwright's Chromium plays) and
// attaches it. The words' times come from the sample itself, so a word at 87 s must take the video to 87 s.

type Word = { idx: number; text: string; start: number; end: number };

function silentVideo(): Buffer {
  const file = join(tmpdir(), "wahy-e2e-silent-140s.webm");
  if (!existsSync(file)) {
    execFileSync("ffmpeg", [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=0x0c1110:s=160x90:r=5:d=140",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
      "-t", "140", "-c:v", "libvpx", "-b:v", "40k", "-c:a", "libopus", "-b:a", "16k", file,
    ]);
  }
  return readFileSync(file);
}

async function sampleWithMedia(request: APIRequestContext): Promise<{ id: number; words: Word[] }> {
  const lecture = await (await request.post("/api/lectures/sample")).json();
  const { job } = await (await request.post(`/api/lectures/${lecture.id}/detect`)).json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${job.id}`)).json()).status, { timeout: 60_000 }).toBe("done");
  const put = await request.put(`/api/lectures/${lecture.id}/media`, {
    multipart: { file: { name: "sample.webm", mimeType: "video/webm", buffer: silentVideo() } },
  });
  expect(put.ok()).toBe(true);
  return { id: lecture.id, words: lecture.words };
}

const currentTime = (page: import("@playwright/test").Page) =>
  page.getByTestId("media").evaluate((v: HTMLVideoElement) => v.currentTime);

test("clicking a word mid-lecture seeks the video there, and the marker follows playback", async ({ page, request }) => {
  const { id, words } = await sampleWithMedia(request);
  await page.goto(`/lectures/${id}`);
  const transcript = page.getByTestId("transcript");
  await expect(transcript.locator(".ref").first()).toBeVisible();
  await expect.poll(() => page.getByTestId("media").evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);

  // a word in the middle of the lecture: the first word of آية الكرسي (87.05 s in the sample)
  const target = words.find((w) => w.start >= 87)!;
  const word = transcript.locator(`[data-i="${target.idx}"]`).first();
  await word.click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(target.start, 1);
  await expect(word).toHaveClass(/\bnow\b/);
  await expect(page.getByTestId("time")).toHaveText("1:27 / 2:20");
  await expect(page.getByTestId("caption")).toHaveText(/^﴿\S.* …﴾$/); // a long verse: its first caption, continued later
  await expect(page.getByTestId("caption")).not.toHaveText(/البقرة/);       // the reference goes on its last one
  await expect(page.getByTestId("nowcard")).toContainText("البقرة: 255");

  // play: time moves on and the marker moves to later words
  await page.getByTestId("play").click();
  await expect.poll(() => currentTime(page), { timeout: 10_000 }).toBeGreaterThan(target.start + 1.5);
  const lit = Number(await transcript.locator(".w.now").first().getAttribute("data-i"));
  expect(lit).toBeGreaterThan(target.idx);
  await page.getByTestId("play").click(); // pause
  const pausedAt = await currentTime(page);
  const expected = words.filter((w) => w.start <= pausedAt).at(-1)!;
  await expect(transcript.locator(".w.now").first()).toHaveAttribute("data-i", String(expected.idx));

  // back 5 seconds, then click an early word: both seek
  await page.getByRole("button", { name: "رجوع 5 ثوان" }).click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(Math.max(0, pausedAt - 5), 1);
  await transcript.locator('[data-i="3"]').first().click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(words[3].start, 1);
});

test("a quote's card plays exactly its words", async ({ page, request }) => {
  const { id, words } = await sampleWithMedia(request);
  await page.goto(`/lectures/${id}`);
  const ref = page.getByTestId("transcript").locator(".f.quran .ref").nth(1); // الأحزاب: 70
  await ref.click();
  const card = page.getByTestId("finding-card");
  await expect(card).toBeVisible();
  const f = page.getByTestId("transcript").locator(".f.quran").nth(1);
  const first = Number(await f.locator("[data-i]").first().getAttribute("data-i"));
  const last = Number(await f.locator("[data-i]").last().getAttribute("data-i"));
  await card.getByRole("button", { name: "تشغيل الاقتباس" }).click();
  await expect.poll(() => page.getByTestId("media").evaluate((v: HTMLVideoElement) => v.paused), { timeout: 15_000 }).toBe(true);
  const stoppedAt = await currentTime(page);
  expect(stoppedAt).toBeGreaterThanOrEqual(words[last].end - 0.05);
  expect(stoppedAt).toBeLessThan(words[last].end + 0.5);
  expect(words[first].start).toBeLessThan(stoppedAt);
});
