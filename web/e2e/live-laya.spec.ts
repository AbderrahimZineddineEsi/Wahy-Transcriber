import { expect, test } from "@playwright/test";

// Phase 15's feature check: verify the sample lecture with the real Laya (the checkpoint in the Hugging Face
// cache, on this machine's GPU). Runs only on request:
//   WAHY_E2E_LIVE=1 npx playwright test e2e/live-laya.spec.ts

test("the sample lecture is verified by Laya, and the log shows its requests", async ({ page, request }) => {
  await page.addInitScript(() => window.localStorage.setItem("wahy.lang", "en"));
  expect((await request.patch("/api/verification/settings", { data: { provider: "laya" } })).ok()).toBe(true);
  const lecture = await (await request.post("/api/lectures/sample")).json();
  const { job } = await (await request.post(`/api/lectures/${lecture.id}/detect`)).json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${job.id}`)).json()).status, { timeout: 60_000 }).toBe("done");

  await page.goto(`/lectures/${lecture.id}/verify`);
  await expect(page.getByTestId("laya-info")).toBeVisible();
  await expect(page.getByTestId("finding-row").first()).toBeVisible();
  await page.getByRole("button", { name: "Start verification" }).click();
  await expect(page.getByTestId("pass")).toHaveAttribute("data-status", "done", { timeout: 300_000 });
  await expect(page.getByTestId("metrics")).toContainText("Cost");
  const unverified = await page.getByTestId("finding-row").filter({ has: page.locator("input:checked") }).getByText("Unverified").count();
  expect(unverified).toBe(0);

  await page.goto(`/requests?lecture=${lecture.id}`);
  const lines = page.getByTestId("request-row");
  await expect(lines.first()).toContainText("Laya");
  await lines.first().click();
  await expect(page.getByTestId("payload-in")).toContainText('"checkpoint"');
  await expect(page.getByTestId("payload-in")).toContainText('"state"');

  // the second half of the check: hiding "ordinary speech" turns Laya's false findings into plain words
  await page.goto(`/lectures/${lecture.id}`);
  const transcript = page.getByTestId("transcript");
  await expect(transcript.locator(".f").first()).toBeVisible();
  const quotes = await transcript.locator(".f").count();
  const words = await transcript.locator(".w").count();
  const falses = await transcript.locator('.f[data-verdict="bad"]').count();
  expect(falses).toBeGreaterThan(0); // the sample has one ordinary-speech finding (Muslim 2149)
  await page.getByRole("button", { name: "Ordinary speech" }).click();
  await expect(transcript.locator(".f")).toHaveCount(quotes - falses);
  await expect(transcript.locator(".w")).toHaveCount(words);
});
