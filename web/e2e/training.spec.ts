import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Phase 20 on the real server and engine, offline. The Feature check: correct one verdict in the app, and it is a gold
// label on the training screen and in the Laya export. Also: the old app's exported bank imports and exports as the
// same bytes (the golden file), and a Tafrigh run's reviewed sentences are saved for Laya (F-120).

const dataDir = join(tmpdir(), "wahy-e2e");
const repo = resolve(import.meta.dirname, "..", "..");
const GOLDEN = join(repo, "engine", "golden", "expected", "laya_export.jsonl");

const english = (page: Page) => page.addInitScript(() => window.localStorage.setItem("wahy.lang", "en"));

async function detectedSample(request: APIRequestContext): Promise<number> {
  const lecture = await (await request.post("/api/lectures/sample")).json();
  const { job } = await (await request.post(`/api/lectures/${lecture.id}/detect`)).json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${job.id}`)).json()).status, { timeout: 60_000 }).toBe("done");
  return lecture.id;
}

/** The file the export link downloads. */
async function exported(page: Page, testId = "train-export"): Promise<string> {
  const href = await page.getByTestId(testId).getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);
  return response.text();
}

async function clearTraining(page: Page) {
  await page.goto("/training");
  const total = page.locator('[data-kpi="total"] b');
  await expect(total).not.toHaveText("…"); // the counters have loaded
  const clear = page.getByTestId("train-clear");
  if ((await total.textContent()) !== "0") {
    await clear.click();
    await clear.click(); // the second click confirms
  }
  await expect(page.getByTestId("train-empty")).toBeVisible();
}

test("feature check: correcting a verdict in the app makes a gold label in the training data and the export", async ({ page, request }) => {
  await english(page);
  await clearTraining(page);
  // a verifier's verdicts first (the server's fake verifier: offline and free), so the correction overrides one
  expect((await request.patch("/api/verification/settings", { data: { provider: "fake" } })).ok()).toBe(true);
  const id = await detectedSample(request);
  const started = await (await request.post(`/api/lectures/${id}/verification`, { data: { scope: "ALL", options: { provider: "fake" } } })).json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${started.job.id}`)).json()).status, { timeout: 60_000 }).toBe("done");

  // the verifier's verdicts are training rows, none of them gold
  await page.goto("/training");
  await expect(page.getByTestId("train-row").first()).toBeVisible();
  await expect(page.locator('[data-kpi="gold"] b')).toHaveText("0");

  // correct one in the lecture: الأحزاب: 70 is a real verse, call it ordinary speech
  await page.goto(`/lectures/${id}`);
  await page.getByTestId("transcript").locator(".f.quran .ref").nth(1).click();
  const card = page.getByTestId("finding-card");
  await expect(card).toBeVisible();
  const ref = await card.getAttribute("aria-label");
  await card.getByRole("group", { name: "Your verdict" }).getByRole("button", { name: "Ordinary speech" }).click();
  await expect(card.getByRole("button", { name: "Ordinary speech" })).toHaveAttribute("aria-pressed", "true");

  // the training screen shows it as the user's gold label, with what the verifier had said
  await page.getByRole("link", { name: "Training data" }).first().click();
  await page.getByRole("button", { name: "Gold labels" }).click();
  const gold = page.getByTestId("train-row");
  await expect(gold).toHaveCount(1);
  await expect(gold.first()).toContainText(ref!);
  await expect(gold.first()).toContainText("Ordinary speech (gold)");
  await expect(gold.first()).toContainText("You (verdict)");
  await expect(gold.first()).toContainText("Correct"); // the fake verifier's verdict, kept for lineage
  await expect(page.locator('[data-kpi="gold"] b')).toHaveText("1");

  // and the Laya export has it as a human-verified "false" row
  await page.getByTestId("train-gold-only").check();
  const lines = (await exported(page)).trim().split("\n").map((l) => JSON.parse(l));
  expect(lines).toHaveLength(1);
  expect(lines[0].state.candidate_reference).toBe(ref);
  expect(lines[0].answers.verdict).toEqual({ type: "choice", choice: "FALSE", probabilities: { CORRECT: 0.01, FALSE: 0.98, NOT_SURE: 0.01 } });
  expect(lines[0].meta.human_verified).toBe(true);

  // the inspector shows the same line
  await gold.first().click();
  await expect(page.getByTestId("train-json")).toContainText('"human_verified": true');
});

test("the old app's exported bank imports, and exports again as the same bytes", async ({ page }) => {
  await english(page);
  await clearTraining(page);
  await page.getByTestId("train-import-file").setInputFiles(GOLDEN);
  await expect(page.getByText("6 rows imported, 0 replaced, 0 skipped")).toBeVisible();
  await expect(page.getByTestId("train-row")).toHaveCount(6);
  await expect(page.locator('[data-kpi="total"] b')).toHaveText("6");
  await expect(page.locator('[data-kpi="gold"] b')).toHaveText("3");
  expect(await exported(page)).toBe(readFileSync(GOLDEN, "utf-8"));
  await page.getByRole("button", { name: "From the old app" }).click();
  await expect(page.getByTestId("train-row")).toHaveCount(6);
});

test("a Tafrigh run's reviewed sentences are saved for Laya and show as Tafrigh rows (F-120)", async ({ page, request }) => {
  await english(page);
  await clearTraining(page);
  const id = await detectedSample(request);
  const out = execFileSync("uv", ["run", "--quiet", "python", "../scripts/seed_tafrigh_run.py", dataDir, String(id), "8"], {
    cwd: join(repo, "server"),
    encoding: "utf-8",
    env: { ...process.env, VIRTUAL_ENV: "" },
  });
  const runId = out.trim().split("\n").pop()!;
  const run = await (await request.get(`/api/tafrigh/runs/${runId}`)).json();
  const ids = (run.structured_json.segments as { id: string }[]).map((s) => s.id);
  // review five sentences (confirm them), then save "reviewed by you"
  for (const sid of ids.slice(0, 5)) {
    expect((await request.post(`/api/tafrigh/runs/${runId}/review`, { data: { segment_id: sid, action: "confirm", reviewer_id: "web_editor" } })).ok()).toBe(true);
  }
  await page.goto(`/lectures/${id}/tafrigh`);
  await expect(page.getByTestId("tfg-lesson")).toBeVisible();
  await page.getByTestId("tfg-laya").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("tfg-laya-pick-human").click();
  await expect(dialog.getByTestId("tfg-laya-count")).toContainText(`5 of ${ids.length} chosen`);
  await dialog.getByTestId("tfg-laya-confirm").click();
  await expect(page.getByTestId("tfg-laya-saved")).toHaveText("✓ 5");

  await page.goto("/training");
  await expect(page.locator('[data-kpi="segmentation"] b')).toHaveText("5");
  await page.getByRole("button", { name: "From Tafrigh" }).click();
  await expect(page.getByTestId("train-row")).toHaveCount(5);
  await expect(page.getByTestId("train-row").first()).toContainText("Tafrigh (confirmed)");
  const lines = (await exported(page, "train-export-tafrigh")).trim().split("\n").map((l) => JSON.parse(l));
  expect(lines).toHaveLength(5);
  expect(lines.every((x) => x.schema_version === "tafrigh-laya-1" && x.label_source === "human_confirmed")).toBe(true);
});
