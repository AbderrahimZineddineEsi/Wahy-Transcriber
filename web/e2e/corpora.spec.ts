import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Phase 21 on the real server and engine, offline. The Feature check: add a dhikr in the corpora screen; the next
// detection finds it in the sample lecture. Also: browsing the Quran (surah 18, page 2), a hadith source's status, the
// engine choice saved in settings, and Laya's status (the load button needs the laya extra, so it is only checked to
// be present).

const english = (page: Page) => page.addInitScript(() => window.localStorage.setItem("wahy.lang", "en"));

// words of the sample lecture's opening, said as a dhikr: not among the 18 initial adhkar. Only engine v3 detects adhkar
// (v4 and v5 find none: their golden files pin that), so the check runs on v3.
const NEW_DHIKR = "نحمده ونستعينه ونستغفره";

async function detect(request: APIRequestContext, lectureId: number) {
  const { job } = await (await request.post(`/api/lectures/${lectureId}/detect`)).json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${job.id}`)).json()).status, { timeout: 90_000 }).toBe("done");
  const { findings } = await (await request.get(`/api/lectures/${lectureId}/findings`)).json();
  return findings as { source_type: string; word_start: number; word_end: number }[];
}

test("feature check: a dhikr added in the corpora screen is found by the next detection", async ({ page, request }) => {
  await english(page);
  await request.post("/api/corpora/adhkar/reset"); // the 18 initial rows, whatever earlier runs left
  await request.patch("/api/detection/settings", { data: { engine: "v3", adhkar: true } });
  const lecture = await (await request.post("/api/lectures/sample")).json();

  const before = await detect(request, lecture.id);
  const dhikrBefore = before.filter((f) => f.source_type === "ADHKAR");
  expect(dhikrBefore.map((f) => f.word_start)).toEqual([276]); // the closing «لا إله إلا الله» (an initial row)

  await page.goto("/corpora");
  await expect(page.getByTestId("dhikr-row")).toHaveCount(18);
  await expect(page.getByTestId("corpora-count-adhkar")).toHaveText("18");
  await page.getByTestId("dhikr-new").fill(NEW_DHIKR);
  await page.getByTestId("dhikr-add").click();
  await expect(page.getByTestId("dhikr-row")).toHaveCount(19);
  await expect(page.getByTestId("dhikr-row").first()).toContainText("Added by you");

  const after = await detect(request, lecture.id);
  const found = after.filter((f) => f.source_type === "ADHKAR");
  expect(found.map((f) => [f.word_start, f.word_end])).toEqual([[3, 5], [276, 279]]); // the new one at the opening

  // the switch is the detection setting: off, and no dhikr finding remains (F-046)
  await page.getByTestId("adhkar-detect").click();
  await expect.poll(async () => (await (await request.get("/api/detection/settings")).json()).adhkar).toBe(false);
  expect((await detect(request, lecture.id)).some((f) => f.source_type === "ADHKAR")).toBe(false);
  await request.patch("/api/detection/settings", { data: { adhkar: true } });

  // restore: the initial list is back
  await request.post("/api/corpora/adhkar/reset");
  await request.patch("/api/detection/settings", { data: { engine: "v5" } });
});

test("the Quran, surah 18, page 2: ayat 26 to 50 of al-Kahf (F-076)", async ({ page }) => {
  await english(page);
  await page.goto("/corpora/quran");
  await expect(page.getByTestId("browse-row").first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("browse-group").selectOption("18");
  await expect(page.getByTestId("browse-range")).toContainText("of 110");
  await page.getByTestId("browse-next").click();
  await expect(page.getByTestId("browse-range")).toContainText("26–50 of 110");
  await expect(page.getByTestId("browse-row")).toHaveCount(25);
  await expect(page.getByTestId("browse-row").first()).toContainText(": 26");
  await expect(page.getByTestId("browse-row").last()).toContainText(": 50");
});

test("hadith sources show their status; the totals match the corpus (F-072, F-079)", async ({ page }) => {
  await english(page);
  await page.goto("/corpora/sources");
  await expect(page.getByTestId("source-wahy_default")).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId("corpus-totals")).toContainText("Quran 6,236");
  await expect(page.getByTestId("corpora-count-quran")).toHaveText("6,236");
});

test("settings: the engine choice is remembered and Laya's status shows (F-011, F-097)", async ({ page, request }) => {
  await english(page);
  await page.goto("/settings");
  await page.getByTestId("engine-v5:loose").click();
  await expect(page.getByTestId("engine-v5:loose")).toHaveAttribute("aria-pressed", "true");
  expect((await (await request.get("/api/detection/settings")).json()).engine).toBe("v5:loose");
  await page.reload();
  await expect(page.getByTestId("engine-v5:loose")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("engine-v5").click();
  await expect(page.getByTestId("laya-state")).toBeVisible();
  await expect(page.getByTestId("laya-envelope")).toContainText("v");
  await expect(page.getByTestId("laya-load")).toBeVisible();
});
