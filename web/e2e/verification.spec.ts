import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Phase 15: a verification pass in the real app, with the server's fake verifier (instant, free, offline), then
// the request log and the verdict filter. The same flow with the real Laya is in live-laya.spec.ts.

async function detectedSample(request: APIRequestContext): Promise<number> {
  const lecture = await (await request.post("/api/lectures/sample")).json();
  const { job } = await (await request.post(`/api/lectures/${lecture.id}/detect`)).json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${job.id}`)).json()).status, { timeout: 60_000 }).toBe("done");
  return lecture.id;
}

const english = (page: Page) => page.addInitScript(() => window.localStorage.setItem("wahy.lang", "en"));

test("a pass with the fake verifier gives verdicts, numbers and a request log you can open", async ({ page, request }) => {
  await english(page);
  expect((await request.patch("/api/verification/settings", { data: { provider: "fake" } })).ok()).toBe(true);
  const id = await detectedSample(request);

  await page.goto(`/lectures/${id}/verify`);
  const rows = page.getByTestId("finding-row");
  await expect(rows.first()).toBeVisible();
  const ticked = await rows.locator("input:checked").count();
  expect(ticked).toBeGreaterThan(0);
  await expect(page.getByTestId("est-findings")).toHaveText(String(ticked));
  await expect(page.getByTestId("est-requests")).not.toHaveText("—");

  // untick one quote: the estimate follows
  const before = await page.getByTestId("est-findings").textContent();
  await rows.locator("input:checked").first().uncheck();
  await expect(page.getByTestId("est-findings")).toHaveText(String(Number(before) - 1));
  await rows.locator("input:not(:checked)").first().check();

  await page.getByRole("button", { name: "Start verification" }).click();
  const pass = page.getByTestId("pass");
  await expect(pass).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  const metrics = page.getByTestId("metrics");
  await expect(metrics).toBeVisible();
  await expect(metrics).toContainText("Correct");

  // every quote that was sent now has a verdict
  await expect(rows.locator("input:checked >> xpath=ancestor::label").getByText("Unverified")).toHaveCount(0);

  // the log has one row per request; the inspector shows the exact JSON that was sent
  await page.getByRole("link", { name: "Request log" }).first().click();
  const lines = page.getByTestId("request-row");
  await expect(lines.first()).toBeVisible();
  await lines.first().click();
  await expect(page.getByTestId("payload-in")).toContainText("{");
  await expect(page.getByTestId("payload-out")).toContainText("verdict");
  await expect(page.getByTestId("log-total")).toContainText("requests");
});

test("hiding \"ordinary speech\" turns those quotes into plain words in the transcript", async ({ page, request }) => {
  await english(page);
  const id = await detectedSample(request);
  const findings = (await (await request.get(`/api/lectures/${id}/findings`)).json()).findings as { id: number }[];
  expect(findings.length).toBeGreaterThan(1);
  expect((await request.put(`/api/findings/${findings[0].id}/verdict`, { data: { verdict: "FALSE" } })).ok()).toBe(true);

  await page.goto(`/lectures/${id}`);
  const transcript = page.getByTestId("transcript");
  await expect(transcript.locator(".f").first()).toBeVisible();
  const quotes = await transcript.locator(".f").count();
  const words = await transcript.locator(".w").count();

  await page.getByRole("button", { name: "Ordinary speech" }).click(); // hide the false ones
  await expect(transcript.locator(".f")).toHaveCount(quotes - 1);
  await expect(transcript.locator(".w")).toHaveCount(words); // their words are still there
});
