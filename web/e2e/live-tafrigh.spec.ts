import { expect, test } from "@playwright/test";

// Phase 19's feature check with a real model: from the new app, run Tafrigh on the sample lecture's test slice
// (Gemini's free tier, called directly) and review one sentence. Runs only on request, with the real keys:
//   WAHY_E2E_LIVE=1 npx playwright test e2e/live-tafrigh.spec.ts

test("a Tafrigh run from the new app on the sample, and one sentence reviewed", async ({ page, request }) => {
  await page.addInitScript(() => window.localStorage.setItem("wahy.lang", "en"));
  const lecture = await (await request.post("/api/lectures/sample")).json();
  const { job } = await (await request.post(`/api/lectures/${lecture.id}/detect`)).json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${job.id}`)).json()).status, { timeout: 60_000 }).toBe("done");

  await page.goto(`/lectures/${lecture.id}/tafrigh`);
  await expect(page.getByTestId("tfg-sentence").first()).toBeVisible();
  await page.getByLabel("Gemini route").selectOption("direct"); // OpenRouter's key is not used
  await page.getByTestId("tfg-first-10").click();
  await expect(page.getByTestId("est-sentences")).toHaveText(/^\d+$/);
  await page.getByTestId("tfg-start").click();

  await expect(page.getByTestId("tafrigh-progress")).toHaveAttribute("data-status", "done", { timeout: 300_000 });
  await expect(page.getByTestId("tfg-lesson")).toBeVisible();
  const segments = page.getByTestId("tfg-seg");
  await expect(segments.first()).toBeVisible();
  await expect(page.getByTestId("tfg-breakdown")).toContainText("gemini");

  // review one sentence: open it, confirm the label, and it is saved on the server
  await segments.first().locator("button.sent").click();
  const card = page.getByTestId("tfg-card");
  await expect(card.getByTestId("card-source")).toHaveText("Model");
  await card.getByTestId("card-confirm").click();
  const runs = await (await request.get(`/api/tafrigh/runs?lecture_id=${lecture.id}`)).json();
  expect(runs).toHaveLength(1);
  await expect.poll(async () => (await (await request.get(`/api/tafrigh/runs/${runs[0].run_id}`)).json()).run.reviewed).toBe(1);
  await expect(page.getByTestId("tfg-card").getByTestId("card-source")).toHaveText("Confirmed");
});
