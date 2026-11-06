import { expect, test } from "@playwright/test";

// Milestone A. Runs only on request (it downloads a real video and uses the real Groq key):
//   WAHY_E2E_LIVE=1 npx playwright test e2e/live-youtube.spec.ts
// A Mohammed Meziane khutba of about 16 minutes (see docs/rewrite/ROADMAP.md, phase 11).
const LINK = process.env.WAHY_E2E_LINK ?? "https://www.youtube.com/watch?v=Y9n3OjY7Qtg";

test("a pasted YouTube link ends with a transcript and findings", async ({ page }) => {
  await page.goto("/lectures");
  await page.getByRole("button", { name: /رابط يوتيوب/ }).click();
  await page.getByLabel("رابط يوتيوب", { exact: true }).fill(LINK);
  await page.getByRole("button", { name: "بدء التفريغ" }).click();

  const transcribe = page.getByTestId("job-transcribe");
  await expect(transcribe).toBeVisible({ timeout: 30_000 });
  await expect(transcribe).toHaveAttribute("data-status", "done", { timeout: 540_000 });
  await expect(transcribe).toContainText(/\d+ كلمة/);

  // detection starts by itself when the transcription ends
  const detect = page.getByTestId("job-detect");
  await expect(detect).toHaveAttribute("data-status", "done", { timeout: 120_000 });
  const count = Number(((await detect.textContent()) ?? "").match(/(\d+) اقتباس/)?.[1]);
  console.log(`findings: ${count}`);
  expect(count).toBeGreaterThan(0);

  await detect.getByRole("link", { name: "فتح المحاضرة" }).click();
  const words = ((await page.getByTestId("transcript").textContent()) ?? "").trim().split(/\s+/).length;
  console.log(`words: ${words}`);
  expect(words).toBeGreaterThan(500);
  await expect(page.getByTestId("findings").locator("li").first()).toBeVisible();
});
