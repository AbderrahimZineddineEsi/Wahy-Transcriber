import { expect, test, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Phase 19 on the real server and engine, offline: the sentence preview and its settings, the estimate, and — with a
// saved run made by the server's own test double (scripts/seed_tafrigh_run.py: a fake model behind the real
// Tafrigh service, so no key and no cost) — the lesson, the review of a sentence, "save as new", the comparison and
// the export. The same flow with a real model is in live-tafrigh.spec.ts.

const dataDir = join(tmpdir(), "wahy-e2e");
const repo = resolve(import.meta.dirname, "..", "..");

async function detectedSample(request: APIRequestContext): Promise<number> {
  const lecture = await (await request.post("/api/lectures/sample")).json();
  const { job } = await (await request.post(`/api/lectures/${lecture.id}/detect`)).json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${job.id}`)).json()).status, { timeout: 60_000 }).toBe("done");
  return lecture.id;
}

function seedRun(lectureId: number, sentences = 8): string {
  const out = execFileSync("uv", ["run", "--quiet", "python", "../scripts/seed_tafrigh_run.py", dataDir, String(lectureId), String(sentences)], {
    cwd: join(repo, "server"),
    encoding: "utf-8",
    env: { ...process.env, VIRTUAL_ENV: "" },
  });
  return out.trim().split("\n").pop()!;
}

const english = (page: import("@playwright/test").Page) => page.addInitScript(() => window.localStorage.setItem("wahy.lang", "en"));

test("the sentences and their statistics show before any model call; the cutting settings and the mode change them (F-106, F-107, F-113, F-114)", async ({ page, request }) => {
  await english(page);
  const id = await detectedSample(request);
  await page.goto(`/lectures/${id}/tafrigh`);

  const sentences = page.getByTestId("tfg-sentence");
  await expect(sentences.first()).toBeVisible();
  const count = await sentences.count();
  expect(count).toBeGreaterThan(5);
  await expect(page.getByTestId("tfg-stat-sentences")).toHaveText(String(count));
  // no model has been asked for anything
  expect((await (await request.get(`/api/tafrigh/runs?lecture_id=${id}`)).json())).toHaveLength(0);

  // max words 10 (F-107). A verse is never cut, so with the quotes as found a long verse stays whole and the screen
  // counts it as "over the limit"; reading the raw text, no sentence is longer than 10 words.
  await page.getByTestId("tfg-max").fill("10");
  await expect(page.getByText(/over the limit/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Raw text" }).click();
  await expect.poll(async () => Number(await page.getByTestId("tfg-stat-longest").textContent()), { timeout: 10_000 }).toBeLessThanOrEqual(10);
  await page.getByRole("button", { name: "Quotes as found" }).click();

  // the estimate: a window of 15 needs fewer requests than sentence by sentence (F-114)
  await expect(page.getByTestId("est-requests")).not.toHaveText("—");
  const windowed = Number(await page.getByTestId("est-requests").textContent());
  await page.getByRole("button", { name: "Sentence by sentence" }).click();
  await expect.poll(async () => Number(await page.getByTestId("est-requests").textContent())).toBeGreaterThan(windowed);

  // find the quotes again with another engine first (F-109): the sentences are read again afterwards
  await page.getByLabel("Detection engine").selectOption("v4");
  await page.getByTestId("tfg-redetect-start").click();
  await page.getByTestId("tfg-redetect-start").click();
  await expect(page.getByTestId("tfg-redetect-status")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(page.getByTestId("tfg-sentence").first()).toBeVisible();
  await expect(page.getByTestId("tfg-start")).toBeEnabled();

  // the first 10 as a cheap test slice (F-113)
  await page.getByTestId("tfg-first-10").click();
  await expect(page.getByTestId("tfg-from")).toHaveValue("1");
  await expect(page.getByTestId("tfg-to")).toHaveValue(/^\d+$/);
  await expect(page.getByTestId("est-sentences")).toHaveText(/^(?:[1-9]|10)$/);
});

test("a saved run: the lesson and its outline, review a sentence, save as new and relabel in the copy, compare, export (F-117 to F-122)", async ({ page, request }) => {
  await english(page);
  const id = await detectedSample(request);
  const runId = seedRun(id, 8);

  await page.goto(`/lectures/${id}/tafrigh`);
  await expect(page.getByTestId("tfg-lesson")).toBeVisible();
  await expect(page.getByTestId("tfg-seg")).toHaveCount(8);
  await expect(page.getByTestId("tfg-summary")).toContainText("Run summary");
  await expect(page.getByTestId("tfg-breakdown")).toContainText("jev");

  // every sentence of the fake model is a coin-flip, so all of them wait for review
  await page.getByTestId("tfg-view-review").click();
  await expect(page.getByTestId("tfg-review-count")).toHaveText("8 sentences need review");
  await page.getByTestId("tfg-review-item").first().locator("button.sent").click();
  const card = page.getByTestId("tfg-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("card-confidence")).toHaveText("57%");
  await card.getByTestId("card-relabel").selectOption("heading:1");
  // saved on the server at once
  await expect.poll(async () => {
    const detail = await (await request.get(`/api/tafrigh/runs/${runId}`)).json();
    return detail.structured_json.segments.filter((s: { tag: string }) => s.tag === "heading").length;
  }).toBe(1);
  await expect(page.getByTestId("tfg-review-count")).toHaveText("7 sentences need review");
  // the relabelled sentence is a heading in the outline, and a click on it scrolls to it
  await page.getByTestId("tfg-view-lesson").click();
  await expect(page.getByTestId("tfg-outline").getByRole("button")).toHaveCount(1);
  await page.getByTestId("tfg-outline").getByRole("button").click();
  await expect(page.getByTestId("tfg-card")).toBeVisible();

  // save as new: the first run goes on as it was while the copy is changed
  await page.getByTestId("tfg-clone").click();
  await page.getByTestId("tfg-run-name").fill("نسخة للمراجعة");
  await page.getByTestId("tfg-run-name").press("Enter");
  await expect(page.getByTestId("tfg-run-picker")).not.toHaveValue(runId);
  const copyId = await page.getByTestId("tfg-run-picker").inputValue();
  await page.getByTestId("tfg-view-review").click();
  await page.getByTestId("tfg-review-item").first().locator("button.sent").click();
  await page.getByTestId("tfg-card").getByTestId("card-relabel").selectOption("comment");
  await expect.poll(async () => {
    const copy = await (await request.get(`/api/tafrigh/runs/${copyId}`)).json();
    return copy.structured_json.segments.filter((s: { tag: string }) => s.tag === "comment").length;
  }).toBe(1);
  const original = await (await request.get(`/api/tafrigh/runs/${runId}`)).json();
  expect(original.structured_json.segments.filter((s: { tag: string }) => s.tag === "comment")).toHaveLength(0);

  // compare the two: the sentence the copy labels differently is listed
  await page.getByTestId("tfg-view-compare").click();
  await expect(page.getByTestId("tfg-compare-run")).toHaveCount(2);
  await expect(page.getByTestId("tfg-disagreement").first()).toContainText("tag:");

  // export: the browser downloads the server's file
  await page.getByTestId("tfg-view-lesson").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("tfg-export-md").click();
  const file = await download;
  const text = readFileSync((await file.path())!, "utf-8");
  const served = await (await request.get(`/api/tafrigh/runs/${copyId}/export?format=md`)).json();
  expect(text).toBe(served.content);
  expect(file.suggestedFilename()).toBe(served.filename);
});
